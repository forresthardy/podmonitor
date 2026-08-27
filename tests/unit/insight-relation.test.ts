import { describe, expect, it, vi } from 'vitest'
import {
  buildRelationPrompt,
  classifyRelations,
  DEFAULT_RELATION,
  parseRelationResponse,
  RelationParseError,
} from '@/lib/knowledge/relation'
import type { LLMProvider } from '@/lib/llm/types'

const CANDIDATES = [
  { text: 'Distribution beats product.', context: 'Early Standard Oil.', episodeTitle: 'Standard Oil' },
  { text: 'Product quality is the only moat.', context: null, episodeTitle: 'Lenny on moats' },
]

function stubProvider(response: string): LLMProvider {
  return { name: 'stub', model: 'stub-model', complete: vi.fn(async () => response) }
}

describe('buildRelationPrompt', () => {
  it('numbers candidates 1-based and includes their episode for grounding', () => {
    const [system, user] = buildRelationPrompt({
      insightText: 'Distribution moats compound.',
      insightContext: 'The hosts revisit moats.',
      candidates: CANDIDATES,
    })

    expect(system?.role).toBe('system')
    expect(user?.content).toContain('NEW INSIGHT:\nDistribution moats compound.')
    expect(user?.content).toContain('context: The hosts revisit moats.')
    expect(user?.content).toContain('1. (from "Standard Oil") Distribution beats product.')
    expect(user?.content).toContain('2. (from "Lenny on moats") Product quality is the only moat.')
  })

  it('omits the context line when the insight has none', () => {
    const [, user] = buildRelationPrompt({
      insightText: 'Distribution moats compound.',
      insightContext: null,
      candidates: CANDIDATES,
    })
    expect(user?.content).not.toContain('\ncontext:')
  })
})

describe('parseRelationResponse', () => {
  it('maps candidate numbers to relations in candidate order', () => {
    const raw = JSON.stringify({
      links: [
        { candidate: 2, relation: 'contradicts' },
        { candidate: 1, relation: 'extends' },
      ],
    })
    expect(parseRelationResponse(raw, 2)).toEqual(['extends', 'contradicts'])
  })

  it('accepts a fenced response', () => {
    const raw = '```json\n{"links":[{"candidate":1,"relation":"echoes"}]}\n```'
    expect(parseRelationResponse(raw, 1)).toEqual(['echoes'])
  })

  it('defaults candidates the model skipped or numbered out of range', () => {
    const raw = JSON.stringify({ links: [{ candidate: 5, relation: 'extends' }] })
    expect(parseRelationResponse(raw, 2)).toEqual([DEFAULT_RELATION, DEFAULT_RELATION])
  })

  it('rejects a response that is not JSON', () => {
    expect(() => parseRelationResponse('sure! here you go', 1)).toThrow(RelationParseError)
  })

  it('rejects an unknown relation rather than storing it', () => {
    const raw = JSON.stringify({ links: [{ candidate: 1, relation: 'refutes' }] })
    expect(() => parseRelationResponse(raw, 1)).toThrow(RelationParseError)
  })
})

describe('classifyRelations', () => {
  it('classifies every candidate in one provider call', async () => {
    const provider = stubProvider(
      JSON.stringify({ links: [{ candidate: 1, relation: 'extends' }, { candidate: 2, relation: 'contradicts' }] }),
    )

    expect(
      await classifyRelations(provider, { insightText: 'x', insightContext: null, candidates: CANDIDATES }),
    ).toEqual(['extends', 'contradicts'])
    expect(provider.complete).toHaveBeenCalledTimes(1)
  })

  it('degrades to the neutral relation when the answer is unusable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(
      await classifyRelations(stubProvider('not json'), {
        insightText: 'x',
        insightContext: null,
        candidates: CANDIDATES,
      }),
    ).toEqual([DEFAULT_RELATION, DEFAULT_RELATION])
    // Degrading silently would hide a broken prompt or model.
    expect(warn).toHaveBeenCalled()

    warn.mockRestore()
  })

  it('propagates a transport failure so the queue can retry', async () => {
    const provider: LLMProvider = {
      name: 'stub',
      model: 'stub-model',
      complete: vi.fn(async () => {
        throw new Error('provider unreachable')
      }),
    }

    await expect(
      classifyRelations(provider, { insightText: 'x', insightContext: null, candidates: CANDIDATES }),
    ).rejects.toThrow(/provider unreachable/)
  })

  it('never calls the provider when there is nothing to classify', async () => {
    const provider = stubProvider('{}')
    expect(
      await classifyRelations(provider, { insightText: 'x', insightContext: null, candidates: [] }),
    ).toEqual([])
    expect(provider.complete).not.toHaveBeenCalled()
  })
})
