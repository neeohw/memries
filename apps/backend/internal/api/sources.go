package api

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/memries/memries/internal/auth"
	"github.com/memries/memries/internal/db"
	"github.com/memries/memries/internal/index"
	"github.com/memries/memries/internal/sources"
)

// SourceAdmin manages the folders that feed Owners' libraries.
type SourceAdmin interface {
	List(ctx context.Context) ([]sources.View, error)
	Create(ctx context.Context, in sources.Input) (sources.View, error)
	Update(ctx context.Context, id string, in sources.Input) (sources.View, error)
	Remove(ctx context.Context, id string) (sources.View, error)
	// Preview is the dry run: what a scan of this form's folder would find,
	// writing nothing. id is "" for a folder being added (ADR 0027).
	Preview(ctx context.Context, id string, in sources.Input) (sources.Preview, error)
}

// Rescanner queues an Index run for an Owner whose Sources changed.
type Rescanner interface {
	Rescan(ctx context.Context) (index.Status, error)
}

func (a *API) adminRoutes(r chi.Router) {
	r.Use(a.requireAdmin)
	r.Get("/sources", a.listSources)
	r.Post("/sources", a.createSource)
	r.Put("/sources/{id}", a.updateSource)
	r.Delete("/sources/{id}", a.deleteSource)
	r.Post("/sources/{id}/scan", a.scanSource)
	// Two routes, one handler: a dry run of a folder being added has no id,
	// and one of a folder being edited needs it to recover a stored password.
	r.Post("/sources/preview", a.previewSource)
	r.Post("/sources/{id}/preview", a.previewSource)
}

func (a *API) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, ok := auth.UserFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if a.IsAdmin == nil || !a.IsAdmin(u.Email) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		if a.Sources == nil {
			http.Error(w, "sources unavailable", http.StatusServiceUnavailable)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *API) listSources(w http.ResponseWriter, r *http.Request) {
	list, err := a.Sources.List(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	// The roots travel with the list because the form that needs them lives
	// on this page: the folder field is relative to one of these.
	roots := a.SourceRoots
	if roots == nil {
		roots = []string{}
	}
	writeJSON(w, map[string]interface{}{"sources": list, "roots": roots})
}

func (a *API) createSource(w http.ResponseWriter, r *http.Request) {
	in, ok := readSourceInput(w, r)
	if !ok {
		return
	}
	v, err := a.Sources.Create(r.Context(), in)
	if err != nil {
		writeSourceError(w, err)
		return
	}
	a.rescan(r.Context(), v)
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, v)
}

func (a *API) updateSource(w http.ResponseWriter, r *http.Request) {
	in, ok := readSourceInput(w, r)
	if !ok {
		return
	}
	v, err := a.Sources.Update(r.Context(), chi.URLParam(r, "id"), in)
	if err != nil {
		writeSourceError(w, err)
		return
	}
	a.rescan(r.Context(), v)
	writeJSON(w, v)
}

func (a *API) deleteSource(w http.ResponseWriter, r *http.Request) {
	v, err := a.Sources.Remove(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeSourceError(w, err)
		return
	}
	// The follow-up run prunes Photos whose Source is gone.
	a.rescan(r.Context(), v)
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) scanSource(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	list, err := a.Sources.List(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	for _, v := range list {
		if v.ID == id {
			a.rescan(r.Context(), v)
			w.WriteHeader(http.StatusAccepted)
			writeJSON(w, v)
			return
		}
	}
	http.Error(w, "not found", http.StatusNotFound)
}

// previewSource answers what a scan would find. It is a POST because it
// carries the unsaved form, not because it changes anything: nothing is
// written, so it is safe to repeat.
func (a *API) previewSource(w http.ResponseWriter, r *http.Request) {
	in, ok := readSourceInput(w, r)
	if !ok {
		return
	}
	p, err := a.Sources.Preview(r.Context(), chi.URLParam(r, "id"), in)
	if err != nil {
		writeSourceError(w, err)
		return
	}
	writeJSON(w, p)
}

func (a *API) rescan(ctx context.Context, v sources.View) {
	if a.Rescan == nil {
		return
	}
	if _, err := a.Rescan.Rescan(context.WithoutCancel(ctx)); err != nil {
		slog.Warn("rescan after source change", "source", v.ID, "err", err)
	}
}

func readSourceInput(w http.ResponseWriter, r *http.Request) (sources.Input, bool) {
	var in sources.Input
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return in, false
	}
	return in, true
}

func writeSourceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, sources.ErrInvalid):
		http.Error(w, err.Error(), http.StatusBadRequest)
	case errors.Is(err, db.ErrNotFound):
		http.Error(w, "not found", http.StatusNotFound)
	default:
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}
