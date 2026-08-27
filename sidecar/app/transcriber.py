"""
Transcription backend.

The FastAPI layer depends on the `Transcriber` protocol, never on faster-whisper
directly, so the contract tests can substitute a fake and CI does not need to download
model weights. Swapping in a managed ASR provider means implementing this protocol.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from .config import Settings, get_settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class TranscribedSegment:
    start: float
    end: float
    text: str


@dataclass(frozen=True)
class TranscriptionResult:
    model: str
    compute_type: str
    language: str
    language_probability: float | None
    duration_sec: float
    segments: list[TranscribedSegment]


class TranscriptionError(RuntimeError):
    """Raised when the backend cannot produce a transcript for the given audio."""


class ModelLoadError(RuntimeError):
    """Raised when model weights cannot be loaded (missing name, no disk, no network)."""


class Transcriber(Protocol):
    def transcribe(self, audio_path: Path, language: str | None = None) -> TranscriptionResult:
        ...

    @property
    def model_loaded(self) -> bool:
        ...


class FasterWhisperTranscriber:
    """
    CPU, int8 faster-whisper.

    The model is loaded on first use rather than at import: process start stays fast, and
    a bad model name surfaces as a request error instead of a crash loop. Loading is
    guarded by a lock because two concurrent first requests would otherwise each pay the
    load cost.
    """

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._model: object | None = None
        self._lock = threading.Lock()

    @property
    def model_loaded(self) -> bool:
        return self._model is not None

    def _load_model(self) -> object:
        if self._model is not None:
            return self._model
        with self._lock:
            # Another thread may have loaded it while this one waited.
            if self._model is not None:
                return self._model
            settings = self._settings
            try:
                # Imported lazily: a heavy dependency the test suite must not require.
                from faster_whisper import WhisperModel
            except ImportError as error:  # pragma: no cover - depends on install extras
                raise ModelLoadError(
                    "faster-whisper is not installed; install sidecar/requirements.txt"
                ) from error

            logger.info(
                "loading whisper model=%s device=%s compute_type=%s",
                settings.model,
                settings.device,
                settings.compute_type,
            )
            try:
                self._model = WhisperModel(
                    settings.model,
                    device=settings.device,
                    compute_type=settings.compute_type,
                    cpu_threads=settings.cpu_threads,
                    download_root=settings.download_root,
                )
            except Exception as error:
                raise ModelLoadError(f"could not load model {settings.model!r}: {error}") from error
            return self._model

    def transcribe(self, audio_path: Path, language: str | None = None) -> TranscriptionResult:
        settings = self._settings
        model = self._load_model()
        try:
            # faster-whisper returns a lazy generator; consuming it does the work.
            raw_segments, info = model.transcribe(  # type: ignore[attr-defined]
                str(audio_path),
                language=language,
                beam_size=settings.beam_size,
                vad_filter=settings.vad_filter,
            )
            segments = [
                TranscribedSegment(
                    start=float(segment.start),
                    end=float(segment.end),
                    text=" ".join(segment.text.split()),
                )
                for segment in raw_segments
            ]
        except Exception as error:
            raise TranscriptionError(f"transcription failed: {error}") from error

        return TranscriptionResult(
            model=settings.model,
            compute_type=settings.compute_type,
            language=getattr(info, "language", None) or language or "unknown",
            language_probability=getattr(info, "language_probability", None),
            duration_sec=float(getattr(info, "duration", 0.0)),
            # A segment with no words is noise, not content.
            segments=[segment for segment in segments if segment.text],
        )


_transcriber: FasterWhisperTranscriber | None = None
_transcriber_lock = threading.Lock()


def get_transcriber() -> Transcriber:
    """Process-wide transcriber, so model weights are loaded at most once."""
    global _transcriber
    if _transcriber is None:
        with _transcriber_lock:
            if _transcriber is None:
                _transcriber = FasterWhisperTranscriber()
    return _transcriber
