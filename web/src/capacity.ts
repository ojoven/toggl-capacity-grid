import type { InfiniteData } from '@tanstack/react-query'
import type { CapacityPage, CapacityPerson, Person } from './api'

export type Load = 'none' | 'under' | 'full' | 'over'

export function allocatedHours(person: CapacityPerson, week: number, includeWeekends: boolean): number {
  const weekday = person.allocated_weekday[week] ?? 0
  return includeWeekends ? weekday + (person.allocated_weekend[week] ?? 0) : weekday
}

// Exactly at capacity is "full", not "over". Allocations sum stored decimals
// (0.375, 0.3125 …), so compare with a tolerance rather than ===.
export function loadOf(allocated: number, capacity: number): Load {
  const EPSILON = 1e-6
  if (allocated < EPSILON) return 'none'
  if (allocated > capacity + EPSILON) return 'over'
  if (allocated > capacity - EPSILON) return 'full'
  return 'under'
}

// null when there is no capacity to divide by.
export function utilisation(allocated: number, capacity: number): number | null {
  return capacity > 0 ? allocated / capacity : null
}

// Applies a saved person to one cached range. Returns the same object when the
// person is not in it, so untouched queries don't re-render.
export function withPerson(
  data: InfiniteData<CapacityPage, string | null>,
  person: Person,
): InfiniteData<CapacityPage, string | null> {
  let changed = false
  const pages = data.pages.map((page) => {
    const index = page.people.findIndex((p) => p.id === person.id)
    if (index === -1) return page
    changed = true
    const people = page.people.slice()
    people[index] = { ...people[index], name: person.name, weekly_hours: person.weekly_hours }
    return { ...page, people }
  })
  return changed ? { ...data, pages } : data
}

const hoursFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

export function formatHours(hours: number): string {
  return hoursFormat.format(hours)
}

// Accepts "32", "37.5" and "37,5" (decimal comma). Returns null otherwise;
// range checks are the API's job.
export function parseHours(input: string): number | null {
  const normalised = input.trim().replace(',', '.')
  if (!/^-?\d+(\.\d+)?$|^-?\.\d+$/.test(normalised)) return null
  return Number(normalised)
}
