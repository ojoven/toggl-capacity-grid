import { useEffect, useState } from 'react'
import {
  formatDate,
  MAX_WEEKS,
  parseISODate,
  shiftWeeks,
  startingThisWeek,
  weekCount,
  withEnd,
  withStart,
  type ISODate,
  type WeekRange,
} from './dates'

type Props = {
  range: WeekRange
  onChange: (range: WeekRange) => void
}

export function RangeControls({ range, onChange }: Props) {
  const weeks = weekCount(range)
  return (
    <div className="range-controls">
      <div className="range-step" role="group" aria-label="Move by one week">
        <button type="button" onClick={() => onChange(shiftWeeks(range, -1))}>
          ‹ Previous week
        </button>
        <button type="button" onClick={() => onChange(startingThisWeek(range))}>
          This week
        </button>
        <button type="button" onClick={() => onChange(shiftWeeks(range, 1))}>
          Next week ›
        </button>
      </div>
      <DateField label="From" value={range.from} onCommit={(date) => onChange(withStart(range, date))} />
      <DateField label="To" value={range.to} onCommit={(date) => onChange(withEnd(range, date))} />
      <p className="range-summary">
        {formatDate(range.from)} – {formatDate(range.to)} · {weeks} {weeks === 1 ? 'week' : 'weeks'}
        <span className="range-hint">Ranges snap to whole weeks, Monday to Sunday (max {MAX_WEEKS}).</span>
      </p>
    </div>
  )
}

// A native date input that only reports dates worth loading. Typing a year
// digit by digit passes through 0002, 0020 and 0202 on the way to 2026; each
// would otherwise move the range and start a request.
function DateField({ label, value, onCommit }: { label: string; value: ISODate; onCommit: (date: ISODate) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])

  return (
    <label className="date-field">
      {label}
      <input
        type="date"
        value={draft}
        onChange={(event) => {
          const next = event.target.value
          setDraft(next)
          if (isPlausible(next)) onCommit(next)
        }}
        onBlur={() => setDraft(value)}
      />
    </label>
  )
}

function isPlausible(value: string): boolean {
  const date = parseISODate(value)
  return date !== null && date.getUTCFullYear() >= 2000 && date.getUTCFullYear() < 2100
}
