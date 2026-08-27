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
