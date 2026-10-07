import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  addDays,
  isoWeekNumber,
  MAX_WEEKS,
  mondayOf,
  parseISODate,
  shiftWeeks,
  today,
  weekCount,
  weekRange,
  weekStarts,
  withEnd,
  withStart,
} from './dates'

// Off-by-one-day bugs only show up away from UTC: west of it, UTC midnight is
// the previous evening; east of it, local midnight is the previous UTC day.
// Node picks up TZ changes at runtime.
describe.each(['America/Los_Angeles', 'Pacific/Auckland'])('in %s', (tz) => {
  beforeAll(() => {
    vi.stubEnv('TZ', tz)
  })
  afterAll(() => {
    vi.unstubAllEnvs()
  })

  it('is really running away from UTC', () => {
    expect(new Date(2026, 0, 5).getTimezoneOffset()).not.toBe(0)
  })

  it('finds the Monday of a week, with Sunday as its last day', () => {
    expect(mondayOf('2026-01-05')).toBe('2026-01-05')
    expect(mondayOf('2026-01-07')).toBe('2026-01-05')
    expect(mondayOf('2026-01-04')).toBe('2025-12-29')
  })

  it('adds days across DST changes and year ends', () => {
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08') // US DST starts
    expect(addDays('2026-04-04', 1)).toBe('2026-04-05') // NZ DST ends
    expect(addDays('2025-12-29', 7)).toBe('2026-01-05')
  })

  it("uses the manager's calendar date for today", () => {
    expect(today(new Date('2026-01-05T09:00:00Z'))).toBe('2026-01-05')
    const lateUtc = new Date('2026-01-05T03:00:00Z') // Sunday evening in LA
    expect(today(lateUtc)).toBe(tz === 'America/Los_Angeles' ? '2026-01-04' : '2026-01-05')
  })

  it('lists week starts for a range', () => {
    const range = weekRange('2025-12-31', '2026-01-16')
    expect(range).toEqual({ from: '2025-12-29', to: '2026-01-18' })
    expect(weekStarts(range)).toEqual(['2025-12-29', '2026-01-05', '2026-01-12'])
  })
})

describe('parseISODate', () => {
  it('rejects dates that do not exist', () => {
    expect(parseISODate('2026-02-30')).toBeNull()
    expect(parseISODate('2026-1-5')).toBeNull()
    expect(parseISODate('2026-02-28')).not.toBeNull()
  })
})

describe('isoWeekNumber', () => {
  it('puts the week of 29 Dec 2025 in week 1 of 2026', () => {
    expect(isoWeekNumber('2025-12-29')).toBe(1)
    expect(isoWeekNumber('2026-12-28')).toBe(53)
  })
})

describe('range edits', () => {
  const range = { from: '2026-01-05', to: '2026-01-25' }

  it('keeps the end when the start moves inside it', () => {
    expect(withStart(range, '2026-01-14')).toEqual({ from: '2026-01-12', to: '2026-01-25' })
  })

  it('pushes the end when the start moves past it', () => {
    expect(withStart(range, '2026-02-04')).toEqual({ from: '2026-02-02', to: '2026-02-08' })
  })

  it('pulls the start when the end moves before it', () => {
    expect(withEnd(range, '2025-12-30')).toEqual({ from: '2025-12-29', to: '2026-01-04' })
  })

  it('never exceeds the API maximum, keeping the end the manager picked', () => {
    const long = withEnd(range, '2028-06-01')
    expect(long.to).toBe('2028-06-04')
    expect(weekCount(long)).toBe(MAX_WEEKS)
  })

  it('moves by whole weeks', () => {
    expect(shiftWeeks(range, -1)).toEqual({ from: '2025-12-29', to: '2026-01-18' })
  })
})
