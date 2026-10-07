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
  // null when no response arrived: the request may or may not have been applied.
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

// Without a limit a hung request leaves "Saving…" on screen indefinitely.
const TIMEOUT_MS = 15_000

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout

  let res: Response
  try {
    res = await fetch(path, { ...init, signal })
  } catch (err) {
    // The caller cancelled (e.g. the manager moved on to another range).
    if (init.signal?.aborted) throw err
    if (timeout.aborted) throw new ApiError('The server took too long to respond. Try again.', null)
    throw new ApiError("Couldn't reach the server. Check your connection and try again.", null)
  }

  if (!res.ok) {
    throw new ApiError(await errorMessage(res), res.status)
  }
  return res.json() as Promise<T>
}

// 4xx messages come from the API and say what to fix. 5xx ones are worded
// here: the caller already says what failed ("Couldn't save 40 h/wk.").
async function errorMessage(res: Response): Promise<string> {
  if ([502, 503, 504].includes(res.status)) return "Couldn't reach the server. Try again in a moment."
  if (res.status >= 500) return 'Something went wrong on the server. Try again in a moment.'
  const body: unknown = await res.json().catch(() => null)
  return body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
    ? body.error
    : `Request failed (${res.status}).`
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
