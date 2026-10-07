import { useEffect, useState } from 'react'
import { CapacityGrid } from './CapacityGrid'
import { RangeControls } from './RangeControls'
import { parseISODate, weekRange, type WeekRange } from './dates'

// The range the grid opens on, unless the URL says otherwise. It covers the
// seed's hand-written cases (an over-allocated week, zero capacity, weekend
// hours); a production default would be "this week and the next few".
const DEFAULT_RANGE = weekRange('2025-12-29', '2026-01-16')

function rangeFromUrl(): WeekRange {
  const params = new URLSearchParams(window.location.search)
  const from = params.get('from')
  const to = params.get('to')
  return from && to && parseISODate(from) && parseISODate(to) ? weekRange(from, to) : DEFAULT_RANGE
}

export function App() {
  const [range, setRange] = useState(rangeFromUrl)

  // Keep the range in the URL so a reload or a shared link opens the same weeks.
  useEffect(() => {
    const url = new URL(window.location.href)
    url.searchParams.set('from', range.from)
    url.searchParams.set('to', range.to)
    window.history.replaceState(null, '', url)
  }, [range])

  return (
    <main>
      <h1>Team capacity</h1>
      <RangeControls range={range} onChange={setRange} />
      <CapacityGrid from={range.from} to={range.to} />
    </main>
  )
}
