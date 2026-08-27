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

function floatEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw || raw.trim() === '') return fallback
  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be a number, received: ${raw}`)
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

export type LlmProviderName = 'groq' | 'openai' | 'anthropic'

/**
 * Which LLM adapter the summarization job uses. Groq's free tier is the default per the
 * spec's ~$0 cost decision; switching to a paid provider is this one variable, not a
 * code change.
 */
export function llmProviderName(): LlmProviderName {
  const raw = (process.env.LLM_PROVIDER ?? 'groq').trim().toLowerCase()
  if (raw === 'groq' || raw === 'openai' || raw === 'anthropic') return raw
  throw new Error(
    `Unsupported LLM_PROVIDER: ${raw} (expected one of: groq, openai, anthropic)`,
  )
}

/** Overrides the active provider's default model. Unset uses the adapter's own default. */
export function llmModelOverride(): string | undefined {
  const value = process.env.LLM_MODEL?.trim()
  return value && value !== '' ? value : undefined
}

export function llmRequestTimeoutMs(): number {
  return intEnv('LLM_REQUEST_TIMEOUT_MS', 60_000)
}

/**
 * Attempts for one summarization call before giving up and letting pg-boss's own queue
 * retry take over. Free-tier rate limits are the expected failure mode, so this is worth
 * a few tries with backoff rather than failing the job on the first 429.
 */
export function llmMaxAttempts(): number {
  return intEnv('LLM_MAX_ATTEMPTS', 4)
}

export function llmRetryBaseDelayMs(): number {
  return intEnv('LLM_RETRY_BASE_DELAY_MS', 2_000)
}

export type EmbeddingProviderName = 'local' | 'openai'

/**
 * Which embedding adapter the knowledge base uses. `local` (free, deterministic, lexical)
 * is the default per the spec's ~$0 cost decision; `openai` buys semantic matching.
 */
export function embeddingProviderName(): EmbeddingProviderName {
  const raw = (process.env.EMBEDDING_PROVIDER ?? 'local').trim().toLowerCase()
  if (raw === 'local' || raw === 'openai') return raw
  throw new Error(`Unsupported EMBEDDING_PROVIDER: ${raw} (expected one of: local, openai)`)
}

/** Overrides the active embedding provider's default model. */
export function embeddingModelOverride(): string | undefined {
  const value = process.env.EMBEDDING_MODEL?.trim()
  return value && value !== '' ? value : undefined
}

export function embeddingRequestTimeoutMs(): number {
  return intEnv('EMBEDDING_REQUEST_TIMEOUT_MS', 30_000)
}

/**
 * Cosine similarity at or above which two insights are considered related.
 *
 * Provider-dependent by nature: a lexical embedding and a semantic one do not put
 * "related" at the same number, so this is configuration rather than a constant. The
 * default is tuned for the local feature-hash embedding, where unrelated insights sit
 * near 0 and insights restating the same idea clear 0.5 comfortably.
 */
export function insightLinkThreshold(): number {
  return floatEnv('INSIGHT_LINK_THRESHOLD', 0.55)
}

/** Cap on links written per new insight: a callout list is only useful while it is short. */
export function insightLinkMaxPerInsight(): number {
  return intEnv('INSIGHT_LINK_MAX_PER_INSIGHT', 3)
}

/**
 * How many nearest neighbours pgvector returns before thresholding. Larger than the link
 * cap so the threshold, not the fetch size, decides what survives.
 */
export function insightLinkCandidatePoolSize(): number {
  return intEnv('INSIGHT_LINK_CANDIDATE_POOL', 20)
}

export type EmailProviderName = 'resend' | 'smtp'

/**
 * Which email adapter the digest job uses. Resend's free tier is the default per the
 * spec's ~$0 cost decision; the `EmailProvider` interface is what makes switching to any
 * SMTP relay (Postmark, SES, a self-hosted server) a config change, not a code change.
 */
export function emailProviderName(): EmailProviderName {
  const raw = (process.env.EMAIL_PROVIDER ?? 'resend').trim().toLowerCase()
  if (raw === 'resend' || raw === 'smtp') return raw
  throw new Error(`Unsupported EMAIL_PROVIDER: ${raw} (expected one of: resend, smtp)`)
}

/** The verified sender address the digest email is sent from. */
export function emailFromAddress(): string {
  return requireEnv('EMAIL_FROM')
}

export function emailRequestTimeoutMs(): number {
  return intEnv('EMAIL_REQUEST_TIMEOUT_MS', 30_000)
}

export function smtpHost(): string {
  return requireEnv('SMTP_HOST')
}

export function smtpPort(): number {
  return intEnv('SMTP_PORT', 587)
}

export function smtpSecure(): boolean {
  return (process.env.SMTP_SECURE ?? 'false').trim().toLowerCase() === 'true'
}

/** Base URL the digest email links back to (the dashboard, by default local dev). */
export function appBaseUrl(): string {
  const value = process.env.APP_BASE_URL?.trim()
  return value && value !== '' ? value : 'http://localhost:3000'
}

/**
 * Default for the digest job's dry-run flag when a job payload doesn't specify one. Lets
 * a staging deploy preview digests (render but never send) via one env var for QA, without
 * touching the payload contract the digest assembly/render tests exercise directly.
 */
export function digestDryRunDefault(): boolean {
  return (process.env.DIGEST_DRY_RUN ?? 'false').trim().toLowerCase() === 'true'
}
