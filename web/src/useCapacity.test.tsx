import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, type InfiniteData } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { CapacityPage } from './api'
import { capacityKey, useCapacity, useWeeklyHoursEditor } from './useCapacity'

const DEE = 4

function page(weeklyHours: number, from = '2026-01-05', to = '2026-01-11'): CapacityPage {
  return {
    from,
    to,
    weeks: [from],
    people: [
      { id: DEE, name: 'Dee Okafor', weekly_hours: weeklyHours, allocated_weekday: [45], allocated_weekend: [0] },
    ],
    total: 1,
    next_cursor: null,
  }
}

function cached(weeklyHours: number, from?: string, to?: string): InfiniteData<CapacityPage, string | null> {
  return { pages: [page(weeklyHours, from, to)], pageParams: [null] }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, wrapper }
}

const weeklyHoursIn = (queryClient: QueryClient, key: readonly unknown[]) =>
  queryClient.getQueryData<InfiniteData<CapacityPage, string | null>>(key)?.pages[0].people[0].weekly_hours

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useWeeklyHoursEditor', () => {
  it('shows the new value while saving, then writes it into every cached range', async () => {
    const { queryClient, wrapper } = setup()
    const thisRange = [...capacityKey, '2026-01-05', '2026-01-11']
    const earlierRange = [...capacityKey, '2025-12-29', '2026-01-11']
    queryClient.setQueryData(thisRange, cached(40))
    queryClient.setQueryData(earlierRange, cached(40, '2025-12-29'))

    const response = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn(() => response.promise))

    const { result } = renderHook(() => useWeeklyHoursEditor(), { wrapper })
    act(() => void result.current.save(DEE, 50))

    expect(result.current.edits.get(DEE)).toEqual({ status: 'saving', hours: 50 })
    expect(weeklyHoursIn(queryClient, thisRange)).toBe(40) // not written until the server agrees

    await act(async () => response.resolve(json({ id: DEE, name: 'Dee Okafor', weekly_hours: 50 })))

    await waitFor(() => expect(result.current.edits.size).toBe(0))
    expect(weeklyHoursIn(queryClient, thisRange)).toBe(50)
    expect(weeklyHoursIn(queryClient, earlierRange)).toBe(50)
  })

  it("keeps the stored value after a failed save and reports the server's reason", async () => {
    const { queryClient, wrapper } = setup()
    const key = [...capacityKey, '2026-01-05', '2026-01-11']
    queryClient.setQueryData(key, cached(40))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'Weekly hours must be between 0 and 168.' }, 422)),
    )

    const { result } = renderHook(() => useWeeklyHoursEditor(), { wrapper })
    await act(() => result.current.save(DEE, 200))

    const edit = result.current.edits.get(DEE)
    expect(edit?.status).toBe('failed')
    expect(edit?.status === 'failed' && edit.error.message).toBe('Weekly hours must be between 0 and 168.')
    expect(edit?.status === 'failed' && edit.error.retryable).toBe(false)
    expect(weeklyHoursIn(queryClient, key)).toBe(40)
  })

  it('reloads a range whose first load was in flight during the save', async () => {
    // The manager steps to a new week, then saves before that week arrives.
    // The week's request read the old capacity before the save committed.
    const { queryClient, wrapper } = setup()
    const range = { from: '2026-01-12', to: '2026-01-18' }
    const staleLoad = deferred<Response>()
    let loads = 0

    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'PATCH') return Promise.resolve(json({ id: DEE, name: 'Dee Okafor', weekly_hours: 50 }))
        loads++
        return loads === 1 ? staleLoad.promise : Promise.resolve(json(page(50, range.from, range.to)))
      }),
    )

    const { result } = renderHook(() => ({ grid: useCapacity(range), editor: useWeeklyHoursEditor() }), { wrapper })
    await waitFor(() => expect(loads).toBe(1))

    await act(() => result.current.editor.save(DEE, 50))
    // The first request answers late, with what it read before the save.
    await act(async () => staleLoad.resolve(json(page(40, range.from, range.to))))

    await waitFor(() => expect(result.current.grid.data?.pages[0].people[0].weekly_hours).toBe(50))
    expect(loads).toBe(2)
  })
})
