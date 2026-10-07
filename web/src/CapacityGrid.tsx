import { memo, useMemo, useState } from 'react'
import type { CapacityPerson } from './api'
import { allocatedHours, formatHours, loadOf, utilisation, type Load } from './capacity'
import { formatDate, formatDayMonth, isoWeekNumber, mondayOf, today, weekStarts, type ISODate } from './dates'
import { useCapacity, useWeeklyHoursEditor, type Edit } from './useCapacity'
import { WeeklyHoursEditor } from './WeeklyHoursEditor'

type Props = {
  // Monday of the first week and Sunday of the last.
  from: ISODate
  to: ISODate
}

// CapacityGrid renders one row per person and one column per week. Each cell
// is the person's allocated hours that week against their weekly capacity;
// over-allocated cells are red and marked with ▲.
//
// Weekend hours are excluded by default (most are calendar-range artefacts in
// the data) but always shown as a "+N h wknd" note, and can be counted in.
export function CapacityGrid({ from, to }: Props) {
  const range = useMemo(() => ({ from, to }), [from, to])
  const query = useCapacity(range)
  const { edits, save, dismiss } = useWeeklyHoursEditor()
  const [includeWeekends, setIncludeWeekends] = useState(false)

  if (query.isPending) {
    return <GridSkeleton weeks={weekStarts(range)} />
  }

  if (!query.data) {
    return (
      <div className="panel panel-error" role="alert">
        <p>
          Couldn’t load capacity for {formatDate(from)} – {formatDate(to)}. {query.error?.message}
        </p>
        <button type="button" onClick={() => void query.refetch()}>
          Try again
        </button>
      </div>
    )
  }

  const { pages } = query.data
  const weeks = pages[0].weeks
  const people = pages.flatMap((page) => page.people)
  const total = pages[pages.length - 1].total
  const currentWeek = weeks.indexOf(mondayOf(today()))
  const switchingRange = query.isPlaceholderData

  return (
    <section className="capacity" aria-busy={query.isFetching}>
      <div className="toolbar">
        <label className="toggle">
          <input
            type="checkbox"
            checked={includeWeekends}
            onChange={(event) => setIncludeWeekends(event.target.checked)}
          />
          Count weekend hours
        </label>
        <Legend />
        <span className="status" role="status">
          {switchingRange
            ? `Loading ${formatDate(from)} – ${formatDate(to)}…`
            : `${people.length} of ${total} people`}
        </span>
      </div>

      {query.isRefetchError && (
        <div className="panel panel-error" role="alert">
          <p>Couldn’t refresh. You’re looking at the numbers from the last successful load.</p>
          <button type="button" onClick={() => void query.refetch()}>
            Try again
          </button>
        </div>
      )}

      <div className={switchingRange ? 'scroller stale' : 'scroller'}>
        <table className="grid">
          <thead>
            <tr>
              <th scope="col" className="col-name">
                Person
              </th>
              <th scope="col" className="col-hours">
                Capacity
              </th>
              {weeks.map((week, i) => (
                <th key={week} scope="col" className={i === currentWeek ? 'col-week current' : 'col-week'}>
                  <span className="week-date">{formatDayMonth(week)}</span>
                  <span className="week-number">W{isoWeekNumber(week)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.map((person) => (
              <PersonRow
                key={person.id}
                person={person}
                weeks={weeks}
                currentWeek={currentWeek}
                includeWeekends={includeWeekends}
                edit={edits.get(person.id)}
                onSave={save}
                onDismiss={dismiss}
              />
            ))}
          </tbody>
        </table>
        {people.length === 0 && <p className="panel">Nobody is on this team yet.</p>}
      </div>

      {query.hasNextPage && (
        <div className="more">
          {query.isFetchNextPageError && (
            <p role="alert">Couldn’t load more people. {query.error?.message}</p>
          )}
          <button
            type="button"
            disabled={query.isFetchingNextPage || switchingRange}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage
              ? 'Loading…'
              : query.isFetchNextPageError
                ? 'Try again'
                : `Show more people (${people.length} of ${total})`}
          </button>
        </div>
      )}
    </section>
  )
}

type RowProps = {
  person: CapacityPerson
  weeks: ISODate[]
  currentWeek: number
  includeWeekends: boolean
  edit: Edit | undefined
  onSave: (personId: number, hours: number) => void
  onDismiss: (personId: number) => void
}

const PersonRow = memo(function PersonRow({
  person,
  weeks,
  currentWeek,
  includeWeekends,
  edit,
  onSave,
  onDismiss,
}: RowProps) {
  // While a save is in flight, colour the row against the new capacity.
  const capacity = edit?.status === 'saving' ? edit.hours : person.weekly_hours

  return (
    <tr>
      <th scope="row" className="col-name">
        <span dir="auto">{person.name}</span>
      </th>
      <td className="col-hours">
        <WeeklyHoursEditor person={person} edit={edit} onSave={onSave} onDismiss={onDismiss} />
      </td>
      {weeks.map((week, i) => (
        <WeekCell
          key={week}
          name={person.name}
          week={week}
          current={i === currentWeek}
          allocated={allocatedHours(person, i, includeWeekends)}
          weekend={person.allocated_weekend[i] ?? 0}
          includeWeekends={includeWeekends}
          capacity={capacity}
        />
      ))}
    </tr>
  )
})

type CellProps = {
  name: string
  week: ISODate
  current: boolean
  allocated: number
  weekend: number
  includeWeekends: boolean
  capacity: number
}

function WeekCell({ name, week, current, allocated, weekend, includeWeekends, capacity }: CellProps) {
  const load = loadOf(allocated, capacity)
  const ratio = utilisation(allocated, capacity)
  const percent = ratio === null ? null : `${Math.round(ratio * 100)}%`

  const summary = [
    `${name}, week of ${formatDate(week)}: ${formatHours(allocated)} of ${formatHours(capacity)} h`,
    load === 'over' ? `over by ${formatHours(allocated - capacity)} h` : null,
    weekend > 0
      ? includeWeekends
        ? `includes ${formatHours(weekend)} h on the weekend`
        : `plus ${formatHours(weekend)} h on the weekend, not counted`
      : null,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <td className={`cell load-${load}${current ? ' current' : ''}`} title={summary}>
      <span className="visually-hidden">{summary}</span>
      <span aria-hidden="true">
        {load === 'none' ? (
          <span className="hours-allocated">–</span>
        ) : (
          <>
            <span className="hours-allocated">
              {load === 'over' && '▲ '}
              {formatHours(allocated)}h
            </span>
            <span className="percent">{percent ?? 'no capacity'}</span>
          </>
        )}
        {weekend > 0 && (
          <span className="weekend">
            {includeWeekends ? `incl. ${formatHours(weekend)}h wknd` : `+${formatHours(weekend)}h wknd`}
          </span>
        )}
        {load !== 'none' && <span className="meter" style={{ width: `${Math.min(ratio ?? 1, 1) * 100}%` }} />}
      </span>
    </td>
  )
}

function Legend() {
  const items: [Load, string][] = [
    ['under', 'Under capacity'],
    ['full', 'At capacity'],
    ['over', 'Over capacity'],
  ]
  return (
    <ul className="legend" aria-label="Legend">
      {items.map(([load, label]) => (
        <li key={load}>
          <span className={`swatch load-${load}`} aria-hidden="true" />
          {label}
        </li>
      ))}
    </ul>
  )
}

function GridSkeleton({ weeks }: { weeks: ISODate[] }) {
  return (
    <section className="capacity" aria-busy="true">
      <p className="status" role="status">
        Loading capacity…
      </p>
      <div className="scroller">
        <table className="grid skeleton">
          <thead>
            <tr>
              <th scope="col" className="col-name">
                Person
              </th>
              <th scope="col" className="col-hours">
                Capacity
              </th>
              {weeks.map((week) => (
                <th key={week} scope="col" className="col-week">
                  <span className="week-date">{formatDayMonth(week)}</span>
                  <span className="week-number">W{isoWeekNumber(week)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody aria-hidden="true">
            {Array.from({ length: 8 }, (_, row) => (
              <tr key={row}>
                <th className="col-name">
                  <span className="bar" />
                </th>
                <td className="col-hours">
                  <span className="bar" />
                </td>
                {weeks.map((week) => (
                  <td key={week} className="cell">
                    <span className="bar" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
