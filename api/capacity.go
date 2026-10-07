package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"
)

const (
	dateLayout = "2006-01-02"

	// maxWeeks bounds the cost of one request: a little over two years.
	maxWeeks = 106

	defaultPageSize = 100
	maxPageSize     = 500
)

// capacityQuery returns one row per person in the page, with allocated hours
// per week split into weekdays (Mon–Fri) and weekend days (Sat–Sun).
//
// $1 Monday of the first week, $2 number of weeks, $3/$4 keyset cursor
// (name, id) or NULL, $5 page size.
//
// Each assignment is expanded only into the weeks it overlaps, then clipped to
// that week. Because a clipped span never crosses a Monday, its weekday count
// is a plain isodow subtraction instead of a day-by-day expansion.
//
// Assignments are summed as stored. The seed splits a single allocation into
// many identical-looking rows (14 x 0.5h + 1 x 1h = 8h/day); they are slices,
// not duplicates, and must not be de-duplicated.
const capacityQuery = `
WITH page AS (
  SELECT id, name, weekly_hours
  FROM people
  WHERE $3::text IS NULL OR (name, id) > ($3::text, $4::int)
  ORDER BY name, id
  LIMIT $5
),
alloc AS (
  SELECT a.person_id, w.i,
         sum(a.hours_per_day * d.weekdays) AS weekday_hours,
         sum(a.hours_per_day * (d.days - d.weekdays)) AS weekend_hours
  FROM page p
  JOIN assignments a ON a.person_id = p.id
  CROSS JOIN LATERAL generate_series(
    (greatest(a.start_date, $1::date) - $1::date) / 7,
    (least(a.end_date, $1::date + 7 * $2::int - 1) - $1::date) / 7
  ) AS w(i)
  CROSS JOIN LATERAL (
    SELECT greatest(a.start_date, $1::date + 7 * w.i) AS s,
           least(a.end_date, $1::date + 7 * w.i + 6) AS e
  ) c
  CROSS JOIN LATERAL (
    SELECT c.e - c.s + 1 AS days,
           greatest(0, least(extract(isodow FROM c.e)::int, 5) - extract(isodow FROM c.s)::int + 1) AS weekdays
  ) d
  WHERE a.start_date < $1::date + 7 * $2::int
    AND a.end_date >= $1::date
  GROUP BY a.person_id, w.i
)
SELECT p.id, p.name, p.weekly_hours::float8,
       array_agg(coalesce(al.weekday_hours, 0)::float8 ORDER BY w.i),
       array_agg(coalesce(al.weekend_hours, 0)::float8 ORDER BY w.i)
FROM page p
CROSS JOIN generate_series(0, $2::int - 1) AS w(i)
LEFT JOIN alloc al ON al.person_id = p.id AND al.i = w.i
GROUP BY p.id, p.name, p.weekly_hours
ORDER BY p.name, p.id`

type capacityResponse struct {
	From       string           `json:"from"`  // Monday of the first week
	To         string           `json:"to"`    // Sunday of the last week
	Weeks      []string         `json:"weeks"` // Monday of each week, in order
	People     []capacityPerson `json:"people"`
	Total      int              `json:"total"`       // people in the roster, across all pages
	NextCursor *string          `json:"next_cursor"` // null on the last page
}

// capacityPerson's allocated_* arrays are hours, index-aligned with Weeks.
// Capacity is per person, not per week, because weekly_hours has no history:
// editing it changes every week at once.
type capacityPerson struct {
	ID               int       `json:"id"`
	Name             string    `json:"name"`
	WeeklyHours      float64   `json:"weekly_hours"`
	AllocatedWeekday []float64 `json:"allocated_weekday"`
	AllocatedWeekend []float64 `json:"allocated_weekend"`
}

type pageCursor struct {
	Name string `json:"n"`
	ID   int    `json:"i"`
}

