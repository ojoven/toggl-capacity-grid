import { useCallback, useState } from 'react'
import {
  keepPreviousData,
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query'
import { ApiError, fetchCapacity, updateWeeklyHours, type CapacityPage } from './api'
import { withPerson } from './capacity'
import type { WeekRange } from './dates'

export const capacityKey = ['capacity'] as const

export function useCapacity({ from, to }: WeekRange) {
  return useInfiniteQuery({
    queryKey: [...capacityKey, from, to],
    queryFn: ({ pageParam, signal }) => fetchCapacity({ from, to, cursor: pageParam, signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    // Keep showing the previous range while the next one loads, instead of
    // blanking the grid on every week step.
    placeholderData: keepPreviousData,
  })
}

export type Edit = { status: 'saving'; hours: number } | { status: 'failed'; hours: number; error: ApiError }

// Saves a person's weekly hours.
//
// The grid shows a pending value from `edits` on top of the cached data
// rather than writing it into the cache. A failed save then only has to drop
// the edit, and can't roll back over another person's save that finished in
// the meantime. On success the stored value is written into every cached
// range, so going back to an earlier week doesn't show the old number.
export function useWeeklyHoursEditor() {
  const queryClient = useQueryClient()
  const [edits, setEdits] = useState<ReadonlyMap<number, Edit>>(new Map())

  const save = useCallback(
    async (personId: number, hours: number) => {
      setEdits((current) => new Map(current).set(personId, { status: 'saving', hours }))
      try {
        const person = await updateWeeklyHours(personId, hours)
        queryClient.setQueriesData<InfiniteData<CapacityPage, string | null>>(
          { queryKey: capacityKey },
          (data) => data && withPerson(data, person),
        )
        await restartInFlight(queryClient)
        setEdits((current) => without(current, personId))
      } catch (err) {
        const error = err instanceof ApiError ? err : new ApiError('Could not save. Try again.', null)
        if (error.status === null) {
          // No response, so the save may have landed anyway. Don't guess:
          // reload ranges from the server the next time they're shown.
          // (Retrying is safe; the PATCH sets an absolute value.)
          void queryClient.invalidateQueries({ queryKey: capacityKey, refetchType: 'none' })
        }
        setEdits((current) => new Map(current).set(personId, { status: 'failed', hours, error }))
      }
    },
    [queryClient],
  )

  const dismiss = useCallback((personId: number) => {
    setEdits((current) => without(current, personId))
  }, [])

  return { edits, save, dismiss }
}

// A range that was loading while the save ran may have read the old value,
// and would land on top of the one just written. Cancel it and load it again.
//
// refetchQueries alone is not enough: it only cancels a fetch for a query that
// already has data. A range's first load (the manager moved to a new week
// mid-save) would be joined, not restarted, and show the old capacity.
async function restartInFlight(queryClient: QueryClient) {
  const inFlight = queryClient
    .getQueryCache()
    .findAll({ queryKey: capacityKey, predicate: (query) => query.state.fetchStatus === 'fetching' })
  if (inFlight.length === 0) return
  await queryClient.cancelQueries({ queryKey: capacityKey, predicate: (query) => inFlight.includes(query) })
  void queryClient.invalidateQueries({ queryKey: capacityKey, predicate: (query) => inFlight.includes(query) })
}

function without<K, V>(map: ReadonlyMap<K, V>, key: K): ReadonlyMap<K, V> {
  if (!map.has(key)) return map
  const next = new Map(map)
  next.delete(key)
  return next
}
