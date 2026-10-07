// Dates travel as 'YYYY-MM-DD' strings and all arithmetic happens in UTC.
//
// The browser's local timezone must never touch them: new Date('2026-01-05')
// is UTC midnight, which is still Sunday 4 January in New York, and
// toISOString() on a local midnight is the previous day east of UTC.

export type ISODate = string

const DAY_MS = 24 * 60 * 60 * 1000

// Bounded by the API (one request covers at most this many weeks).
export const MAX_WEEKS = 106

export function parseISODate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(y, m - 1, d))
  // Rejects 2026-02-30, which Date.UTC would roll over to March.
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null
}

function toISODate(date: Date): ISODate {
  return date.toISOString().slice(0, 10)
}

function utc(value: ISODate): Date {
  const date = parseISODate(value)
  if (!date) throw new Error(`Invalid date: ${value}`)
  return date
}

export function addDays(value: ISODate, days: number): ISODate {
  return toISODate(new Date(utc(value).getTime() + days * DAY_MS))
}

export function mondayOf(value: ISODate): ISODate {
  const day = utc(value).getUTCDay() // Sunday=0
  return addDays(value, -((day + 6) % 7))
}

export function sundayOf(value: ISODate): ISODate {
  return addDays(mondayOf(value), 6)
}

// The manager's calendar date, which is what "this week" means to them.
export function today(now: Date = new Date()): ISODate {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function isoWeekNumber(value: ISODate): number {
  const date = utc(value)
  const thursday = new Date(date.getTime() + (3 - ((date.getUTCDay() + 6) % 7)) * DAY_MS)
  const firstOfYear = Date.UTC(thursday.getUTCFullYear(), 0, 1)
  return Math.floor((thursday.getTime() - firstOfYear) / DAY_MS / 7) + 1
}

const dayMonth = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
const dayMonthYear = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

export function formatDayMonth(value: ISODate): string {
  return dayMonth.format(utc(value))
}

export function formatDate(value: ISODate): string {
  return dayMonthYear.format(utc(value))
}

// A range of whole ISO weeks: `from` is a Monday, `to` is a Sunday.
export type WeekRange = { from: ISODate; to: ISODate }

export function weekCount({ from, to }: WeekRange): number {
  return Math.round((utc(to).getTime() - utc(from).getTime()) / DAY_MS + 1) / 7
}

export function weekStarts(range: WeekRange): ISODate[] {
  return Array.from({ length: weekCount(range) }, (_, i) => addDays(range.from, 7 * i))
}

// Widens any two dates to whole weeks. Keeps the start and clamps the end if
// the result would be longer than the API allows.
export function weekRange(from: ISODate, to: ISODate): WeekRange {
  const start = mondayOf(from <= to ? from : to)
  const end = sundayOf(from <= to ? to : from)
  return clampEnd({ from: start, to: end })
}

// The manager moved the start: keep the end where it was unless the start
// overtook it or the range became too long.
export function withStart(range: WeekRange, date: ISODate): WeekRange {
  const from = mondayOf(date)
  const to = range.to < from ? sundayOf(from) : range.to
  return clampEnd({ from, to })
}

export function withEnd(range: WeekRange, date: ISODate): WeekRange {
  const to = sundayOf(date)
  const from = range.from > to ? mondayOf(to) : range.from
  const clamped = { from, to }
  return weekCount(clamped) > MAX_WEEKS ? { from: addDays(to, -7 * MAX_WEEKS + 1), to } : clamped
}

export function shiftWeeks(range: WeekRange, weeks: number): WeekRange {
  return { from: addDays(range.from, 7 * weeks), to: addDays(range.to, 7 * weeks) }
}

// Moves the range so it starts on the current week, keeping its length.
export function startingThisWeek(range: WeekRange, now?: Date): WeekRange {
  const from = mondayOf(today(now))
  return { from, to: addDays(from, 7 * weekCount(range) - 1) }
}

function clampEnd(range: WeekRange): WeekRange {
  return weekCount(range) > MAX_WEEKS ? { from: range.from, to: addDays(range.from, 7 * MAX_WEEKS - 1) } : range
}
