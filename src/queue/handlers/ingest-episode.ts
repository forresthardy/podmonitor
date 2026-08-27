import type PgBoss from 'pg-boss'
import { matchEpisodeForAllUsers } from '@/lib/interest-matching/match-service'
import { QUEUES } from '../queues'

export interface IngestEpisodeJobData {
  episodeId: string
}

/**
 * Registers the `ingest-episode` worker: the INTEREST MATCH stage of the pipeline. One job
 * per newly-discovered episode, enqueued by the poll-feeds job. Scores the episode against
 * every user's active interests and records a decision each — see `matchEpisodeForAllUsers`.
 * Throwing lets pg-boss retry; a transient DB error must not silently drop the episode.
 */
export async function registerIngestEpisodeWorker(boss: PgBoss): Promise<void> {
  await boss.work<IngestEpisodeJobData>(QUEUES.ingestEpisode, async (jobs) => {
    for (const job of jobs) {
      await matchEpisodeForAllUsers(job.data.episodeId)
    }
  })
}
