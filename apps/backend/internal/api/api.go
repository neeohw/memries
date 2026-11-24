package api

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/memries/memries/internal/auth"
	"github.com/memries/memries/internal/db"
	"github.com/memries/memries/internal/index"
	"github.com/memries/memries/internal/sources"
	"github.com/memries/memries/internal/storage"
	"github.com/memries/memries/internal/thumb"
)

type API struct {
	DB Library
	// Store reads Originals indexed before Sources existed (backend "local").
	Store storage.Storage
	// SourceStore reads Originals under admin-managed Sources (backend "source").
	SourceStore storage.Storage
	Thumb       *thumb.Generator
	Index       *index.Coordinator
	Sources     SourceAdmin
	Rescan      Rescanner
	IsAdmin     func(email string) bool
	// Settings holds the server-wide settings an admin can change (ADR 0022).
	Settings SettingsStore
	// CacheRoots are the directories the thumbnail cache may be moved under.
	CacheRoots []string
	// SourceRoots are the directories a local Source may sit under
	// (MEMRIES_LOCAL_ROOT plus MEMRIES_SOURCE_ROOTS). The admin UI shows the
	// root as a fixed prefix on the folder form, so a path outside it is
	// unreachable rather than rejected after the fact (ADR 0013).
	SourceRoots []string
	// DefaultThumbnailRoot is MEMRIES_CACHE_ROOT, the install default a
	// stored choice overrides.
	DefaultThumbnailRoot string
	E2E                  bool
}

func (a *API) Routes(r chi.Router) {
	r.Get("/timeline", a.timeline)
	r.Get("/photos", a.photos)
	r.Get("/photos/{id}", a.photo)
	// Batch route before the single one is not required by chi, which matches
	// on segment count, but keeps the pair readable (ADR 0018).
	r.Put("/photos/favorite", a.setFavorites)
	r.Put("/photos/{id}/favorite", a.setFavorite)
	r.Get("/albums", a.albums)
	r.Post("/albums", a.createAlbum)
	// Ids travel as repeated query parameters rather than a body: a DELETE
	// body is legal but proxies are allowed to drop it, and albums are few
	// enough that a URL holds them comfortably.
	r.Delete("/albums", a.deleteAlbums)
	r.Get("/albums/{id}", a.album)
	r.Post("/albums/{id}/photos", a.addAlbumPhoto)
	r.Delete("/albums/{id}/photos/{photoId}", a.removeAlbumPhoto)
	r.Get("/thumb/{id}", a.thumb)
	r.Get("/original/{id}", a.original)
	r.Get("/index/status", a.indexStatus)
	r.Post("/index", a.startIndex)
	r.Route("/admin", a.adminRoutes)
	if a.E2E {
		r.Post("/e2e/reset", a.e2eReset)
	}
}

func (a *API) timeline(w http.ResponseWriter, r *http.Request) {
	if _, ok := auth.UserFromContext(r.Context()); !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	q := r.URL.Query()
	g := q.Get("granularity")
	switch g {
	case "year", "month", "week", "day":
	default:
		g = "month"
	}
	from, to, err := parseRange(q.Get("from"), q.Get("to"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	buckets, err := a.DB.Timeline(r.Context(), g, from, to)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]interface{}{
		"granularity": g,
		"from":        from,
		"to":          to,
		"buckets":     buckets,
	})
}

