import { useId, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { CapacityPerson } from './api'
import { formatHours, parseHours } from './capacity'
import type { Edit } from './useCapacity'

type Props = {
  person: CapacityPerson
  edit: Edit | undefined
  onSave: (personId: number, hours: number) => void
  onDismiss: (personId: number) => void
}

// The person's weekly hours, editable in place. Lives on the row, not in a
// week cell: weekly_hours has no history, so a change applies to every week.
export function WeeklyHoursEditor({ person, edit, onSave, onDismiss }: Props) {
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const errorId = useId()

  const saving = edit?.status === 'saving'
  const shown = saving ? edit.hours : person.weekly_hours

  function startEditing() {
    // After a failed save, start from what the manager typed so they can fix it.
    setDraft(formatHours(edit?.status === 'failed' ? edit.hours : person.weekly_hours))
    setInvalid(false)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const hours = parseHours(draft ?? '')
    if (hours === null) {
      setInvalid(true)
      return
    }
    setDraft(null)
    if (hours !== person.weekly_hours) onSave(person.id, hours)
    else if (edit) onDismiss(person.id)
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') setDraft(null)
  }

  if (draft !== null) {
    return (
      <form className="hours-form" onSubmit={submit}>
        <input
          autoFocus
          className="hours-input"
          inputMode="decimal"
          aria-label={`Weekly hours for ${person.name}`}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="submit">Save</button>
        <button type="button" onClick={() => setDraft(null)}>
          Cancel
        </button>
        {invalid && (
          <p id={errorId} className="field-error">
            Enter a number of hours.
          </p>
        )}
      </form>
    )
  }

  return (
    <div className="hours">
      <button
        type="button"
        className="hours-value"
        disabled={saving}
        onClick={startEditing}
        aria-label={`Weekly hours for ${person.name}: ${formatHours(shown)}. Edit`}
      >
        {formatHours(shown)} h/wk
        <span className={saving ? 'spinner' : 'pencil'} aria-hidden="true" />
      </button>
      {saving && (
        <span className="visually-hidden" role="status">
          Saving
        </span>
      )}
      {edit?.status === 'failed' && (
        <div className="save-error" role="alert">
          <span>
            Couldn’t save {formatHours(edit.hours)} h/wk. {edit.error.message}
          </span>
          <span className="save-error-actions">
            {edit.error.retryable && (
              <button type="button" onClick={() => onSave(person.id, edit.hours)}>
                Retry
              </button>
            )}
            <button type="button" onClick={startEditing}>
              Edit
            </button>
            <button type="button" onClick={() => onDismiss(person.id)}>
              Dismiss
            </button>
          </span>
        </div>
      )}
    </div>
  )
}
