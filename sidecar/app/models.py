"""Wire contract. These models are the sidecar's public API."""

from __future__ import annotations

from pydantic import BaseModel, Field


class Segment(BaseModel):
    """One timestamped span of speech."""

    start: float = Field(description="Segment start, in seconds from the top of the audio.")
    end: float = Field(description="Segment end, in seconds.")
    text: str = Field(description="Transcribed text, whitespace-normalized.")
    speaker: str | None = Field(
        default=None,
        description=(
            "Always absent: faster-whisper does not diarize. Present in the schema so "
            "publisher transcripts and ASR output share one segment shape."
        ),
    )


class TranscribeResponse(BaseModel):
    model: str = Field(description="Whisper model that produced this transcript.")
    compute_type: str
    language: str = Field(description="Detected (or caller-forced) BCP-47 language.")
    language_probability: float | None = None
    duration_sec: float = Field(description="Audio duration as decoded by the model.")
    segments: list[Segment]


class HealthResponse(BaseModel):
    status: str
    model: str
    device: str
    compute_type: str
    model_loaded: bool = Field(
        description="False until the first transcription warms the model into memory."
    )
