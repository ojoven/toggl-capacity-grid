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
