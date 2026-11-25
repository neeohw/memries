package api

import (
	"net/http"
	"strconv"

	"github.com/memries/memries/internal/auth"
	"github.com/memries/memries/internal/db"
)

// photoSummary answers year view in one request: every year the library holds,
// with a few photos per month and the year's real total.
//
// The feed cannot do this. `/api/photos` pages newest-first from a cursor, so
// reaching a year twenty years back means pulling every photo in between —
// which is the whole reason year view needed its own shape (ADR 0031).
func (a *API) photoSummary(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	// A nonsense value is clamped rather than refused: the sample size is a
	// rendering preference, and no answer is worse than a differently sized one.
	perMonth, _ := strconv.Atoi(r.URL.Query().Get("per_month"))
	perMonth = db.ClampSummaryPerMonth(perMonth)
	years, err := a.DB.YearSummaries(r.Context(), u.Key, perMonth)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if years == nil {
		years = []db.YearSummary{}
	}
	writeJSON(w, map[string]interface{}{
		"per_month": perMonth,
		"years":     years,
	})
}
