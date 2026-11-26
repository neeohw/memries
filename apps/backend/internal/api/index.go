package api

import (
	"net/http"

	"github.com/memries/memries/internal/auth"
)

func (a *API) indexStatus(w http.ResponseWriter, r *http.Request) {
	if _, ok := auth.UserFromContext(r.Context()); !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if a.Index == nil {
		http.Error(w, "index unavailable", http.StatusServiceUnavailable)
		return
	}
	s, err := a.Index.Status(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, s)
}

func (a *API) startIndex(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	// Starting a run is an admin action. It walks every Source and renders
	// thumbnails for whatever it finds, which on a single-board computer is
	// minutes of the machine — not something a reader opening the timeline
	// should be able to set off, and no longer something the interface asks
	// for on their behalf (ADR 0004).
	//
	// Checked here rather than through requireAdmin: that middleware also
	// refuses when no Source store is configured, which is the right answer
	// for the Sources routes and the wrong one for this.
	if a.IsAdmin == nil || !a.IsAdmin(u.Email) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	if a.Index == nil {
		http.Error(w, "index unavailable", http.StatusServiceUnavailable)
		return
	}
	s, err := a.Index.Start(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusAccepted)
	writeJSON(w, s)
}

// stopIndex ends the run in flight.
//
// Admin-only for the same reason starting is: one reader should not be able to
// cut short a scan someone else asked for. Stopping when nothing is running is
// not an error — the current status comes back and pressing it twice is
// harmless (ADR 0004).
func (a *API) stopIndex(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if a.IsAdmin == nil || !a.IsAdmin(u.Email) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	if a.Index == nil {
		http.Error(w, "index unavailable", http.StatusServiceUnavailable)
		return
	}
	s, err := a.Index.Stop(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, s)
}
