package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"
)

// maxWeeklyHours is every hour of the week. Anything above it is a typo.
const maxWeeklyHours = 168

type updatePersonRequest struct {
	WeeklyHours *float64 `json:"weekly_hours"`
}

type person struct {
	ID          int     `json:"id"`
	Name        string  `json:"name"`
	WeeklyHours float64 `json:"weekly_hours"`
}

// handleUpdatePerson serves PATCH /api/people/{id} with {"weekly_hours": N}.
//
// It returns the stored person. The grid applies that value to every range it
// has cached; capacity is the only thing that changes, since allocations come
// from assignments.
func (s *server) handleUpdatePerson(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id < 1 {
		writeError(w, http.StatusBadRequest, "Invalid person id.")
		return
	}

	var req updatePersonRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, `Body must be {"weekly_hours": <number>}.`)
		return
	}
	if req.WeeklyHours == nil {
		writeError(w, http.StatusUnprocessableEntity, "weekly_hours is required.")
		return
	}
	if h := *req.WeeklyHours; h < 0 || h > maxWeeklyHours {
		writeError(w, http.StatusUnprocessableEntity, "Weekly hours must be between 0 and 168.")
		return
	}

	var p person
	err = s.db.QueryRow(r.Context(), `
		UPDATE people SET weekly_hours = $1
		WHERE id = $2
		RETURNING id, name, weekly_hours::float8`,
		*req.WeeklyHours, id,
	).Scan(&p.ID, &p.Name, &p.WeeklyHours)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "This person no longer exists.")
		return
	}
	if err != nil {
		log.Printf("update person %d: %v", id, err)
		writeError(w, http.StatusInternalServerError, "Could not save. Try again.")
		return
	}

	writeJSON(w, http.StatusOK, p)
}
