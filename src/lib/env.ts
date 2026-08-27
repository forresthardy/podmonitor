/**
 * Environment access. Values are read lazily so that importing a module does not
 * require a configured environment (Next builds and unit tests import freely).
 */

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw || raw.trim() === '') return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, received: ${raw}`)
  }
  return parsed
}

export function databaseUrl(): string {
  return requireEnv('DATABASE_URL')
}

/** bcrypt work factor. Low values are only meant for test runs. */
export function bcryptCost(): number {
  return intEnv('BCRYPT_COST', 12)
}

export function sessionTtlDays(): number {
  return intEnv('SESSION_TTL_DAYS', 30)
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

/** Base URL of the Python transcription sidecar (see `sidecar/README.md`). */
export function whisperSidecarUrl(): string {
  const value = process.env.WHISPER_SIDECAR_URL?.trim()
  return value && value !== '' ? value : 'http://localhost:8081'
}

/**
 * Upper bound on one transcription request. CPU transcription of a 2-hour episode runs
 * roughly 20-40 minutes, so this is deliberately generous: a timeout that fires on
 * healthy work would turn every long episode into a retry storm.
 */
export function whisperSidecarTimeoutMs(): number {
  return intEnv('WHISPER_SIDECAR_TIMEOUT_MS', 3 * 60 * 60 * 1000)
}

/** A 2-hour MP3 is ~120 MB; 500 MB leaves room for lossless feeds without being unbounded. */
export function maxEpisodeAudioBytes(): number {
  return intEnv('MAX_EPISODE_AUDIO_BYTES', 500 * 1024 * 1024)
}

/** Transcript files are text; 20 MB is far above any real transcript. */
export function maxTranscriptFileBytes(): number {
  return intEnv('MAX_TRANSCRIPT_FILE_BYTES', 20 * 1024 * 1024)
}

export function transcriptFetchTimeoutMs(): number {
  return intEnv('TRANSCRIPT_FETCH_TIMEOUT_MS', 60_000)
}
