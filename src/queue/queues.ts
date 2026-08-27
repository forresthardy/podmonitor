import type PgBoss from 'pg-boss'

/**
 * The pipeline stages from the spec, one queue each. Later PRs attach handlers;
 * the foundation only guarantees the queues exist and are reachable.
 */
export const QUEUES = {
  pollFeeds: 'poll-feeds',
  ingestEpisode: 'ingest-episode',
  acquireTranscript: 'acquire-transcript',
  summarizeEpisode: 'summarize-episode',
  linkInsights: 'link-insights',
  buildDigest: 'build-digest',
} as const

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES]

export const ALL_QUEUES: QueueName[] = Object.values(QUEUES)

/**
 * Per-queue retry and expiration policy.
 *
 * Configured on the queue rather than passed at send time so every enqueuer inherits it:
 * the spec's recoverable state machine depends on retries happening, and a producer that
 * forgot the options would silently opt an episode out of them.
 */
export const QUEUE_OPTIONS: Partial<Record<QueueName, Omit<PgBoss.Queue, 'name'>>> = {
  [QUEUES.acquireTranscript]: {
    // Three tries over ~7 minutes of backoff covers the realistic transient faults here
    // (CDN hiccup, sidecar restart) without parking an episode for hours.
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
    // Must exceed the worst realistic ASR run: a 2-hour episode is 20-40 minutes of CPU,
    // plus the audio download. An expiry that fires mid-transcription would retry work
    // that was actually progressing.
    expireInSeconds: 4 * 60 * 60,
  },
}
