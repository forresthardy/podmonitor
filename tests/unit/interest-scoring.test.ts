import { describe, expect, it } from 'vitest'
import {
  AUTO_QUEUE_THRESHOLD,
  REVIEW_THRESHOLD,
  classifyScore,
  cosineSimilarity,
  embedText,
  scoreEpisode,
  scoreEpisodeText,
} from '@/lib/interest-matching/scoring'

describe('embedText / cosineSimilarity', () => {
  it('is deterministic and self-similar', () => {
    const a = embedText('AI agents in production')
    const b = embedText('AI agents in production')
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 10)
  })

  it('scores completely disjoint vocabulary as unrelated', () => {
    const a = embedText('artificial intelligence agents in production')
    const b = embedText('celebrity gossip weekly recap entertainment news')
    expect(cosineSimilarity(a, b)).toBe(0)
  })

  it('is case- and punctuation-insensitive', () => {
    const a = embedText('AI Agents, in Production!')
    const b = embedText('ai agents in production')
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 10)
  })
})

describe('classifyScore', () => {
  it('classifies the three bands using the exported thresholds', () => {
    expect(classifyScore(AUTO_QUEUE_THRESHOLD)).toBe('auto_queued')
    expect(classifyScore(AUTO_QUEUE_THRESHOLD - 0.001)).toBe('review')
    expect(classifyScore(REVIEW_THRESHOLD)).toBe('review')
    expect(classifyScore(REVIEW_THRESHOLD - 0.001)).toBe('skipped')
  })
})

describe('scoreEpisodeText (cheap pass)', () => {
  it('picks the best-matching interest and ignores unrelated ones', () => {
    const episode = {
      title: 'How AI agents are reshaping production engineering teams',
      description: 'A deep dive into deploying autonomous AI agents in real production systems.',
    }
    const result = scoreEpisodeText(episode, [
      { id: 'related', text: 'AI agents in production', weight: 1 },
      { id: 'unrelated', text: 'celebrity gossip weekly recap', weight: 1 },
    ])

    expect(result.matchedInterestId).toBe('related')
    expect(result.score).toBeGreaterThan(REVIEW_THRESHOLD)
  })

  it('returns a zero score with no matched interest when there are no active interests', () => {
    expect(scoreEpisodeText({ title: 'Anything' }, [])).toEqual({
      score: 0,
      matchedInterestId: null,
    })
  })

  it('lets weight lower the effective bar for the same raw similarity', () => {
    const episode = { title: 'AI agents in production' }
    const interestText = 'AI agents in production'

    // Identical text on both sides means cosine similarity is exactly 1, so the weight
    // alone determines which band the weighted score lands in.
    expect(
      scoreEpisodeText(episode, [{ id: 'x', text: interestText, weight: 1 }]).score,
    ).toBeCloseTo(1, 10)
    expect(
      scoreEpisodeText(episode, [{ id: 'x', text: interestText, weight: 0.5 }]).score,
    ).toBeCloseTo(0.5, 10)
    expect(
      scoreEpisodeText(episode, [{ id: 'x', text: interestText, weight: 0.3 }]).score,
    ).toBeCloseTo(0.3, 10)
  })

  it('clamps the weighted score at 1 even when weight pushes it higher', () => {
    const episode = { title: 'AI agents in production' }
    const result = scoreEpisodeText(episode, [
      { id: 'x', text: 'AI agents in production', weight: 5 },
    ])
    expect(result.score).toBe(1)
  })
})

describe('scoreEpisode (cheap-first, transcript on ambiguity)', () => {
  const interest = {
    id: 'ai-agents',
    text: 'artificial intelligence agents in production systems',
    weight: 1,
  }

  it('never runs the transcript pass when the cheap pass is confident', () => {
    const confidentEpisode = {
      title: 'artificial intelligence agents in production systems',
      description: 'artificial intelligence agents in production systems',
      // A transcript that would score very differently must be ignored: cheap already decided.
      transcriptExcerpt: 'celebrity gossip weekly recap entertainment news',
    }

    const result = scoreEpisode(confidentEpisode, [interest])
    expect(result.signal).toBe('cheap')
    expect(result.decision).toBe('auto_queued')
  })

  it('never runs the transcript pass when the cheap pass clearly misses, even with a transcript', () => {
    const clearMiss = {
      title: 'celebrity gossip weekly recap',
      description: 'entertainment news',
      transcriptExcerpt: 'artificial intelligence agents in production systems',
    }

    const result = scoreEpisode(clearMiss, [interest])
    expect(result.signal).toBe('cheap')
    expect(result.decision).toBe('skipped')
  })

  it('stays in review when the cheap pass is ambiguous and no transcript is available yet', () => {
    const ambiguousEpisode = {
      title: 'Weekly roundup on artificial intelligence agents',
      description: 'A brief mention of artificial intelligence trends this week.',
    }

    const result = scoreEpisode(ambiguousEpisode, [interest])
    expect(result.signal).toBe('cheap')
    expect(result.decision).toBe('review')
    expect(result.score).toBeGreaterThanOrEqual(REVIEW_THRESHOLD)
    expect(result.score).toBeLessThan(AUTO_QUEUE_THRESHOLD)
  })

  it('escalates an ambiguous cheap pass to auto_queued once the transcript confirms the match', () => {
    const ambiguousWithTranscript = {
      title: 'Weekly roundup on artificial intelligence agents',
      description: 'A brief mention of artificial intelligence trends this week.',
      transcriptExcerpt:
        'This episode is entirely about artificial intelligence agents in production systems, ' +
        'how teams deploy artificial intelligence agents in production systems reliably, and ' +
        'what breaks when artificial intelligence agents in production systems fail.',
    }

    const result = scoreEpisode(ambiguousWithTranscript, [interest])
    expect(result.signal).toBe('transcript')
    expect(result.decision).toBe('auto_queued')
    expect(result.score).toBeGreaterThanOrEqual(AUTO_QUEUE_THRESHOLD)
  })

  it('can resolve an ambiguous cheap pass down to skipped once the transcript rules it out', () => {
    const ambiguousButUnrelatedTranscript = {
      title: 'Weekly roundup on artificial intelligence agents',
      description: 'A brief mention of artificial intelligence trends this week.',
      transcriptExcerpt: 'celebrity gossip weekly recap entertainment news top ten list',
    }

    const result = scoreEpisode(ambiguousButUnrelatedTranscript, [interest])
    expect(result.signal).toBe('transcript')
    expect(result.decision).toBe('skipped')
  })
})
