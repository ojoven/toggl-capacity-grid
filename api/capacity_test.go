package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"slices"
	"strings"
	"testing"
)

func TestParseWeekRange(t *testing.T) {
	tests := []struct {
		name, from, to string
		wantFrom       string
		wantWeeks      int
		wantErr        bool
	}{
		{name: "already whole weeks", from: "2025-12-29", to: "2026-01-11", wantFrom: "2025-12-29", wantWeeks: 2},
		{name: "mid-week ends widen to Monday..Sunday", from: "2025-12-31", to: "2026-01-16", wantFrom: "2025-12-29", wantWeeks: 3},
		{name: "Sunday belongs to the week before", from: "2026-01-04", to: "2026-01-04", wantFrom: "2025-12-29", wantWeeks: 1},
		{name: "single day", from: "2026-01-07", to: "2026-01-07", wantFrom: "2026-01-05", wantWeeks: 1},
		{name: "across a DST change", from: "2026-03-23", to: "2026-04-05", wantFrom: "2026-03-23", wantWeeks: 2},
		{name: "maximum range", from: "2025-01-06", to: "2027-01-17", wantFrom: "2025-01-06", wantWeeks: maxWeeks},
		{name: "too long", from: "2025-01-06", to: "2027-01-18", wantErr: true},
		{name: "reversed", from: "2026-01-12", to: "2026-01-05", wantErr: true},
		{name: "missing", from: "", to: "2026-01-05", wantErr: true},
		{name: "not a date", from: "2026-02-30", to: "2026-03-01", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			from, weeks, err := parseWeekRange(tt.from, tt.to)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("want error, got from=%s weeks=%d", from.Format(dateLayout), weeks)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got := from.Format(dateLayout); got != tt.wantFrom || weeks != tt.wantWeeks {
				t.Errorf("got %s x %d weeks, want %s x %d", got, weeks, tt.wantFrom, tt.wantWeeks)
			}
		})
	}
}

// The tests below run the real SQL against the seeded database. Run them with
//
//	docker compose run --rm --no-deps -v ./api:/src api go test ./...
func testServer(t *testing.T) http.Handler {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set; skipping database tests")
	}
	db, err := newPool(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	return (&server{db: db}).routes()
}

func getCapacity(t *testing.T, h http.Handler, query url.Values) capacityResponse {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/capacity?"+query.Encode(), nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/capacity?%s: %d %s", query.Encode(), rec.Code, rec.Body)
	}
	var res capacityResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	return res
}

// Expected values were computed independently from seed.sql by expanding
// every assignment day by day.
func TestCapacityKnownPeople(t *testing.T) {
	h := testServer(t)
	res := getCapacity(t, h, url.Values{"from": {"2025-12-29"}, "to": {"2026-01-16"}, "limit": {"500"}})

	wantWeeks := []string{"2025-12-29", "2026-01-05", "2026-01-12"}
	if strings.Join(res.Weeks, ",") != strings.Join(wantWeeks, ",") || res.To != "2026-01-18" {
		t.Fatalf("weeks = %v to %s, want %v to 2026-01-18", res.Weeks, res.To, wantWeeks)
	}

	byID := map[int]capacityPerson{}
	for _, p := range res.People {
		byID[p.ID] = p
	}

	tests := []struct {
		id               int
		why              string
		weekly           float64
		weekday, weekend []float64
	}{
		{1, "Mon–Sun assignment: 8h on the weekend too", 40, []float64{40, 0, 30}, []float64{16, 0, 0}},
		{2, "Fri–Mon assignment straddles two weeks", 40, []float64{0, 32, 8}, []float64{0, 16, 0}},
		{4, "overlapping assignments: over-allocated", 40, []float64{0, 45, 40}, []float64{0, 0, 0}},
		{5, "zero capacity with allocation", 0, []float64{0, 20, 0}, []float64{0, 0, 0}},
	}
	for _, tt := range tests {
		p, ok := byID[tt.id]
		if !ok {
			t.Errorf("person %d missing", tt.id)
			continue
		}
		if p.WeeklyHours != tt.weekly ||
			!slices.Equal(p.AllocatedWeekday, tt.weekday) || !slices.Equal(p.AllocatedWeekend, tt.weekend) {
			t.Errorf("person %d (%s) %s: got weekly=%v weekday=%v weekend=%v, want %v %v %v",
				tt.id, p.Name, tt.why, p.WeeklyHours, p.AllocatedWeekday, p.AllocatedWeekend,
				tt.weekly, tt.weekday, tt.weekend)
		}
	}
}

func TestCapacityPagesCoverRosterOnce(t *testing.T) {
	h := testServer(t)
	q := url.Values{"from": {"2026-01-05"}, "to": {"2026-01-05"}, "limit": {"150"}}

	seen := map[int]bool{}
	pages := 0
	for {
		res := getCapacity(t, h, q)
		pages++
		for _, p := range res.People {
			if seen[p.ID] {
				t.Fatalf("person %d appears on more than one page", p.ID)
			}
			seen[p.ID] = true
		}
		if res.NextCursor == nil {
			if len(seen) != res.Total {
				t.Fatalf("paged through %d people, total says %d", len(seen), res.Total)
			}
			break
		}
		if pages > 10 {
			t.Fatal("pagination does not terminate")
		}
		q.Set("cursor", *res.NextCursor)
	}
}

func TestCapacityRejectsBadInput(t *testing.T) {
	h := testServer(t)
	for _, query := range []string{
		"from=2026-01-12&to=2026-01-05",
		"from=2026-01-05",
		"from=2026-01-05&to=2026-01-05&limit=0",
		"from=2026-01-05&to=2026-01-05&cursor=%25%25",
	} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/capacity?"+query, nil))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: got %d, want 400", query, rec.Code)
		}
	}
}

func TestUpdatePerson(t *testing.T) {
	h := testServer(t)
	patch := func(path, body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodPatch, path, strings.NewReader(body)))
		return rec
	}

	for _, tt := range []struct {
		path, body string
		want       int
	}{
		{"/api/people/3", `{"weekly_hours": 200}`, http.StatusUnprocessableEntity},
		{"/api/people/3", `{"weekly_hours": -1}`, http.StatusUnprocessableEntity},
		{"/api/people/3", `{}`, http.StatusUnprocessableEntity},
		{"/api/people/3", `{"weekly_hours": "40"}`, http.StatusBadRequest},
		{"/api/people/3", `{"weekly_hours": 40, "name": "x"}`, http.StatusBadRequest},
		{"/api/people/abc", `{"weekly_hours": 40}`, http.StatusBadRequest},
		{"/api/people/999999", `{"weekly_hours": 40}`, http.StatusNotFound},
	} {
		if rec := patch(tt.path, tt.body); rec.Code != tt.want {
			t.Errorf("PATCH %s %s: got %d %s, want %d", tt.path, tt.body, rec.Code, rec.Body, tt.want)
		}
	}

	// Writes Cem's seeded value back, so the database is unchanged afterwards.
	rec := patch("/api/people/3", `{"weekly_hours": 20}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("got %d %s", rec.Code, rec.Body)
	}
	var p person
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatal(err)
	}
	if p != (person{ID: 3, Name: "Cem Aydin", WeeklyHours: 20}) {
		t.Errorf("got %+v", p)
	}
}
