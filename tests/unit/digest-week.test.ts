import { describe, expect, it } from 'vitest'
import { digestWindowFor, formatDateOnly, startOfIsoWeekUtc } from '@/lib/digest/week'

describe('startOfIsoWeekUtc', () => {
  it('returns the same Monday for every day inside that ISO week', () => {
    const monday = startOfIsoWeekUtc(new Date('2026-08-24T00:00:00.000Z'))
    const wednesday = startOfIsoWeekUtc(new Date('2026-08-26T15:30:00.000Z'))
    const sunday = startOfIsoWeekUtc(new Date('2026-08-30T23:59:59.000Z'))

    expect(formatDateOnly(monday)).toBe('2026-08-24')
    expect(formatDateOnly(wednesday)).toBe('2026-08-24')
    expect(formatDateOnly(sunday)).toBe('2026-08-24')
  })

  it('rolls a Sunday back to the prior Monday, not forward', () => {
    const result = startOfIsoWeekUtc(new Date('2026-08-30T00:00:00.000Z'))
    expect(formatDateOnly(result)).toBe('2026-08-24')
  })
})

describe('digestWindowFor', () => {
  it('produces a 7-day [start, end) window ending at weekOf', () => {
    const weekOf = new Date('2026-08-24T00:00:00.000Z')
    const { start, end } = digestWindowFor(weekOf)

    expect(end).toEqual(weekOf)
    expect(formatDateOnly(start)).toBe('2026-08-17')
    expect(end.getTime() - start.getTime()).toBe(7 * 24 * 60 * 60 * 1000)
  })
})
