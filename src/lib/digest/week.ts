const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS

/**
 * Midnight UTC of the Monday on/before `date`. ISO weeks start Monday (`getUTCDay() === 1`);
 * `digests.weekOf` is always this value, so two calls for any day in the same week agree.
 */
export function startOfIsoWeekUtc(date: Date): Date {
  const utcMidnight = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const isoWeekday = utcMidnight.getUTCDay() === 0 ? 7 : utcMidnight.getUTCDay() // Mon=1..Sun=7
  utcMidnight.setUTCDate(utcMidnight.getUTCDate() - (isoWeekday - 1))
  return utcMidnight
}

/** `YYYY-MM-DD`, matching the `date` column `digests.weekOf` is stored/compared as. */
export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * The `[start, end)` window of "the past week" that a digest sent on `weekOf` covers.
 * `weekOf` (a Monday) is the window's exclusive end, so an episode summarized at the exact
 * moment a digest runs is never double-counted between this week and next.
 */
export function digestWindowFor(weekOf: Date): { start: Date; end: Date } {
  return { start: new Date(weekOf.getTime() - WEEK_MS), end: weekOf }
}