// handleCapacity serves GET /api/capacity?from=YYYY-MM-DD&to=YYYY-MM-DD[&limit=N][&cursor=C]
//
// The range is widened to whole ISO weeks (Monday to Sunday), so every column
// can be compared against a full week of capacity. People are paged in name
// order; follow next_cursor for the rest of the roster.
func (s *server) handleCapacity(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	from, weeks, err := parseWeekRange(q.Get("from"), q.Get("to"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	limit := defaultPageSize
	if v := q.Get("limit"); v != "" {
		limit, err = strconv.Atoi(v)
		if err != nil || limit < 1 || limit > maxPageSize {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("limit must be between 1 and %d.", maxPageSize))
			return
		}
	}

	var after *pageCursor
	if v := q.Get("cursor"); v != "" {
		if after, err = decodeCursor(v); err != nil {
			writeError(w, http.StatusBadRequest, "Invalid cursor.")
			return
		}
	}

	var cursorName *string
	var cursorID int
	if after != nil {
		cursorName, cursorID = &after.Name, after.ID
	}

	// Fetch one extra row to learn whether another page exists.
	rows, err := s.db.Query(r.Context(), capacityQuery, from, weeks, cursorName, cursorID, limit+1)
	if err != nil {
		log.Printf("capacity query: %v", err)
		writeError(w, http.StatusInternalServerError, "Could not load capacity. Try again.")
		return
	}
	defer rows.Close()

	people := make([]capacityPerson, 0, limit+1)
	for rows.Next() {
		var p capacityPerson
		if err := rows.Scan(&p.ID, &p.Name, &p.WeeklyHours, &p.AllocatedWeekday, &p.AllocatedWeekend); err != nil {
			log.Printf("capacity scan: %v", err)
			writeError(w, http.StatusInternalServerError, "Could not load capacity. Try again.")
			return
		}
		people = append(people, p)
	}
	if err := rows.Err(); err != nil {
		log.Printf("capacity rows: %v", err)
		writeError(w, http.StatusInternalServerError, "Could not load capacity. Try again.")
		return
	}

	var next *string
	if len(people) > limit {
		people = people[:limit]
		last := people[limit-1]
		c := encodeCursor(pageCursor{Name: last.Name, ID: last.ID})
		next = &c
	}

	var total int
	if err := s.db.QueryRow(r.Context(), `SELECT count(*) FROM people`).Scan(&total); err != nil {
		log.Printf("capacity count: %v", err)
		writeError(w, http.StatusInternalServerError, "Could not load capacity. Try again.")
		return
	}

	weekStarts := make([]string, weeks)
	for i := range weekStarts {
		weekStarts[i] = from.AddDate(0, 0, 7*i).Format(dateLayout)
	}

	writeJSON(w, http.StatusOK, capacityResponse{
		From:       from.Format(dateLayout),
		To:         from.AddDate(0, 0, 7*weeks-1).Format(dateLayout),
		Weeks:      weekStarts,
		People:     people,
		Total:      total,
		NextCursor: next,
	})
}

// parseWeekRange widens [from, to] to whole ISO weeks and returns the Monday
// of the first week and the number of weeks covered. Its errors are shown to
// the manager as-is, hence full sentences.
func parseWeekRange(fromStr, toStr string) (time.Time, int, error) {
	if fromStr == "" || toStr == "" {
		return time.Time{}, 0, errors.New("Choose a start and end date.")
	}
	from, err := time.Parse(dateLayout, fromStr)
	if err != nil {
		return time.Time{}, 0, fmt.Errorf("Start date %q is not a valid date.", fromStr)
	}
	to, err := time.Parse(dateLayout, toStr)
	if err != nil {
		return time.Time{}, 0, fmt.Errorf("End date %q is not a valid date.", toStr)
	}
	if to.Before(from) {
		return time.Time{}, 0, errors.New("The end date is before the start date.")
	}

	first, last := mondayOf(from), mondayOf(to)
	weeks := int(last.Sub(first).Hours()/24)/7 + 1
	if weeks > maxWeeks {
		return time.Time{}, 0, fmt.Errorf("That range covers %d weeks; the maximum is %d.", weeks, maxWeeks)
	}
	return first, weeks, nil
}

// mondayOf returns the Monday on or before t. Dates are parsed as UTC
// midnight, so day arithmetic never crosses a DST boundary.
func mondayOf(t time.Time) time.Time {
	offset := (int(t.Weekday()) + 6) % 7 // Monday=0 … Sunday=6
	return t.AddDate(0, 0, -offset)
}

func encodeCursor(c pageCursor) string {
	b, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(b)
}

func decodeCursor(s string) (*pageCursor, error) {
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return nil, err
	}
	var c pageCursor
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, err
	}
	return &c, nil
}
