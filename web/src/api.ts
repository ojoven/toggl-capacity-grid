import type { ISODate } from './dates'

export type CapacityPerson = {
  id: number
  name: string
  weekly_hours: number
  // Hours, index-aligned with CapacityPage.weeks.
  allocated_weekday: number[]
  allocated_weekend: number[]
}

export type CapacityPage = {
  from: ISODate
  to: ISODate
  weeks: ISODate[]
  people: CapacityPerson[]
  total: number
  next_cursor: string | null
}

export type Person = {
  id: number
  name: string
  weekly_hours: number
}

export class ApiError extends Error {
  // null when the request never got a response.
  readonly status: number | null

  constructor(message: string, status: number | null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }

  // Worth trying the same request again; a 4xx needs a different request.
  get retryable(): boolean {
    return this.status === null || this.status >= 500
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, init)
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError("Couldn't reach the server. Check your connection and try again.", null)
  }

  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null)
    const message =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : res.status >= 500
          ? "Couldn't reach the server. Try again in a moment."
          : `Request failed (${res.status}).`
    throw new ApiError(message, res.status)
  }
  return res.json() as Promise<T>
}

export function fetchCapacity(params: {
  from: ISODate
  to: ISODate
  cursor: string | null
  signal?: AbortSignal
}): Promise<CapacityPage> {
  const query = new URLSearchParams({ from: params.from, to: params.to })
  if (params.cursor) query.set('cursor', params.cursor)
  return request(`/api/capacity?${query}`, { signal: params.signal })
}

export function updateWeeklyHours(personId: number, weeklyHours: number): Promise<Person> {
  return request(`/api/people/${personId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weekly_hours: weeklyHours }),
  })
}
