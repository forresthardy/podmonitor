import { describe, expect, it } from 'vitest'
import { hashingEmbedding } from '@/lib/embeddings/hashing'
import { scoreCandidates, selectLinkCandidates } from '@/lib/knowledge/linking'

/**
 * Fixture vectors, not embeddings of prose, wherever the point is the threshold itself:
 * hand-written unit vectors make the expected similarity arithmetic obvious.
 */
const CANDIDATES = [
  { insightId: 'near', embedding: [1, 0, 0] },
  { insightId: 'mid', embedding: [0.6, 0.8, 0] },
  { insightId: 'far', embedding: [0, 1, 0] },
]

describe('scoreCandidates', () => {
  it('scores every candidate against the query vector, strongest first', () => {
    expect(scoreCandidates([1, 0, 0], CANDIDATES)).toEqual([
      { insightId: 'near', similarity: 1 },
      { insightId: 'mid', similarity: 0.6 },
      { insightId: 'far', similarity: 0 },
    ])
  })

  it('returns nothing when the knowledge base is empty', () => {
    expect(scoreCandidates([1, 0, 0], [])).toEqual([])
  })
})

describe('selectLinkCandidates', () => {
  const scored = scoreCandidates([1, 0, 0], CANDIDATES)

  it('keeps only candidates at or above the threshold', () => {
    expect(selectLinkCandidates(scored, { threshold: 0.55, maxLinks: 10 }).map((c) => c.insightId)).toEqual([
      'near',
      'mid',
    ])
    expect(selectLinkCandidates(scored, { threshold: 0.7, maxLinks: 10 }).map((c) => c.insightId)).toEqual([
      'near',
    ])
    expect(selectLinkCandidates(scored, { threshold: 1.01, maxLinks: 10 })).toEqual([])
  })

  it('treats the threshold as inclusive', () => {
    expect(selectLinkCandidates(scored, { threshold: 0.6, maxLinks: 10 }).map((c) => c.insightId)).toEqual([
      'near',
      'mid',
    ])
  })

  it('caps the number of links and keeps the strongest', () => {
    expect(selectLinkCandidates(scored, { threshold: 0, maxLinks: 2 }).map((c) => c.insightId)).toEqual([
      'near',
      'mid',
    ])
  })

  it('links nothing when the cap is zero or negative', () => {
    expect(selectLinkCandidates(scored, { threshold: 0, maxLinks: 0 })).toEqual([])
    expect(selectLinkCandidates(scored, { threshold: 0, maxLinks: -1 })).toEqual([])
  })

  it('re-sorts input that arrives out of order', () => {
    const unsorted = [
      { insightId: 'weak', similarity: 0.6 },
      { insightId: 'strong', similarity: 0.9 },
    ]
    expect(selectLinkCandidates(unsorted, { threshold: 0.5, maxLinks: 1 })).toEqual([
      { insightId: 'strong', similarity: 0.9 },
    ])
  })

  it('separates a real restatement from an unrelated insight at the default threshold', () => {
    const query = hashingEmbedding('Distribution moats compound faster than product moats', 256)
    const scoredReal = scoreCandidates(query, [
      {
        insightId: 'restatement',
        embedding: hashingEmbedding('Distribution moats compound faster than any product moats', 256),
      },
      {
        insightId: 'unrelated',
        embedding: hashingEmbedding('Morning sunlight regulates the circadian clock', 256),
      },
    ])

    // 0.55 is the INSIGHT_LINK_THRESHOLD default; this is the case it has to get right.
    expect(selectLinkCandidates(scoredReal, { threshold: 0.55, maxLinks: 3 }).map((c) => c.insightId)).toEqual([
      'restatement',
    ])
  })
})
