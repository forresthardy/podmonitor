"""
Regenerates `tone.wav`, the contract-test fixture.

A synthetic tone rather than a real podcast clip: the fixture's job is to exercise the
multipart upload, size-cap, and cleanup paths with a genuinely decodable audio file, and
committing publisher audio to the repo would be a licensing problem.

Usage: python sidecar/tests/fixtures/generate_fixture.py
"""

from __future__ import annotations

import math
import struct
import wave
from pathlib import Path

SAMPLE_RATE = 16_000
DURATION_SEC = 1.0
FREQUENCY_HZ = 440.0


def main() -> None:
    target = Path(__file__).parent / "tone.wav"
    frames = bytearray()
    for index in range(int(SAMPLE_RATE * DURATION_SEC)):
        amplitude = 0.3 * math.sin(2 * math.pi * FREQUENCY_HZ * index / SAMPLE_RATE)
        frames += struct.pack("<h", int(amplitude * 32767))

    with wave.open(str(target), "wb") as sink:
        sink.setnchannels(1)
        sink.setsampwidth(2)
        sink.setframerate(SAMPLE_RATE)
        sink.writeframes(bytes(frames))

    print(f"wrote {target} ({target.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
