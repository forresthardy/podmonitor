# Transcription sidecar

A single-endpoint HTTP service wrapping [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
on CPU with int8 quantization. The worker posts episode audio; the sidecar returns
timestamped segments. It is the ASR fallback in the pipeline's transcript-first policy —
publisher `podcast:transcript` files are always preferred (see `src/lib/transcripts/selector.ts`).

## Contract

### `POST /transcribe`

`multipart/form-data`:

| Field | Required | Notes |
| --- | --- | --- |
| `file` | yes | Episode audio, any format the bundled ffmpeg libraries decode. |
| `language` | no | BCP-47 tag to force a language. Omit for auto-detection. |

`200 OK`:

```json
{
  "model": "small",
  "compute_type": "int8",
  "language": "en",
  "language_probability": 0.98,
  "duration_sec": 3612.4,
  "segments": [{ "start": 0.0, "end": 4.2, "text": "Welcome back to the show." }]
}
```

`segments[].speaker` is part of the schema but never populated: faster-whisper does not
diarize. Speaker labels only ever come from publisher transcripts.

| Status | Meaning |
| --- | --- |
| 400 | Uploaded audio was empty. |
| 413 | Audio exceeded `SIDECAR_MAX_UPLOAD_BYTES`. |
| 422 | Missing `file`, or the model could not decode the audio. |
| 503 | Model weights could not be loaded. Retryable. |

### `GET /health`

Returns status and the active configuration. Does not force a model load, so it stays
fast during startup; `model_loaded` is `false` until the first transcription.

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `WHISPER_MODEL` | `small` | Accuracy/speed dial — see the tradeoff below. |
| `WHISPER_DEVICE` | `cpu` | |
| `WHISPER_COMPUTE_TYPE` | `int8` | int8 is ~2x faster than float32 on CPU with negligible WER change at this model size. |
| `WHISPER_CPU_THREADS` | `0` | 0 lets CTranslate2 choose from the host CPU count. |
| `WHISPER_BEAM_SIZE` | `1` | Greedy. Beam search costs roughly linear time for a small accuracy gain. |
| `WHISPER_VAD_FILTER` | `true` | Skips silence. The cheapest real speedup available. |
| `WHISPER_DOWNLOAD_ROOT` | unset | Model cache directory. Mount a volume to avoid re-downloading weights. |
| `SIDECAR_MAX_UPLOAD_BYTES` | `524288000` | 500 MB. A 2-hour MP3 is ~120 MB. |

### Choosing a model: `small` vs `medium`

`small` is the default. The tradeoff is transcription time against word error rate, and
it matters because a 2-hour episode is the normal case for the seed shows.

| Model | Weights (int8) | Relative CPU time | When to pick it |
| --- | --- | --- | --- |
| `small` | ~250 MB | 1x (baseline) | Default. Summarization tolerates occasional word errors — the LLM reads whole paragraphs, and an insight survives a misheard word. |
| `medium` | ~750 MB | ~2.5-3x | Dense technical vocabulary, heavy accents, or noticeably wrong quotes. Notable quotes are stored verbatim, so a transcript error becomes a visible product defect. |

Because processing is a background queue job, wall-clock time is not user-facing latency;
the real cost of `medium` is throughput when several episodes queue at once. Start on
`small`, move to `medium` if quote fidelity disappoints. Measured runtimes for this
deployment are in the PR description.

## Running it

```bash
cd sidecar
pip install -r requirements.txt
uvicorn app.main:app --port 8081
```

Or with Docker:

```bash
docker build -t podmonitor-sidecar sidecar
docker run -p 8081:8081 -v whisper-models:/root/.cache/huggingface podmonitor-sidecar
```

The Node worker reaches it at `WHISPER_SIDECAR_URL` (default `http://localhost:8081`).

## Tests

```bash
pip install -r requirements-dev.txt
pytest                 # contract tests, no model weights needed (this is what CI runs)
pytest -m slow         # additionally loads real weights; requires requirements.txt
```

The contract tests inject a fake transcriber through FastAPI's dependency override, so
they pin the HTTP contract — field names, status codes, and temp-file cleanup — without
downloading a model. `tests/fixtures/tone.wav` is a generated 1-second tone
(`generate_fixture.py`), not publisher audio.
