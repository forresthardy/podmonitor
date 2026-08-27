import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core'

/** Dimension of the insight embeddings (matches the spec's `vector(1536)`). */
export const EMBEDDING_DIMENSIONS = 1536

export const episodeStatus = pgEnum('episode_status', [
  'discovered',
  'transcribing',
  'summarized',
  'failed',
])

export const transcriptSource = pgEnum('transcript_source', ['feed_tag', 'asr', 'episode_page'])

export const insightRelation = pgEnum('insight_relation', ['extends', 'contradicts', 'echoes'])

/**
 * Outcome of scoring one episode against one user's interests.
 * `auto_queued`/`confirmed` are treated identically downstream (both mean "summarize this");
 * `review` is the borderline band awaiting a human confirm/dismiss; `skipped` never surfaces.
 */
export const interestMatchDecision = pgEnum('interest_match_decision', [
  'auto_queued',
  'review',
  'confirmed',
  'dismissed',
  'skipped',
])

/** Which pass produced the stored decision — see `src/lib/interest-matching/scoring.ts`. */
export const interestMatchSignal = pgEnum('interest_match_signal', ['cheap', 'transcript'])

export interface TranscriptSegment {
  start: number
  end: number
  text: string
  speaker?: string
}

export interface SummaryInsight {
  text: string
  context: string
  timestampSec: number | null
}

export interface SummaryQuote {
  quote: string
  speaker: string
  timestampSec: number
}

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Stored lowercased and trimmed; see `normalizeEmail`. */
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    /**
     * Whether the weekly digest job includes this account. Defaults to true so existing
     * accounts keep the behaviour they had before the column existed, and stored per user
     * rather than inferred from activity: "stop emailing me" must be a decision the reader
     * makes, not a side effect of a quiet week.
     */
    weeklyDigestOptIn: boolean('weekly_digest_opt_in').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_email_unique').on(table.email)],
)

/**
 * Server-side sessions. Only the SHA-256 hash of the token is stored, so a database
 * leak does not hand out live sessions.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sessions_token_hash_unique').on(table.tokenHash),
    index('sessions_user_id_idx').on(table.userId),
  ],
)

export const interests = pgTable(
  'interests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    weight: real('weight').notNull().default(1),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('interests_user_id_idx').on(table.userId)],
)

export const podcasts = pgTable(
  'podcasts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    feedUrl: text('feed_url').notNull(),
    title: text('title').notNull(),
    imageUrl: text('image_url'),
    lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('podcasts_feed_url_unique').on(table.feedUrl)],
)

export const episodes = pgTable(
  'episodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    podcastId: uuid('podcast_id')
      .notNull()
      .references(() => podcasts.id, { onDelete: 'cascade' }),
    /** Feed-provided GUID: the idempotency key that stops re-ingestion. */
    guid: text('guid').notNull(),
    title: text('title').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    audioUrl: text('audio_url'),
    durationSec: integer('duration_sec'),
    description: text('description'),
    imageUrl: text('image_url'),
    /**
     * Raw `podcast:transcript` link from the feed, if the publisher provides one (e.g.
     * Transistor's recent Acquired episodes). Populated at ingestion time; the transcript
     * acquisition stage is what actually fetches it and sets `transcriptSource` to `feed_tag`.
     */
    transcriptUrl: text('transcript_url'),
    itunesEpisode: integer('itunes_episode'),
    itunesSeason: integer('itunes_season'),
    status: episodeStatus('status').notNull().default('discovered'),
    transcriptSource: transcriptSource('transcript_source'),
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('episodes_guid_unique').on(table.guid),
    index('episodes_podcast_id_idx').on(table.podcastId),
    index('episodes_status_idx').on(table.status),
  ],
)

/**
 * One row per (episode, user): the editorial decision layer sitting between the global
 * processing pipeline (`episodes.status`) and per-user summarization. Kept separate from
 * `episodes.status` because interest is per-user while episode processing is shared — two
 * users can reach opposite decisions on the same episode.
 */
