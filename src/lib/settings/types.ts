/** What settings shows and what it can change, in one serializable shape. */

export interface InterestView {
  id: string
  text: string
  weight: number
}

export interface DigestView {
  id: string
  /** Monday of the digest week, `YYYY-MM-DD`. */
  weekOf: string
  sentAt: string | null
  episodeCount: number
}

export interface SettingsView {
  email: string
  /**
   * Whether the weekly digest job should include this user. Stored per user rather than
   * inferred from activity: "stop emailing me" has to be a decision the reader can make,
   * not a side effect of not reading.
   */
  weeklyDigestOptIn: boolean
  interests: InterestView[]
  recentDigests: DigestView[]
}
