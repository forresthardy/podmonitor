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

Both rows below were measured on the same input: 148.7 s of real Huberman Lab audio, on
an 8-vCPU / 7 GB CPU-only container, `int8`, greedy, VAD on.

| Model | Weights (int8) | Measured speed | Segments | 2 h episode (extrapolated) | When to pick it |
| --- | --- | --- | --- | --- | --- |
| `small` | ~250 MB | 14 s → **10.6x realtime** | 19 | ~11 min | Default. Summarization tolerates occasional word errors — the LLM reads whole paragraphs, and an insight survives a misheard word. |
| `medium` | ~750 MB | 37 s → **4.0x realtime** | 59 | ~30 min | Dense technical vocabulary, heavy accents, or noticeably wrong quotes. Notable quotes are stored verbatim, so a transcript error becomes a visible product defect. |

On this sample the two transcripts agree on 97.1% of their text, so the honest summary is
that `medium` costs 2.6x the CPU for a difference this sample cannot resolve into a
quality verdict — there is no ground-truth reference here, so neither can be called more
accurate on word error rate. What does differ measurably is granularity: `medium`
produced 59 segments where `small` produced 19, which matters if timestamp-level citation
back to the audio becomes a product requirement.

Because processing is a background queue job, wall-clock time is not user-facing latency;
the real cost of `medium` is throughput when several episodes queue at once. Start on
`small`, move to `medium` if quote fidelity disappoints.

The 2-hour figures are extrapolated linearly from a 2.5-minute sample, not measured on a
full episode. Long audio adds VAD and context-window effects, so treat them as an order
of magnitude rather than a promise.

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