export const episodeInterestMatches = pgTable(
  'episode_interest_matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The interest that produced the winning score, if any (null when no interest matched at all). */
    interestId: uuid('interest_id').references(() => interests.id, { onDelete: 'set null' }),
    score: real('score').notNull(),
    signal: interestMatchSignal('signal').notNull(),
    decision: interestMatchDecision('decision').notNull(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('episode_interest_matches_episode_user_unique').on(table.episodeId, table.userId),
    index('episode_interest_matches_user_decision_idx').on(table.userId, table.decision),
  ],
)

export const transcripts = pgTable(
  'transcripts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    fullText: text('full_text').notNull(),
    segments: jsonb('segments').$type<TranscriptSegment[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('transcripts_episode_id_unique').on(table.episodeId)],
)

export const summaries = pgTable(
  'summaries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tldr: text('tldr').notNull(),
    insights: jsonb('insights').$type<SummaryInsight[]>().notNull().default([]),
    quotes: jsonb('quotes').$type<SummaryQuote[]>().notNull().default([]),
    topics: jsonb('topics').$type<string[]>().notNull().default([]),
    model: text('model').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('summaries_episode_user_unique').on(table.episodeId, table.userId),
    index('summaries_user_id_idx').on(table.userId),
  ],
)

export const insights = pgTable(
  'insights',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    summaryId: uuid('summary_id')
      .notNull()
      .references(() => summaries.id, { onDelete: 'cascade' }),
    /**
     * 1-based position within its summary. This is the "#N" the cross-reference callout
     * cites ("see insight #2 from ..."), so it has to be stable and stored, not derived
     * from a query's row order.
     */
    ordinal: integer('ordinal').notNull(),
    text: text('text').notNull(),
    context: text('context'),
    timestampSec: integer('timestamp_sec'),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('insights_user_id_idx').on(table.userId),
    index('insights_summary_id_idx').on(table.summaryId),
    // Makes re-delivery of the linking job a no-op insert rather than a duplicate insight.
    uniqueIndex('insights_summary_ordinal_unique').on(table.summaryId, table.ordinal),
    // Cosine-similarity search over each user's own insights drives cross-referencing.
    index('insights_embedding_hnsw_idx').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops'),
    ),
  ],
)

export const insightLinks = pgTable(
  'insight_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    insightId: uuid('insight_id')
      .notNull()
      .references(() => insights.id, { onDelete: 'cascade' }),
    relatedInsightId: uuid('related_insight_id')
      .notNull()
      .references(() => insights.id, { onDelete: 'cascade' }),
    relation: insightRelation('relation').notNull(),
    score: real('score').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('insight_links_pair_unique').on(
      table.insightId,
      table.relatedInsightId,
      table.relation,
    ),
    index('insight_links_insight_id_idx').on(table.insightId),
  ],
)

export const digests = pgTable(
  'digests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Monday of the digest week. */
    weekOf: date('week_of').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    episodeIds: jsonb('episode_ids').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('digests_user_week_unique').on(table.userId, table.weekOf)],
)

/** The pipeline states an episode can be in, as a TS union for exhaustive UI mapping. */
export type EpisodeStatus = (typeof episodeStatus.enumValues)[number]
export type TranscriptSourceName = (typeof transcriptSource.enumValues)[number]

export type User = typeof users.$inferSelect
export type Session = typeof sessions.$inferSelect
export type Interest = typeof interests.$inferSelect
export type EpisodeInterestMatch = typeof episodeInterestMatches.$inferSelect
export type Podcast = typeof podcasts.$inferSelect
export type Episode = typeof episodes.$inferSelect
export type Transcript = typeof transcripts.$inferSelect
export type Summary = typeof summaries.$inferSelect
export type Insight = typeof insights.$inferSelect
export type InsightLink = typeof insightLinks.$inferSelect
export type Digest = typeof digests.$inferSelect
