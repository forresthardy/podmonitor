# CPU-only image: no CUDA base, no GPU runtime. int8 quantization is what makes this
# workable on commodity hardware.
FROM python:3.12-slim

WORKDIR /app

# ctranslate2 wheels are self-contained and `av` bundles its own ffmpeg libraries, so no
# apt packages are needed for audio decoding.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

ENV WHISPER_MODEL=small \
    WHISPER_DEVICE=cpu \
    WHISPER_COMPUTE_TYPE=int8 \
    SIDECAR_PORT=8081

EXPOSE 8081

# One worker: transcription saturates the CPU, so concurrency belongs in the queue's
# job concurrency, not in this process.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${SIDECAR_PORT} --workers 1"]
