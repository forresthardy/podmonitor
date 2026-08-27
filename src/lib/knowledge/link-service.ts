import { asc, eq, inArray, sql } from 'drizzle-orm'
import { getDb, type Database } from '@/db/client'
import { episodes, insightLinks, insights, summaries } from '@/db/schema'
import { createEmbeddingProviderFromEnv } from '@/lib/embeddings/provider'
import type { EmbeddingProvider } from '@/lib/embeddings/types'
import {
  insightLinkCandidatePoolSize,
  insightLinkMaxPerInsight,
  insightLinkThreshold,
} from '@/lib/env'
import { createLLMProviderFromEnv } from '@/lib/llm/provider'
import type { LLMProvider } from '@/lib/llm/types'
import { selectLinkCandidates, type ScoredCandidate } from './linking'
import { classifyRelations, type RelationCandidate } from './relation'

/**
 * The knowledge-base write path: turn a stored summary's `keyInsights` into first-class
 * `insights` rows with embeddings, then cross-reference each one against everything the
 * same user has captured before.
 *
 * Insights, not summaries, are the searchable atom — a summary is the container it arrived
 * in. Splitting them out is what makes "this echoes something you read in March" possible
 * at all.
 *
 * Every step is idempotent, because pg-boss can redeliver: insights are unique per
 * (summary, ordinal), links are unique per (insight, related insight, relation), and an
 * insight that already has links is skipped rather than re-linked. A crash between the
 * insert and the linking pass therefore recovers on redelivery instead of stranding
 * insights with no cross-references.
 */

export interface LinkSummaryOptions {
  db?: Database
  /** Injected by tests; production resolves from `EMBEDDING_PROVIDER`. */
  embeddingProvider?: EmbeddingProvider
  /** Only constructed when there is actually something to classify. */
  llmProvider?: LLMProvider
  threshold?: number
  maxLinksPerInsight?: number
  candidatePoolSize?: number
}

export type LinkSummaryOutcome = 'linked' | 'already_linked' | 'summary_missing' | 'no_insights'

export interface LinkSummaryResult {
  outcome: LinkSummaryOutcome
  summaryId: string
  insightsCreated: number
  linksCreated: number
}

interface InsightRow {
  id: string
  ordinal: number
  text: string
  context: string | null
  embedding: number[] | null
}

/**
 * What gets embedded: the insight plus its surrounding argument. The one-sentence text
 * alone is often too thin to place ("It compounds." embeds like nothing at all), and the
 * context is exactly the disambiguating material.
 */
export function insightEmbeddingText(insight: { text: string; context?: string | null }): string {
  return insight.context ? `${insight.text}\n${insight.context}` : insight.text
}

