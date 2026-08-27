"""
HTTP surface: POST audio, get timestamped segments.

Uploads are streamed to a temp file and deleted in a finally block — episode audio is
too large to hold in memory, and a leaked 120 MB file per job fills the disk in a day.
"""

from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path

from anyio import to_thread
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile, status

from .config import Settings, get_settings
from .models import HealthResponse, Segment, TranscribeResponse
from .transcriber import (
    ModelLoadError,
    Transcriber,
    TranscriptionError,
    TranscriptionResult,
    get_transcriber,
)

logger = logging.getLogger(__name__)

CHUNK_BYTES = 1024 * 1024

app = FastAPI(
    title="Podmonitor transcription sidecar",
    version="1.0.0",
    summary="Wraps faster-whisper (CPU, int8) behind one endpoint.",
)


def _suffix(filename: str | None) -> str:
    """Whisper decodes by content, but a correct extension helps the demuxer guess."""
    if not filename:
        return ".audio"
    suffix = Path(filename).suffix
    return suffix if 0 < len(suffix) <= 10 else ".audio"


async def _spool_to_disk(upload: UploadFile, max_bytes: int) -> Path:
    """Streams the upload to a temp file, enforcing the size cap as it goes."""
    handle, raw_path = tempfile.mkstemp(prefix="podmonitor-audio-", suffix=_suffix(upload.filename))
    path = Path(raw_path)
    total = 0
    try:
        with os.fdopen(handle, "wb") as sink:
            while chunk := await upload.read(CHUNK_BYTES):
                total += len(chunk)
                if total > max_bytes:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=f"audio exceeds the {max_bytes} byte limit",
                    )
                sink.write(chunk)
    except BaseException:
        path.unlink(missing_ok=True)
        raise

    if total == 0:
        path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="uploaded audio is empty"
        )
    return path


def _to_response(result: TranscriptionResult) -> TranscribeResponse:
    return TranscribeResponse(
        model=result.model,
        compute_type=result.compute_type,
        language=result.language,
        language_probability=result.language_probability,
        duration_sec=result.duration_sec,
        segments=[
            Segment(start=segment.start, end=segment.end, text=segment.text)
            for segment in result.segments
        ],
    )


@app.get("/health", response_model=HealthResponse)
def health(
    settings: Settings = Depends(get_settings),
    transcriber: Transcriber = Depends(get_transcriber),
) -> HealthResponse:
    """Liveness plus the active configuration. Does not force a model load."""
    return HealthResponse(
        status="ok",
        model=settings.model,
        device=settings.device,
        compute_type=settings.compute_type,
        model_loaded=transcriber.model_loaded,
    )


@app.post(
    "/transcribe",
    response_model=TranscribeResponse,
    response_model_exclude_none=True,
)
async def transcribe(
    file: UploadFile = File(description="Episode audio in any format ffmpeg can decode."),
    language: str | None = Form(
        default=None,
        description="Force a language (BCP-47). Omit to let the model detect it.",
    ),
    settings: Settings = Depends(get_settings),
    transcriber: Transcriber = Depends(get_transcriber),
) -> TranscribeResponse:
    audio_path = await _spool_to_disk(file, settings.max_upload_bytes)
    try:
        # Transcription is CPU-bound and can run for tens of minutes: off the event loop.
        result = await to_thread.run_sync(transcriber.transcribe, audio_path, language)
    except ModelLoadError as error:
        logger.exception("model load failed")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)
        ) from error
    except TranscriptionError as error:
        logger.exception("transcription failed")
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error)
        ) from error
    finally:
        audio_path.unlink(missing_ok=True)

    return _to_response(result)
