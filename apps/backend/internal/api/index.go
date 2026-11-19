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
	if _, ok := auth.UserFromContext(r.Context()); !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
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
