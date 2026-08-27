"""
Contract tests for the sidecar's HTTP surface.

These pin the shape the Node worker depends on: field names, types, status codes, and
the guarantee that uploaded audio is deleted once a response is sent.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from app.config import get_settings
from app.transcriber import ModelLoadError, TranscriptionError
from tests.conftest import FIXTURE_AUDIO, FakeTranscriber


def _upload(client, path: Path = FIXTURE_AUDIO, **data):
    with path.open("rb") as handle:
        return client.post(
            "/transcribe",
            files={"file": (path.name, handle, "audio/wav")},
            data=data or None,
        )


def test_fixture_audio_exists() -> None:
    assert FIXTURE_AUDIO.is_file(), "run sidecar/tests/fixtures/generate_fixture.py"


def test_transcribe_returns_timestamped_segments(client, fake_transcriber) -> None:
    response = _upload(client)

    assert response.status_code == 200
    body = response.json()
    assert body == {
        "model": "small",
        "compute_type": "int8",
        "language": "en",
        "language_probability": 0.98,
        "duration_sec": 1.0,
        "segments": [
            {"start": 0.0, "end": 0.6, "text": "Hello from the sidecar."},
            {"start": 0.6, "end": 1.0, "text": "Second segment."},
        ],
    }
    # `speaker` is omitted rather than null: faster-whisper does not diarize.
    assert "speaker" not in body["segments"][0]


def test_upload_reaches_the_backend_byte_for_byte(client, fake_transcriber) -> None:
    _upload(client)

    assert fake_transcriber.seen_bytes == FIXTURE_AUDIO.stat().st_size


def test_temp_audio_is_deleted_after_the_response(client, fake_transcriber) -> None:
    _upload(client)

    assert fake_transcriber.seen_path is not None
    assert not fake_transcriber.seen_path.exists()


def test_temp_audio_is_deleted_when_transcription_fails(client, fake_transcriber) -> None:
    fake_transcriber.raises = TranscriptionError("decode blew up")

    response = _upload(client)

    assert response.status_code == 422
    assert "decode blew up" in response.json()["detail"]
    assert fake_transcriber.seen_path is not None
    assert not fake_transcriber.seen_path.exists()


def test_forced_language_is_passed_through(client, fake_transcriber) -> None:
    response = _upload(client, language="de")

    assert response.status_code == 200
    assert fake_transcriber.seen_language == "de"
    assert response.json()["language"] == "de"


def test_model_load_failure_is_a_503(client, fake_transcriber) -> None:
    fake_transcriber.raises = ModelLoadError("no such model")

    response = _upload(client)

    assert response.status_code == 503
    assert "no such model" in response.json()["detail"]


def test_empty_audio_is_rejected(client, tmp_path: Path) -> None:
    empty = tmp_path / "empty.wav"
    empty.write_bytes(b"")

    response = _upload(client, path=empty)

    assert response.status_code == 400
    assert response.json()["detail"] == "uploaded audio is empty"


def test_oversized_audio_is_rejected(client, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SIDECAR_MAX_UPLOAD_BYTES", "1024")
    get_settings.cache_clear()

    response = _upload(client)

    assert response.status_code == 413
    assert "exceeds the 1024 byte limit" in response.json()["detail"]


def test_missing_file_is_a_validation_error(client) -> None:
    assert client.post("/transcribe", data={"language": "en"}).status_code == 422


def test_health_reports_configuration(client, fake_transcriber) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "model": "small",
        "device": "cpu",
        "compute_type": "int8",
        "model_loaded": True,
    }


def test_health_reflects_configured_model(client, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WHISPER_MODEL", "medium")
    get_settings.cache_clear()

    assert client.get("/health").json()["model"] == "medium"


@pytest.mark.slow
def test_real_model_transcribes_the_fixture() -> None:
    """
    Opt-in end-to-end check against real faster-whisper weights.

    Excluded from the default run (and from CI) because it downloads model weights.
    Run with: pytest -m slow
    """
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        with FIXTURE_AUDIO.open("rb") as handle:
            response = client.post(
                "/transcribe", files={"file": (FIXTURE_AUDIO.name, handle, "audio/wav")}
            )

    assert response.status_code == 200
    body = response.json()
    assert body["model"] == os.environ.get("WHISPER_MODEL", "small")
    assert body["duration_sec"] == pytest.approx(1.0, abs=0.3)
    # A 440 Hz tone contains no speech, so segment count is not asserted — the contract
    # under test is that real weights load and produce a well-formed response.
    assert isinstance(body["segments"], list)