/** pgvector's text input format. Drizzle has no vector *parameter* type for raw SQL. */
function toVectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(',')}]`
}

/** Postgres returns `vector` columns as the same bracketed text it accepts. */
function parseVectorColumn(value: unknown): number[] | null {
  if (Array.isArray(value)) return value.map((entry) => Number(entry))
  if (typeof value !== 'string') return null
  const inner = value.trim().replace(/^\[/, '').replace(/\]$/, '')
  if (inner === '') return null
  return inner.split(',').map((entry) => Number(entry))
}

async function readSummaryInsights(db: Database, summaryId: string): Promise<InsightRow[]> {
  const rows = await db
    .select({
      id: insights.id,
      ordinal: insights.ordinal,
      text: insights.text,
      context: insights.context,
      embedding: insights.embedding,
    })
    .from(insights)
    .where(eq(insights.summaryId, summaryId))
    .orderBy(asc(insights.ordinal))

  return rows.map((row) => ({ ...row, embedding: parseVectorColumn(row.embedding) }))
}

/**
 * pgvector nearest neighbours among the same user's *other* summaries' insights.
 *
 * `user_id` in the predicate is the isolation boundary: one reader's knowledge base must
 * never surface another's insight. Ordering by the indexed `<=>` operator lets the HNSW
 * index do the work; the threshold is applied in `selectLinkCandidates` afterwards.
 */
async function findCandidates(
  db: Database,
  params: { userId: string; summaryId: string; embedding: number[]; poolSize: number },
): Promise<ScoredCandidate[]> {
  const literal = toVectorLiteral(params.embedding)
  const result = await db.execute<{ id: string; similarity: string | number }>(sql`
    select id::text as id, 1 - (embedding <=> ${literal}::vector) as similarity
    from insights
    where user_id = ${params.userId}
      and summary_id <> ${params.summaryId}
      and embedding is not null
    order by embedding <=> ${literal}::vector
    limit ${params.poolSize}
  `)

  return result.rows.map((row) => ({
    insightId: row.id,
    similarity: Number(row.similarity),
  }))
}

interface CandidateDetail extends RelationCandidate {
  insightId: string
}

async function readCandidateDetails(
  db: Database,
  insightIds: string[],
): Promise<Map<string, CandidateDetail>> {
  if (insightIds.length === 0) return new Map()

  const rows = await db
    .select({
      insightId: insights.id,
      text: insights.text,
      context: insights.context,
      episodeTitle: episodes.title,
    })
    .from(insights)
    .innerJoin(episodes, eq(episodes.id, insights.episodeId))
    .where(inArray(insights.id, insightIds))

  return new Map(rows.map((row) => [row.insightId, row]))
}

/** Inserts one `insights` row per `keyInsights` entry, numbered from 1. */
async function createInsightRows(
  db: Database,
  summary: { id: string; userId: string; episodeId: string; insights: readonly { text: string; context: string; timestampSec: number | null }[] },
): Promise<number> {
  const values = summary.insights.map((insight, index) => ({
    userId: summary.userId,
    episodeId: summary.episodeId,
    summaryId: summary.id,
    ordinal: index + 1,
    text: insight.text,
    context: insight.context,
    timestampSec: insight.timestampSec,
  }))

  const inserted = await db
    .insert(insights)
    .values(values)
    // A concurrent redelivery may have inserted them first; the unique index is the arbiter.
    .onConflictDoNothing({ target: [insights.summaryId, insights.ordinal] })
    .returning({ id: insights.id })

  return inserted.length
}

/** Backfills embeddings for rows that have none — the recovery path after a partial run. */
async function embedMissing(
  db: Database,
  rows: InsightRow[],
  provider: EmbeddingProvider,
): Promise<void> {
  const pending = rows.filter((row) => row.embedding === null)
  if (pending.length === 0) return

  const vectors = await provider.embed(pending.map(insightEmbeddingText))
  if (vectors.length !== pending.length) {
    throw new Error(
      `embedding provider ${provider.name} returned ${vectors.length} vectors for ${pending.length} insights`,
    )
  }

  for (const [index, row] of pending.entries()) {
    const embedding = vectors[index]
    if (!embedding) throw new Error(`embedding provider ${provider.name} returned a gap`)
    if (embedding.length !== provider.dimensions) {
      throw new Error(
        `embedding provider ${provider.name} returned ${embedding.length} dimensions, expected ${provider.dimensions}`,
      )
    }
    await db.update(insights).set({ embedding }).where(eq(insights.id, row.id))
    row.embedding = embedding
  }
}

/** Insights that already carry links are considered done: relinking them would duplicate. */
async function readAlreadyLinkedIds(db: Database, insightIds: string[]): Promise<Set<string>> {
  if (insightIds.length === 0) return new Set()
  const rows = await db
    .select({ insightId: insightLinks.insightId })
    .from(insightLinks)
    .where(inArray(insightLinks.insightId, insightIds))
  return new Set(rows.map((row) => row.insightId))
}

export async function linkSummaryInsights(
  summaryId: string,
  options: LinkSummaryOptions = {},
): Promise<LinkSummaryResult> {
  const db = options.db ?? getDb()
  const threshold = options.threshold ?? insightLinkThreshold()
  const maxLinks = options.maxLinksPerInsight ?? insightLinkMaxPerInsight()
  const poolSize = options.candidatePoolSize ?? insightLinkCandidatePoolSize()

  const [summary] = await db.select().from(summaries).where(eq(summaries.id, summaryId)).limit(1)

  if (!summary) {
    // A deleted summary is not a retryable fault — the job is done, emptily.
    return { outcome: 'summary_missing', summaryId, insightsCreated: 0, linksCreated: 0 }
  }
  if (summary.insights.length === 0) {
    return { outcome: 'no_insights', summaryId, insightsCreated: 0, linksCreated: 0 }
  }

  const embeddingProvider = options.embeddingProvider ?? createEmbeddingProviderFromEnv()
  const insightsCreated = await createInsightRows(db, {
    id: summary.id,
    userId: summary.userId,
    episodeId: summary.episodeId,
    insights: summary.insights,
  })

  const rows = await readSummaryInsights(db, summary.id)
  await embedMissing(db, rows, embeddingProvider)

  const alreadyLinked = await readAlreadyLinkedIds(
    db,
    rows.map((row) => row.id),
  )
  const pendingRows = rows.filter((row) => !alreadyLinked.has(row.id))

  let llmProvider = options.llmProvider
  let linksCreated = 0

  for (const row of pendingRows) {
    const embedding = row.embedding
    if (!embedding) continue

    const scored = await findCandidates(db, {
      userId: summary.userId,
      summaryId: summary.id,
      embedding,
      poolSize,
    })
    const selected = selectLinkCandidates(scored, { threshold, maxLinks })
    if (selected.length === 0) continue

    const details = await readCandidateDetails(
      db,
      selected.map((candidate) => candidate.insightId),
    )
    const ordered = selected.flatMap((candidate) => {
      const detail = details.get(candidate.insightId)
      return detail ? [{ candidate, detail }] : []
    })
    if (ordered.length === 0) continue

    // Constructed on first real need so a knowledge base with nothing to link never
    // requires an LLM key at all.
    llmProvider ??= createLLMProviderFromEnv()

    const relations = await classifyRelations(llmProvider, {
      insightText: row.text,
      insightContext: row.context,
      candidates: ordered.map(({ detail }) => detail),
    })

    const inserted = await db
      .insert(insightLinks)
      .values(
        ordered.map(({ candidate }, index) => ({
          insightId: row.id,
          relatedInsightId: candidate.insightId,
          relation: relations[index] ?? 'echoes',
          score: candidate.similarity,
        })),
      )
      .onConflictDoNothing({
        target: [insightLinks.insightId, insightLinks.relatedInsightId, insightLinks.relation],
      })
      .returning({ id: insightLinks.id })

    linksCreated += inserted.length
  }

  const outcome: LinkSummaryOutcome =
    insightsCreated === 0 && linksCreated === 0 && pendingRows.length === 0
      ? 'already_linked'
      : 'linked'

  return { outcome, summaryId: summary.id, insightsCreated, linksCreated }
}
