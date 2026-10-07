# Worklog

Running notes on how this got built — decisions, assumptions, dead ends, and anything
left unfinished. Append as you go; a line or two per entry is right.

---

## 2026-10-07 — data and API

- **Seed rows that look duplicated are slices.** One allocation is stored as ~14 identical rows plus a
  remainder (14 × 0.5 + 1.0 = 8 h/day). Summing is correct; de-duplicating would make everyone look idle.
- **Weekends: Mon–Fri by default, weekend split out.** 8,441 of 13,741 allocated person-weeks include
  Sat/Sun hours, and none has weekend hours alone, so they look like calendar-range artefacts rather than
  planned work. Counting them triples the over-allocated person-weeks (1,626 → 4,779). The API returns
  weekday and weekend hours separately so the UI can toggle without refetching.
- **Weeks are ISO (Mon–Sun); the requested range is widened to whole weeks.** A partial edge week would
  look under-allocated against a full week of capacity. Max 106 weeks per request.
- **Capacity is per person in the response, not per week.** `weekly_hours` has no history, so an edit
  changes every week at once (past ones too). If capacity becomes effective-dated, it moves into the
  per-week arrays.
- **Paging by (name, id) keyset, 100 per page.** A full roster × 2 years is ~1M numbers unpaged. The page
  of people is chosen first and only their assignments are aggregated.
- **Query: expand each assignment into the weeks it overlaps** (not people × weeks × assignments).
  Joining every week to every assignment cost 250 ms for 106 weeks; per-assignment expansion is 97 ms.
  The per-week weekday count is closed-form because a week-clipped span never crosses a Monday.
- **JIT disabled on the pool.** `generate_series` is always estimated at 1000 rows, which pushed plan cost
  past `jit_above_cost`; compilation took ~350 ms of a ~400 ms query that runs in ~4 ms without it.
- **Deferred — indexes.** `(person_id, start_date)` on assignments and `(name, id)` on people would
  help at production size; the schema is off-limits here.
- **Mon–Fri is a regional assumption.** Some of the roster is likely on Fri–Sat or Sun–Thu weeks; that
  needs a per-person work pattern (schema change). Deferred.
- Go tests (`docker compose run --rm --no-deps -v ./api:/src api go test ./...`) pin the numbers for
  Ana / Bo / Dee / Eli, computed independently from `seed.sql` day by day, plus paging and validation.
- **Collation.** The DB says `en_US.utf8`, but on Alpine (musl) that collation sorts by bytes, so
  "Fatima Öztürk" came after "Fatima Yilmaz". Sorting with ICU `und-x-icu` (keyset cursor too).

## 2026-10-07 — grid and editing

- **TanStack Query** for caching, aborting a superseded range, paging, and patching cached ranges; it is
  less hand-rolled state to maintain. The previous range stays on screen (dimmed, "Loading …") while the
  next loads, rather than blanking on every week step.
- **Capacity is edited on the row, not in a week cell.** `weekly_hours` has no history; editing inside a
  week would suggest a one-week change.
- **Save flow: pending value overlaid, not written into the cache.** While saving, the row shows the new
  capacity and recolours against it; editing that person is disabled until it settles. On success the
  stored value from the PATCH response is written into every cached range (no refetch: a capacity edit
  can't change allocations). On failure the overlay is dropped, so it can't roll back over another
  person's save. 4xx → server's message + Edit; network/5xx → Retry.
- **Race found while writing tests:** `refetchQueries` only cancels an in-flight fetch for a query that
  already *has data*. Step to a new week, save before it arrives → its first load (read before the save
  committed) landed on top and showed the old capacity. Fixed by cancelling then invalidating; the test
  fails against the old code.
- **Unknown outcome.** Requests time out after 15 s. With no response the save may have landed, so cached
  ranges are marked stale (reload next time shown); Retry is safe because PATCH sets an absolute value.
- **Validation lives on the server** (0–168). The client only checks it's a number (accepts `37,5`).
  To see failures: type 200 (422, server message), or `docker compose stop api` and save (the Vite proxy
  answers 502 after ~5 s → "Couldn't reach the server" + Retry).
- **Virtualised rows.** With 500 people × 104 weeks loaded (~52k cells) the weekend toggle took ~4 s and a
  week step ~2.6 s (dev build). Rendering only rows near the viewport: ~0.3 s each. Pages load as you
  scroll near the end; a failed page waits for "Try again".
- **Dates are `YYYY-MM-DD` strings with UTC arithmetic**; tests run in Los Angeles and Auckland. "This
  week" uses the manager's local calendar date. Typed dates only commit once the year is plausible
  (typing 2026 passes through 0002/0020/0202).
- **Default range** stays the starter's (29 Dec – 18 Jan) because it shows the seeded edge cases; a real
  default would be "this week + next few". The range is mirrored in the URL.

### Verification

- Every person × week from the API (500 × 83 weeks, the whole seed span) matches an independent
  day-by-day expansion of `seed.sql` in Python: 0 mismatches.
- Drove the UI in headless Chromium: slow save, saved, rejected (200), network failure → Retry, invalid
  input, slow week step, weekend toggle, paging, range load failure → Try again, API stopped, dark mode,
  two time zones. All capacity values put back to the seed afterwards.

### Deferred / known gaps

- A week step reloads the whole range from page 1; fetching only the new column would be cheaper, and a
  manager deep in the roster currently loses their place.
- An open edit is lost if its row is scrolled far enough to be virtualised away.
- No "only over-allocated" filter or sort by load: needs to be server-side to work across pages.
- Last write wins between two managers; no ETag/version on PATCH.
- Capacity has no effective dating: an edit rewrites past weeks too.
- Timings above are from the Vite dev build.
