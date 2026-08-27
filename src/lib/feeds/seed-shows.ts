/** The four real shows the v1 prototype is scoped to (spec §Evidence). */
export interface SeedShow {
  feedUrl: string
  title: string
}

export const SEED_SHOWS: SeedShow[] = [
  { feedUrl: 'https://api.substack.com/feed/podcast/10845.rss', title: "Lenny's Podcast" },
  { feedUrl: 'https://feeds.transistor.fm/acquired', title: 'Acquired' },
  { feedUrl: 'https://feeds.megaphone.fm/hubermanlab', title: 'Huberman Lab' },
  { feedUrl: 'https://feeds.megaphone.fm/CLS2859450455', title: 'Invest Like the Best' },
]