func (a *API) photos(w http.ResponseWriter, r *http.Request) {
	// The library is the same for everyone; the reader decides only which
	// photos come back favorited (ADR 0020).
	u, ok := auth.UserFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	q := r.URL.Query()
	from, to, err := parseRange(q.Get("from"), q.Get("to"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	limit, _ := strconv.Atoi(q.Get("limit"))
	cursor := q.Get("cursor")
	photos, next, err := a.DB.PhotosFiltered(r.Context(), u.Key, from, to, limit, cursor, parsePhotoFilter(q))
	if err != nil {
		if errors.Is(err, db.ErrBadCursor) {
			http.Error(w, "bad cursor", http.StatusBadRequest)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]interface{}{
		"photos":      photos,
		"next_cursor": next,
	})
}

func (a *API) photo(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	id := chi.URLParam(r, "id")
	p, err := a.DB.GetPhoto(r.Context(), u.Key, id)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	writeJSON(w, p)
}

func (a *API) thumb(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	id := chi.URLParam(r, "id")
	size := r.URL.Query().Get("size")
	if size == "" {
		size = "256"
	}
	p, err := a.DB.GetPhoto(r.Context(), u.Key, id)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	var rel string
	switch size {
	case "256":
		rel = p.Thumbs.S256
	case "512":
		rel = p.Thumbs.S512
	case "1024":
		rel = p.Thumbs.S1024
	default:
		http.Error(w, "bad size", http.StatusBadRequest)
		return
	}
	if rel == "" {
		http.Error(w, "no thumb", http.StatusNotFound)
		return
	}
	f, err := a.Thumb.Open(rel)
	if err != nil {
		if storage.IsNotFound(err) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		http.Error(w, "open thumb", http.StatusInternalServerError)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	_, _ = io.Copy(w, f)
}

func (a *API) original(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	id := chi.URLParam(r, "id")
	p, err := a.DB.GetPhoto(r.Context(), u.Key, id)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	// An original a browser cannot display was given a JPEG rendition at
	// index time, and its presence is the whole rule — the server never
	// decodes an image, which is what keeps it a pure-Go build (ADR 0025).
	if p.Thumbs.S2048 != "" {
		f, err := a.Thumb.Open(p.Thumbs.S2048)
		if err == nil {
			defer f.Close()
			w.Header().Set("Content-Type", "image/jpeg")
			w.Header().Set("Cache-Control", "private, max-age=86400")
			_, _ = io.Copy(w, f)
			return
		}
		// Fall through to the original rather than 404: Safari can show it,
		// and a missing rendition is a cache problem, not a missing photo.
		slog.Warn("open display rendition", "id", id, "rel", p.Thumbs.S2048, "err", err)
	}

	store := a.Store
	if p.Storage.Backend == sources.Backend && a.SourceStore != nil {
		store = a.SourceStore
	}
	rc, err := store.Get(r.Context(), p.Storage.Path)
	ctype := p.MIME
	if err != nil {
		slog.Warn("open original", "id", id, "path", p.Storage.Path, "err", err)
		// Largest rendition that actually opens, rather than the largest one
		// recorded: a catalog row can name a rendition the cache no longer
		// holds, and a smaller image beats a 500.
		for _, rel := range thumbCandidates(p.Thumbs) {
			f, terr := a.Thumb.Open(rel)
			if terr != nil {
				slog.Warn("open original thumb fallback", "id", id, "rel", rel, "err", terr)
				continue
			}
			rc = f
			ctype = "image/jpeg"
			break
		}
		if rc == nil {
			status := mediaOpenStatus(err)
			http.Error(w, originalErrorBody(status), status)
			return
		}
	}
	defer rc.Close()
	if ctype != "" {
		w.Header().Set("Content-Type", ctype)
	}
	w.Header().Set("Cache-Control", "private, max-age=86400")
	_, _ = io.Copy(w, rc)
}

func parseRange(fromStr, toStr string) (time.Time, time.Time, error) {
	from := time.Time{}
	to := time.Date(2100, 1, 1, 0, 0, 0, 0, time.UTC)
	if fromStr != "" {
		t, err := parseFlexTime(fromStr)
		if err != nil {
			return time.Time{}, time.Time{}, errors.New("bad from")
		}
		from = t
	}
	// An omitted `from` stays the zero time, not 1970: Unix time is an
	// encoding, not a product floor, and scanned film carries an EXIF
	// DateTimeOriginal from decades before the epoch. The ceiling stays finite
	// so a camera clock set to 2200 cannot stretch the timeline (ADR 0005).
	if toStr != "" {
		t, err := parseFlexTime(toStr)
		if err != nil {
			return time.Time{}, time.Time{}, errors.New("bad to")
		}
		to = t
	}
	return from, to, nil
}

func parseFlexTime(s string) (time.Time, error) {
	layouts := []string{time.RFC3339Nano, time.RFC3339, "2006-01-02", "2006-01", "2006"}
	for _, l := range layouts {
		if t, err := time.Parse(l, s); err == nil {
			return t.UTC(), nil
		}
	}
	return time.Time{}, errors.New("bad time")
}

func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
