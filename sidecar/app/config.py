"""Configuration, read from the environment once per process."""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache

DEFAULT_MODEL = "small"


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError as error:
        raise ValueError(f"{name} must be an integer, received: {raw!r}") from error


def _bool_env(name: str, default: bool) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{name} must be a boolean, received: {raw!r}")


@dataclass(frozen=True)
class Settings:
    """
    Whisper knobs and upload limits.

    `model` is the accuracy/speed dial and the one value most likely to change per
    deployment: see README.md for the measured small-vs-medium tradeoff.
    """

    model: str = DEFAULT_MODEL
    device: str = "cpu"
    compute_type: str = "int8"
    #: 0 lets CTranslate2 pick a thread count from the host CPU.
    cpu_threads: int = 0
    #: Greedy decoding. Beam search costs roughly linear CPU time for a small accuracy
    #: gain, which is a bad trade on the CPU-only default deployment.
    beam_size: int = 1
    #: Voice-activity filtering skips silence, the cheapest real speedup available.
    vad_filter: bool = True
    #: Where model weights are cached; None uses the huggingface default.
    download_root: str | None = None
    #: Episode audio is large but not unbounded; a 2-hour MP3 is ~120 MB.
    max_upload_bytes: int = 500 * 1024 * 1024


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached so a request never re-reads the environment."""
    return Settings(
        model=os.environ.get("WHISPER_MODEL", "").strip() or DEFAULT_MODEL,
        device=os.environ.get("WHISPER_DEVICE", "").strip() or "cpu",
        compute_type=os.environ.get("WHISPER_COMPUTE_TYPE", "").strip() or "int8",
        cpu_threads=_int_env("WHISPER_CPU_THREADS", 0),
        beam_size=_int_env("WHISPER_BEAM_SIZE", 1),
        vad_filter=_bool_env("WHISPER_VAD_FILTER", True),
        download_root=os.environ.get("WHISPER_DOWNLOAD_ROOT", "").strip() or None,
        max_upload_bytes=_int_env("SIDECAR_MAX_UPLOAD_BYTES", 500 * 1024 * 1024),
    )
