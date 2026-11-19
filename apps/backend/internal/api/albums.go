package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/memries/memries/internal/auth"
	"github.com/memries/memries/internal/db"
)

func libraryStatus(err error) int {
	if errors.Is(err, db.ErrNotFound) {
		return http.StatusNotFound
	}
	if errors.Is(err, db.ErrForbidden) {
		return http.StatusForbidden
	}
	return http.StatusBadRequest
}

func (a *API) albums(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	views, err := a.DB.ListAlbums(r.Context(), u.Key)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]interface{}{"albums": views})
}

func (a *API) createAlbum(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var body struct {
		Name string `json:"name"`
		// PhotoIDs fills the new Album in the same request, so an album made
		// from a selection is one operation rather than a create that can be
		// followed by a failed fill (ADR 0018).
		PhotoIDs []string `json:"photo_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(body.Name) == "" {
		http.Error(w, "album name is required", http.StatusBadRequest)
		return
	}
	view, err := a.DB.CreateAlbumWithPhotos(r.Context(), u.Key, body.Name, body.PhotoIDs)
	if err != nil {
		http.Error(w, err.Error(), libraryStatus(err))
		return
	}
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, view)
}

// deleteAlbums removes a selection of the reader's Albums. The Photos in them
// are untouched — an Album groups the library, it does not own it.
func (a *API) deleteAlbums(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	ids := r.URL.Query()["id"]
	if len(ids) == 0 {
		http.Error(w, "at least one album id is required", http.StatusBadRequest)
		return
	}
	deleted, err := a.DB.DeleteAlbums(r.Context(), u.Key, ids)
	if err != nil {
		http.Error(w, err.Error(), libraryStatus(err))
		return
	}
	writeJSON(w, map[string]any{"deleted": deleted})
}

func (a *API) album(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	detail, err := a.DB.GetAlbumView(r.Context(), u.Key, chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, err.Error(), libraryStatus(err))
		return
	}
	writeJSON(w, detail)
}

func (a *API) addAlbumPhoto(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	// Accepts one photo or many on the same route (ADR 0018): `photo_id` is
	// what the single-photo menu has always sent, `photo_ids` is what a
	// selection sends. Keeping one route means the album view comes back the
	// same shape either way.
	var body struct {
		PhotoID  string   `json:"photo_id"`
		PhotoIDs []string `json:"photo_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "photo_id required", http.StatusBadRequest)
		return
	}

	albumID := chi.URLParam(r, "id")
	var view *db.AlbumView
	var err error
	switch {
	case len(body.PhotoIDs) > 0:
		view, err = a.DB.AddPhotosToAlbum(r.Context(), u.Key, albumID, body.PhotoIDs)
	case strings.TrimSpace(body.PhotoID) != "":
		view, err = a.DB.AddPhotoToAlbum(r.Context(), u.Key, albumID, body.PhotoID)
	default:
		http.Error(w, "photo_id required", http.StatusBadRequest)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), libraryStatus(err))
		return
	}
	writeJSON(w, view)
}

// setFavorites favorites or unfavorites a whole selection (ADR 0018).
//
// The store scopes the update to the Owner, so a foreign id changes nothing
// and comes back as 403 rather than a partial success.
func (a *API) setFavorites(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var body struct {
		IDs      []string `json:"ids"`
		Favorite bool     `json:"favorite"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	if len(body.IDs) == 0 {
		http.Error(w, "ids required", http.StatusBadRequest)
		return
	}
	if len(body.IDs) > db.MaxBatchPhotos {
		http.Error(w, "too many photos", http.StatusBadRequest)
		return
	}
	updated, err := a.DB.SetFavorites(r.Context(), u.Key, body.IDs, body.Favorite)
	if err != nil {
		http.Error(w, err.Error(), libraryStatus(err))
		return
	}
	writeJSON(w, map[string]any{"updated": updated, "favorite": body.Favorite})
}

func (a *API) removeAlbumPhoto(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	view, err := a.DB.RemovePhotoFromAlbum(r.Context(), u.Key, chi.URLParam(r, "id"), chi.URLParam(r, "photoId"))
	if err != nil {
		http.Error(w, err.Error(), libraryStatus(err))
		return
	}
	writeJSON(w, view)
}

func (a *API) setFavorite(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var body struct {
		Favorite bool `json:"favorite"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	p, err := a.DB.SetFavorite(r.Context(), u.Key, chi.URLParam(r, "id"), body.Favorite)
	if err != nil {
		http.Error(w, err.Error(), libraryStatus(err))
		return
	}
	writeJSON(w, p)
}

func (a *API) e2eReset(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if err := a.DB.ClearOwnerAlbumsAndFavorites(r.Context(), u.Key); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"status": "ok"})
}
