# Decisions

Yours to write, not your AI's. Short is good — bullets are fine, and half a page is
plenty. We read this first.

## What did the spec not tell you?

There are things this brief doesn't specify. Which ones did you hit, what did you decide,
and why?

- The brief didn't say how to handle weeks. My decision: Monday to Friday by default, with weekend hours shown and a toggle to count them.

- Save Strategy -> optimistic:
  - The new value shows immediately, the row recolours
  - On success the new value is applied to every loaded range with no reload
  - On failure, the old value shows back, rejected value along with the user-friendly error response, with retry option for network or server errors.
  - Request times out after 15s, probably could be made a bit shorter

- Capacity: missing history
  - My decision was to accept it for now, but this would need to be a main item to handle.

## What did you notice that looked wrong?

Anything in the output that didn't match what you expected. Whether you fixed it or left
it, we want to know you saw it.

- Initially, the assignments table looked full of duplicates: same person, project and dates repeated. They are slices of an allocation that, when summed, we get a realistic hours/day number. I assume this could be how allocations are sliced / stored.
- Specific examples like Eli Nakamura: 0h capacity but 20h allocated, Dee Okafor and Ana over-allocated (Ana only if we count the weekends).

## What did the AI get wrong that you caught?

One concrete example. Every real session has one.

- The AI showed me this -> Weekends: my recommendation is to count only Monday to Friday and say so in the UI.
  - I still don't know how the usual Toggl company / users work but I assume that counting and showing weekend hours would be a necessary functionality.
  - This changed the design and the UI, what could have some small trade-offs in terms of complexity but initially I thought this made more sense.

- The AI listed a missing "only over-allocated" filter as an open issue though it was never required. It could be something to be implemented in the future but not at this scope.

## What would you do differently with a week?

- The scroll bar getting updated / jumping while scrolling was a bit of a pain to me in terms of UX.
  Easily we could size the list initially with placeholder rows and fill them with real ones as we scroll.

- Previous / Next week issues: the row list arrives inside each range's response, so changing the week rebuilds it causing re-positioning.
  We could load people separately from allocations and load weeks in week blocks (4-weeks for example).

- The missing capacity history. When changing weekly_hours, it applies to every week - also the past ones.
  - Quite common cases where a user goes part-time would have their historic over-allocation info misplaced.
  - I'd use a capacity table with "from" date per change, retrieve the capacity per week. It'd add a bit of complexity to the UI - from when, default to this week - but totally necessary.

- Two managers editing the same person's capacity
  - I'd use a last save wins approach but I'd send the value the manager saw along with the new one, and only update if it hasn't changed; otherwise return a 409 with the current value and let the manager choose. No schema change needed.
