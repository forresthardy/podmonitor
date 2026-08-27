"""Shared fixtures. The app is imported through the package so relative imports resolve."""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

import pytest

SIDECAR_ROOT = Path(__file__).resolve().parents[1]
if str(SIDECAR_ROOT) not in sys.path:
    sys.path.insert(0, str(SIDECAR_ROOT))

from app.config import get_settings  # noqa: E402
from app.transcriber import (  # noqa: E402
    ModelLoadError,
    TranscribedSegment,
    TranscriptionError,
    TranscriptionResult,
)

FIXTURE_AUDIO = Path(__file__).parent / "fixtures" / "tone.wav"


@dataclass
class FakeTranscriber:
    """
    Stands in for faster-whisper.

    Records the path it was handed so a test can assert the sidecar deleted the temp file
    after responding, and can be told to raise to exercise the error contract.
    """

    raises: Exception | None = None
    seen_path: Path | None = None
    seen_language: str | None = None
    seen_bytes: int = 0
    model_loaded: bool = True

    def transcribe(self, audio_path: Path, language: str | None = None) -> TranscriptionResult:
        self.seen_path = audio_path
        self.seen_language = language
        self.seen_bytes = audio_path.stat().st_size
        if self.raises is not None:
            raise self.raises
        return TranscriptionResult(
            model="small",
            compute_type="int8",
            language=language or "en",
            language_probability=0.98,
            duration_sec=1.0,
            segments=[
                TranscribedSegment(start=0.0, end=0.6, text="Hello from the sidecar."),
                TranscribedSegment(start=0.6, end=1.0, text="Second segment."),
            ],
        )


@pytest.fixture
def fake_transcriber() -> FakeTranscriber:
    return FakeTranscriber()


@pytest.fixture
def client(fake_transcriber: FakeTranscriber):
    """TestClient with the transcription backend replaced."""
    from fastapi.testclient import TestClient

    from app.main import app
    from app.transcriber import get_transcriber

    app.dependency_overrides[get_transcriber] = lambda: fake_transcriber
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _reset_settings_cache():
    """Settings are cached per process; tests that patch the environment need a clean read."""
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


__all__ = [
    "FIXTURE_AUDIO",
    "FakeTranscriber",
    "ModelLoadError",
    "TranscriptionError",
]
