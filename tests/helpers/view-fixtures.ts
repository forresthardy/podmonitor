import type { EpisodeLibraryItem } from '@/lib/episodes/types'
import type { InsightSearchResult } from '@/lib/knowledge/search-view'
import type { CrossReferenceView, SummaryView } from '@/lib/knowledge/summary-view'
import type { SettingsView } from '@/lib/settings/types'

/**
 * Builders for the read models the UI renders.
 *
 * Each takes an override patch so a test states only the field it is about — a test named
 * "shows the failure reason" should not also have to invent a podcast title. Defaults are
 * deliberately realistic (a real-looking timestamp, a real-looking episode name) so a
 * snapshot of a failure reads like the product.
 */

export function crossReferenceViewFixture(
  overrides: Partial<CrossReferenceView> = {},
): CrossReferenceView {
  return {
    relation: 'extends',
    score: 0.82,
    callout: 'Extends insight #2 from “Standard Oil” (Mar 4, 2026)',
    relatedInsightId: 'insight-older',
    relatedSummaryId: 'summary-older',
    relatedOrdinal: 2,
    relatedEpisodeTitle: 'Standard Oil',
    relatedText: 'Vertical integration was the moat, not scale.',
    ...overrides,
  }
}

export function summaryViewFixture(overrides: Partial<SummaryView> = {}): SummaryView {
  return {
    id: 'summary-1',
    episodeId: 'episode-1',
    episodeTitle: 'How pricing power compounds',
    podcastTitle: 'Invest Like the Best',
    publishedAt: '2026-08-20T00:00:00.000Z',
    tldr: 'Pricing power is the cheapest growth lever most companies never pull.',
    insights: [
      {
        ordinal: 1,
        text: 'Pricing power shows up in retention, not in the price list.',
        context: 'Said while comparing two SaaS businesses with identical churn.',
        timestampSec: 754,
        crossReferences: [],
      },
      {
        ordinal: 2,
        text: 'A 1% price rise beats a 1% volume rise at every gross margin above 50%.',
        context: 'Worked through the arithmetic on air.',
        timestampSec: 3821,
        crossReferences: [crossReferenceViewFixture()],
      },
    ],
    quotes: [
      {
        quote: 'Nobody churns over a price they think is fair.',
        speaker: 'Patrick OShaughnessy',
        timestampSec: 1230,
      },
    ],
    topics: ['pricing', 'saas'],
    createdAt: '2026-08-21T10:00:00.000Z',
    ...overrides,
  }
}

export function episodeLibraryItemFixture(
  overrides: Partial<EpisodeLibraryItem> = {},
): EpisodeLibraryItem {
  return {
    episodeId: 'episode-1',
    title: 'How pricing power compounds',
    podcastTitle: 'Invest Like the Best',
    publishedAt: '2026-08-20T00:00:00.000Z',
    durationSec: 4500,
    status: 'summarized',
    failureReason: null,
    transcriptSource: 'feed_tag',
    summaryId: 'summary-1',
    matchScore: 0.71,
    confirmedByUser: false,
    ...overrides,
  }
}

export function insightSearchResultFixture(
  overrides: Partial<InsightSearchResult> = {},
): InsightSearchResult {
  return {
    insightId: 'insight-1',
    ordinal: 1,
    text: 'Pricing power shows up in retention, not in the price list.',
    context: 'Said while comparing two SaaS businesses with identical churn.',
    timestampSec: 754,
    summaryId: 'summary-1',
    episodeId: 'episode-1',
    episodeTitle: 'How pricing power compounds',
    podcastTitle: 'Invest Like the Best',
    publishedAt: '2026-08-20T00:00:00.000Z',
    crossReferences: [],
    ...overrides,
  }
}

export function settingsViewFixture(overrides: Partial<SettingsView> = {}): SettingsView {
  return {
    email: 'reader@example.com',
    weeklyDigestOptIn: true,
    interests: [
      { id: 'interest-1', text: 'pricing power', weight: 1 },
      { id: 'interest-2', text: 'AI agents in production', weight: 0.5 },
    ],
    recentDigests: [{ id: 'digest-1', weekOf: '2026-08-17', sentAt: '2026-08-24T07:00:00.000Z', episodeCount: 3 }],
    ...overrides,
  }
}
