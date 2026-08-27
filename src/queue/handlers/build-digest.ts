import { and, eq } from 'drizzle-orm'
import type PgBoss from 'pg-boss'
import { z } from 'zod'
import { getDb, type Database } from '@/db/client'
import { digests, users } from '@/db/schema'
import { assembleDigest, type DigestContent } from '@/lib/digest/assemble'
import { renderDigestEmail, type DigestEmailContent } from '@/lib/digest/render'
import { loadDigestSourceRows, listSubscribedUserIds } from '@/lib/digest/service'
import { digestWindowFor, formatDateOnly, startOfIsoWeekUtc } from '@/lib/digest/week'
import { appBaseUrl, digestDryRunDefault } from '@/lib/env'
import { createEmailProviderFromEnv } from '@/lib/email/provider'
import type { EmailProvider } from '@/lib/email/types'
import { QUEUES } from '../queues'

/**
 * The weekly digest stage.
 *
 * One `digests` row per (user, week), guarded by the table's unique index — a re-delivered
 * job never double-sends. Dry-run mode (either the payload flag, used by tests, or
 * `DIGEST_DRY_RUN`, used by QA/staging) renders the exact email a real send would produce
 * but skips both the provider call and the `digests` insert, so previewing never blocks a
 * later real send for the same week.
 */
export const buildDigestPayloadSchema = z.object({
  /** Explicit target (e.g. a manual resend) or omitted to build every subscribed user's digest. */
  userId: z.string().uuid().optional(),
  /** `YYYY-MM-DD` override for the Monday being digested; omitted = the current week. Mainly for tests/backfill. */
  weekOf: z.string().optional(),
  dryRun: z.boolean().optional(),
})

export type BuildDigestPayload = z.infer<typeof buildDigestPayloadSchema>

export type BuildDigestOutcome =
  | 'sent'
  | 'dry_run'
  | 'already_present'
  | 'no_new_summaries'
  | 'user_missing'

export interface BuildDigestUserResult {
  outcome: BuildDigestOutcome
  userId: string
  weekOf: string
  content?: DigestContent
  rendered?: DigestEmailContent
}

export interface BuildDigestContext {
  db?: Database
  provider?: EmailProvider
  appUrl?: string
}

async function buildDigestForUser(
  userId: string,
  weekOf: Date,
  dryRun: boolean,
  context: Required<Pick<BuildDigestContext, 'db'>> & BuildDigestContext,
): Promise<BuildDigestUserResult> {
  const { db } = context
  const weekOfDate = formatDateOnly(weekOf)

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user) {
    return { outcome: 'user_missing', userId, weekOf: weekOfDate }
  }

  // A real send checks idempotency before doing any work; a dry run always renders, even
  // for a week that was already sent, since previewing is the whole point.
  if (!dryRun) {
    const [existing] = await db
      .select({ id: digests.id })
      .from(digests)
      .where(and(eq(digests.userId, userId), eq(digests.weekOf, weekOfDate)))
      .limit(1)
    if (existing) {
      return { outcome: 'already_present', userId, weekOf: weekOfDate }
    }
  }

  const rows = await loadDigestSourceRows(db, userId, digestWindowFor(weekOf))
  if (rows.length === 0) {
    return { outcome: 'no_new_summaries', userId, weekOf: weekOfDate }
  }

  const content = assembleDigest(userId, weekOfDate, rows)
  const rendered = renderDigestEmail(content, { appUrl: context.appUrl ?? appBaseUrl() })

  if (dryRun) {
    return { outcome: 'dry_run', userId, weekOf: weekOfDate, content, rendered }
  }

  const provider = context.provider ?? createEmailProviderFromEnv()
  await provider.send({
    to: user.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  })

  await db
    .insert(digests)
    .values({
      userId,
      weekOf: weekOfDate,
      sentAt: new Date(),
      episodeIds: content.episodes.map((episode) => episode.episodeId),
    })
    // A concurrent delivery may have inserted it first; the unique index is the arbiter.
    .onConflictDoNothing({ target: [digests.userId, digests.weekOf] })

  return { outcome: 'sent', userId, weekOf: weekOfDate, content, rendered }
}

export interface HandleBuildDigestResult {
  weekOf: string
  results: BuildDigestUserResult[]
}

/**
 * @param context Injectable db/provider/appUrl so tests never need a running pg-boss or a
 * real email provider — mirrors `SummarizeEpisodeContext`.
 */
export async function handleBuildDigest(
  rawPayload: unknown,
  context: BuildDigestContext = {},
): Promise<HandleBuildDigestResult> {
  const payload = buildDigestPayloadSchema.parse(rawPayload ?? {})
  const db = context.db ?? getDb()
  const weekOf = payload.weekOf
    ? new Date(`${payload.weekOf}T00:00:00.000Z`)
    : startOfIsoWeekUtc(new Date())
  const dryRun = payload.dryRun ?? digestDryRunDefault()

  const targetUserIds = payload.userId ? [payload.userId] : await listSubscribedUserIds(db)

  const results: BuildDigestUserResult[] = []
  for (const userId of targetUserIds) {
    results.push(await buildDigestForUser(userId, weekOf, dryRun, { ...context, db }))
  }

  return { weekOf: formatDateOnly(weekOf), results }
}

/** Registers the `build-digest` pg-boss worker. */
export async function registerBuildDigestWorker(boss: PgBoss): Promise<void> {
  await boss.work(QUEUES.buildDigest, async (jobs) => {
    for (const job of jobs) {
      const result = await handleBuildDigest(job.data)
      const sent = result.results.filter((row) => row.outcome === 'sent').length
      console.log(
        `[build-digest] job ${job.id}: week ${result.weekOf}, ` +
          `${sent}/${result.results.length} sent`,
      )
    }
  })
}

/**
 * Schedules the weekly digest. Monday 13:00 UTC: after the poll/summarize pipeline has had
 * the weekend to catch up, still early enough to land in most subscribers' Monday inbox.
 */
export async function scheduleBuildDigest(boss: PgBoss): Promise<void> {
  await boss.schedule(QUEUES.buildDigest, '0 13 * * 1', {})
}
