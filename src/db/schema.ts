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
    text: text('text').notNull(),
    context: text('context'),
    timestampSec: integer('timestamp_sec'),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('insights_user_id_idx').on(table.userId),
    index('insights_summary_id_idx').on(table.summaryId),
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

export type User = typeof users.$inferSelect
export type Session = typeof sessions.$inferSelect
export type Interest = typeof interests.$inferSelect
export type Podcast = typeof podcasts.$inferSelect
export type Episode = typeof episodes.$inferSelect
export type Transcript = typeof transcripts.$inferSelect
export type Summary = typeof summaries.$inferSelect
export type Insight = typeof insights.$inferSelect
export type InsightLink = typeof insightLinks.$inferSelect
export type Digest = typeof digests.$inferSelect
