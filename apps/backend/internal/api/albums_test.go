package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/memries/memries/internal/auth"
	"github.com/memries/memries/internal/db"
)

type fakeLibrary struct {
	photos     map[string]*db.Photo
	albums     map[string]*db.AlbumView
	albumOwner map[string]string
	filter     db.PhotoFilter
	listed     bool
	resetFor   string
}

func (f *fakeLibrary) GetPhoto(_ context.Context, _, key string) (*db.Photo, error) {
	p, ok := f.photos[key]
	if !ok {
		return nil, db.ErrNotFound
	}
	cp := *p
	return &cp, nil
}

func (f *fakeLibrary) PhotosFiltered(_ context.Context, _ string, _, _ time.Time, _ int, _ string, filter db.PhotoFilter) ([]db.Photo, string, error) {
	f.filter = filter
	out := make([]db.Photo, 0, len(f.photos))
	for _, p := range f.photos {
		out = append(out, *p)
	}
	return out, "", nil
}

func (f *fakeLibrary) Timeline(context.Context, string, time.Time, time.Time) ([]db.Bucket, error) {
	return nil, nil
}

func (f *fakeLibrary) SetFavorite(_ context.Context, _, photoID string, favorite bool) (*db.Photo, error) {
	p, ok := f.photos[photoID]
	if !ok {
		return nil, db.ErrNotFound
	}
	p.Favorite = favorite
	cp := *p
	return &cp, nil
}

func (f *fakeLibrary) ListAlbums(context.Context, string) ([]db.AlbumView, error) {
	f.listed = true
	out := make([]db.AlbumView, 0, len(f.albums))
	for _, a := range f.albums {
		out = append(out, *a)
	}
	return out, nil
}

func (f *fakeLibrary) CreateAlbum(_ context.Context, ownerID, name string) (*db.AlbumView, error) {
	view := &db.AlbumView{ID: "album-1", Name: name, CreatedAt: time.Date(2026, 8, 25, 0, 0, 0, 0, time.UTC), PhotoIDs: []string{}}
	if f.albums == nil {
		f.albums = map[string]*db.AlbumView{}
	}
	if f.albumOwner == nil {
		f.albumOwner = map[string]string{}
	}
	f.albums[view.ID] = view
	f.albumOwner[view.ID] = ownerID
	return view, nil
}

// Mirrors the store's all-or-nothing rule: one id the reader does not own and
// nothing is deleted at all.
func (f *fakeLibrary) DeleteAlbums(_ context.Context, ownerID string, albumIDs []string) (int, error) {
	for _, id := range albumIDs {
		if _, ok := f.albums[id]; !ok || f.albumOwner[id] != ownerID {
			return 0, db.ErrForbidden
		}
	}
	for _, id := range albumIDs {
		delete(f.albums, id)
		delete(f.albumOwner, id)
	}
	return len(albumIDs), nil
}

// Mirrors the store's all-or-nothing rule: one unusable id and no album is
// created at all, rather than an empty one the reader did not ask for.
func (f *fakeLibrary) CreateAlbumWithPhotos(ctx context.Context, ownerID, name string, photoIDs []string) (*db.AlbumView, error) {
	for _, id := range photoIDs {
		if _, ok := f.photos[id]; !ok {
			return nil, db.ErrForbidden
		}
	}
	view, err := f.CreateAlbum(ctx, ownerID, name)
	if err != nil {
		return nil, err
	}
	for _, id := range photoIDs {
		if _, err := f.AddPhotoToAlbum(ctx, ownerID, view.ID, id); err != nil {
			return nil, err
		}
	}
	return view, nil
}

func (f *fakeLibrary) GetAlbumView(_ context.Context, ownerID, albumID string) (*db.AlbumDetail, error) {
	album, ok := f.albums[albumID]
	if !ok {
		return nil, db.ErrNotFound
	}
	if f.albumOwner[albumID] != ownerID {
		return nil, db.ErrForbidden
	}
	photos := []db.Photo{}
	for _, id := range album.PhotoIDs {
		if p, ok := f.photos[id]; ok {
			photos = append(photos, *p)
		}
	}
	return &db.AlbumDetail{AlbumView: *album, Photos: photos}, nil
}

func (f *fakeLibrary) AddPhotoToAlbum(_ context.Context, _, albumID, photoID string) (*db.AlbumView, error) {
	album, ok := f.albums[albumID]
	if !ok {
		return nil, db.ErrNotFound
	}
	if _, ok := f.photos[photoID]; !ok {
		return nil, db.ErrNotFound
	}
	for _, id := range album.PhotoIDs {
		if id == photoID {
			return album, nil
		}
	}
	album.PhotoIDs = append(album.PhotoIDs, photoID)
	album.PhotoCount = len(album.PhotoIDs)
	album.CoverPhotoID = album.PhotoIDs[0]
	return album, nil
}

// The batch fakes below mirror the real store's all-or-nothing rule on
// purpose. A fake that applied the valid half of a batch would be more
// permissive than production and would hide exactly the bug these handlers
// exist to prevent.

func (f *fakeLibrary) AddPhotosToAlbum(ctx context.Context, ownerID, albumID string, photoIDs []string) (*db.AlbumView, error) {
	if _, ok := f.albums[albumID]; !ok {
		return nil, db.ErrNotFound
	}
	if f.albumOwner[albumID] != ownerID {
		return nil, db.ErrForbidden
	}
	// All or nothing, like the store: one id that is not a live photo adds
	// none of them.
	for _, id := range photoIDs {
		if _, ok := f.photos[id]; !ok {
			return nil, db.ErrForbidden
		}
	}
	var view *db.AlbumView
	var err error
	for _, id := range photoIDs {
		if view, err = f.AddPhotoToAlbum(ctx, ownerID, albumID, id); err != nil {
			return nil, err
		}
	}
	return view, nil
}

func (f *fakeLibrary) SetFavorites(_ context.Context, _ string, photoIDs []string, favorite bool) (int, error) {
	for _, id := range photoIDs {
		if _, ok := f.photos[id]; !ok {
			return 0, db.ErrForbidden
		}
	}
	for _, id := range photoIDs {
		f.photos[id].Favorite = favorite
	}
	return len(photoIDs), nil
}

func (f *fakeLibrary) RemovePhotoFromAlbum(_ context.Context, ownerID, albumID, photoID string) (*db.AlbumView, error) {
	album, ok := f.albums[albumID]
	if !ok {
		return nil, db.ErrNotFound
	}
	if f.albumOwner[albumID] != ownerID {
		return nil, db.ErrForbidden
	}
	kept := make([]string, 0, len(album.PhotoIDs))
	for _, id := range album.PhotoIDs {
		if id != photoID {
			kept = append(kept, id)
		}
	}
	album.PhotoIDs = kept
	album.PhotoCount = len(kept)
	if len(kept) > 0 {
		album.CoverPhotoID = kept[0]
	} else {
		album.CoverPhotoID = ""
	}
	return album, nil
}

func (f *fakeLibrary) ClearOwnerAlbumsAndFavorites(_ context.Context, ownerID string) error {
	f.resetFor = ownerID
	return nil
}

func withUser(r *http.Request, key string) *http.Request {
	return r.WithContext(auth.WithUser(r.Context(), &auth.SessionUser{Key: key, Email: "admin@example.com"}))
}

func TestCreateAlbumAndAddPhoto(t *testing.T) {
	lib := &fakeLibrary{
		photos: map[string]*db.Photo{"p1": {Key: "p1"}},
		albums: map[string]*db.AlbumView{},
	}
	a := &API{DB: lib}
	r := chi.NewRouter()
	a.Routes(r)

	create := httptest.NewRequest(http.MethodPost, "/albums", bytes.NewBufferString(`{"name":"Trip"}`))
	create = withUser(create, "owner")
	cw := httptest.NewRecorder()
	r.ServeHTTP(cw, create)
	if cw.Code != http.StatusCreated {
		t.Fatalf("create %d %s", cw.Code, cw.Body.String())
	}
	var created db.AlbumView
	if err := json.Unmarshal(cw.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.Name != "Trip" || created.PhotoCount != 0 {
		t.Fatalf("created %+v", created)
	}

	add := httptest.NewRequest(http.MethodPost, "/albums/album-1/photos", bytes.NewBufferString(`{"photo_id":"p1"}`))
	add = withUser(add, "owner")
	aw := httptest.NewRecorder()
	r.ServeHTTP(aw, add)
	if aw.Code != http.StatusOK {
		t.Fatalf("add %d %s", aw.Code, aw.Body.String())
	}
	var view db.AlbumView
	if err := json.Unmarshal(aw.Body.Bytes(), &view); err != nil {
		t.Fatal(err)
	}
	if view.PhotoCount != 1 || view.PhotoIDs[0] != "p1" {
		t.Fatalf("view %+v", view)
	}

	again := httptest.NewRequest(http.MethodPost, "/albums/album-1/photos", bytes.NewBufferString(`{"photo_id":"p1"}`))
	again = withUser(again, "owner")
	rw := httptest.NewRecorder()
	r.ServeHTTP(rw, again)
	if err := json.Unmarshal(rw.Body.Bytes(), &view); err != nil {
		t.Fatal(err)
	}
	if view.PhotoCount != 1 {
		t.Fatalf("idempotent count %d", view.PhotoCount)
	}
}

func TestGetAlbumReturnsPhotos(t *testing.T) {
	lib := &fakeLibrary{
		photos:     map[string]*db.Photo{"p1": {Key: "p1"}},
		albums:     map[string]*db.AlbumView{"album-1": {ID: "album-1", Name: "Trip", PhotoCount: 1, CoverPhotoID: "p1", PhotoIDs: []string{"p1"}}},
		albumOwner: map[string]string{"album-1": "owner"},
	}
	a := &API{DB: lib}
	r := chi.NewRouter()
	a.Routes(r)

	req := httptest.NewRequest(http.MethodGet, "/albums/album-1", nil)
	req = withUser(req, "owner")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("got %d %s", w.Code, w.Body.String())
	}
	var detail db.AlbumDetail
	if err := json.Unmarshal(w.Body.Bytes(), &detail); err != nil {
		t.Fatal(err)
	}
	if detail.Name != "Trip" || len(detail.Photos) != 1 || detail.Photos[0].Key != "p1" {
		t.Fatalf("detail %+v", detail)
	}
}

func TestGetAlbumRequiresOwner(t *testing.T) {
	lib := &fakeLibrary{
		albums:     map[string]*db.AlbumView{"album-1": {ID: "album-1", Name: "Trip", PhotoIDs: []string{}}},
		albumOwner: map[string]string{"album-1": "owner"},
	}
	a := &API{DB: lib}
	r := chi.NewRouter()
	a.Routes(r)

	req := httptest.NewRequest(http.MethodGet, "/albums/album-1", nil)
	req = withUser(req, "other")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("got %d", w.Code)
	}
}

func TestRemoveAlbumPhotoUnmembers(t *testing.T) {
	lib := &fakeLibrary{
		photos:     map[string]*db.Photo{"p1": {Key: "p1"}},
		albums:     map[string]*db.AlbumView{"album-1": {ID: "album-1", Name: "Trip", PhotoCount: 1, CoverPhotoID: "p1", PhotoIDs: []string{"p1"}}},
		albumOwner: map[string]string{"album-1": "owner"},
	}
	a := &API{DB: lib}
	r := chi.NewRouter()
	a.Routes(r)

	req := httptest.NewRequest(http.MethodDelete, "/albums/album-1/photos/p1", nil)
	req = withUser(req, "owner")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("got %d %s", w.Code, w.Body.String())
	}
	var view db.AlbumView
	if err := json.Unmarshal(w.Body.Bytes(), &view); err != nil {
		t.Fatal(err)
	}
	if view.PhotoCount != 0 || len(view.PhotoIDs) != 0 {
		t.Fatalf("view %+v", view)
	}

	again := httptest.NewRequest(http.MethodDelete, "/albums/album-1/photos/p1", nil)
	again = withUser(again, "owner")
	rw := httptest.NewRecorder()
	r.ServeHTTP(rw, again)
	if rw.Code != http.StatusOK {
		t.Fatalf("idempotent %d", rw.Code)
	}
}

// The library is shared, so favoriting is refused only for a photo that is
// not there (ADR 0020).
func TestSetFavoriteOnAMissingPhotoIsNotFound(t *testing.T) {
	lib := &fakeLibrary{photos: map[string]*db.Photo{"p1": {Key: "p1"}}}
	a := &API{DB: lib}
	r := chi.NewRouter()
	a.Routes(r)

	req := httptest.NewRequest(http.MethodPut, "/photos/ghost/favorite", bytes.NewBufferString(`{"favorite":true}`))
	req = withUser(req, "other")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("got %d", w.Code)
	}
}

func TestSetFavoritePersistsFlag(t *testing.T) {
	lib := &fakeLibrary{photos: map[string]*db.Photo{"p1": {Key: "p1"}}}
	a := &API{DB: lib}
	r := chi.NewRouter()
	a.Routes(r)

	req := httptest.NewRequest(http.MethodPut, "/photos/p1/favorite", bytes.NewBufferString(`{"favorite":true}`))
	req = withUser(req, "owner")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("got %d %s", w.Code, w.Body.String())
	}
	if !lib.photos["p1"].Favorite {
		t.Fatal("expected favorite")
	}
}

func TestPhotosPassesYearAndFavoriteFilters(t *testing.T) {
	lib := &fakeLibrary{photos: map[string]*db.Photo{}}
	a := &API{DB: lib}
	r := chi.NewRouter()
	a.Routes(r)
	req := httptest.NewRequest(http.MethodGet, "/photos?favorite=true", nil)
	req = withUser(req, "owner")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("got %d", w.Code)
	}
	if lib.filter.Favorite == nil || !*lib.filter.Favorite {
		t.Fatal("expected favorite filter")
	}
}

func batchLibrary() *fakeLibrary {
	return &fakeLibrary{
		photos: map[string]*db.Photo{
			"p1":     {Key: "p1"},
			"p2":     {Key: "p2"},
			"theirs": {Key: "theirs"},
		},
		albums:     map[string]*db.AlbumView{"album-1": {ID: "album-1", Name: "Trip", PhotoIDs: []string{}}},
		albumOwner: map[string]string{"album-1": "owner"},
	}
}

func batchRouter(lib *fakeLibrary) *chi.Mux {
	a := &API{DB: lib}
	r := chi.NewRouter()
	a.Routes(r)
	return r
}

func doJSON(r *chi.Mux, method, path, body, owner string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req = withUser(req, owner)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestSetFavoritesBatch(t *testing.T) {
	lib := batchLibrary()
	r := batchRouter(lib)

	w := doJSON(r, http.MethodPut, "/photos/favorite", `{"ids":["p1","p2"],"favorite":true}`, "owner")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	var got struct {
		Updated  int  `json:"updated"`
		Favorite bool `json:"favorite"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Updated != 2 || !got.Favorite {
		t.Errorf("got %+v, want 2 updated and favorite true", got)
	}
	if !lib.photos["p1"].Favorite || !lib.photos["p2"].Favorite {
		t.Error("the batch did not reach the store")
	}
}

// The batch route must not shadow the single-photo one; both live under
// /photos and differ only in segment count.
func TestSetFavoriteSingleStillWorksAlongsideTheBatchRoute(t *testing.T) {
	lib := batchLibrary()
	r := batchRouter(lib)

	w := doJSON(r, http.MethodPut, "/photos/p1/favorite", `{"favorite":true}`, "owner")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if !lib.photos["p1"].Favorite {
		t.Error("single-photo favorite stopped working")
	}
}

func TestSetFavoritesBatchRejectsBadRequests(t *testing.T) {
	cases := map[string]struct {
		body string
		want int
	}{
		"no ids":      {`{"ids":[],"favorite":true}`, http.StatusBadRequest},
		"ids missing": {`{"favorite":true}`, http.StatusBadRequest},
		"not json":    {`nonsense`, http.StatusBadRequest},
		"unknown id":  {`{"ids":["ghost"],"favorite":true}`, http.StatusForbidden},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			lib := batchLibrary()
			w := doJSON(batchRouter(lib), http.MethodPut, "/photos/favorite", tc.body, "owner")
			if w.Code != tc.want {
				t.Errorf("status %d, want %d: %s", w.Code, tc.want, w.Body.String())
			}
			// All or nothing: a rejected batch must leave everything alone.
			if lib.photos["p1"].Favorite && tc.want != http.StatusOK {
				t.Error("a rejected batch was partly applied")
			}
		})
	}
}

func TestAddAlbumPhotosBatch(t *testing.T) {
	lib := batchLibrary()
	r := batchRouter(lib)

	w := doJSON(r, http.MethodPost, "/albums/album-1/photos", `{"photo_ids":["p1","p2"]}`, "owner")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	var view db.AlbumView
	if err := json.Unmarshal(w.Body.Bytes(), &view); err != nil {
		t.Fatal(err)
	}
	if view.PhotoCount != 2 {
		t.Errorf("photo_count = %d, want 2", view.PhotoCount)
	}
}

// photo_id is what the single-photo menu has always sent; adding photo_ids
// must not break it.
func TestAddAlbumPhotoAcceptsEitherShape(t *testing.T) {
	lib := batchLibrary()
	r := batchRouter(lib)

	single := doJSON(r, http.MethodPost, "/albums/album-1/photos", `{"photo_id":"p1"}`, "owner")
	if single.Code != http.StatusOK {
		t.Fatalf("single: status %d: %s", single.Code, single.Body.String())
	}
	batch := doJSON(r, http.MethodPost, "/albums/album-1/photos", `{"photo_ids":["p2"]}`, "owner")
	if batch.Code != http.StatusOK {
		t.Fatalf("batch: status %d: %s", batch.Code, batch.Body.String())
	}
	var view db.AlbumView
	if err := json.Unmarshal(batch.Body.Bytes(), &view); err != nil {
		t.Fatal(err)
	}
	if view.PhotoCount != 2 {
		t.Errorf("photo_count = %d, want 2 after one of each shape", view.PhotoCount)
	}
}

func TestAddAlbumPhotosBatchRejectsBadRequests(t *testing.T) {
	cases := map[string]struct {
		body string
		want int
	}{
		"neither field": {`{}`, http.StatusBadRequest},
		"empty list":    {`{"photo_ids":[]}`, http.StatusBadRequest},
		"not json":      {`nonsense`, http.StatusBadRequest},
		"unknown photo": {`{"photo_ids":["p1","ghost"]}`, http.StatusForbidden},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			lib := batchLibrary()
			w := doJSON(batchRouter(lib), http.MethodPost, "/albums/album-1/photos", tc.body, "owner")
			if w.Code != tc.want {
				t.Errorf("status %d, want %d: %s", w.Code, tc.want, w.Body.String())
			}
			// All or nothing: a refused batch adds no rows at all.
			if lib.albums["album-1"].PhotoCount != 0 {
				t.Errorf("photo_count = %d, want 0", lib.albums["album-1"].PhotoCount)
			}
		})
	}
}

func TestBatchEndpointsRequireASession(t *testing.T) {
	r := batchRouter(batchLibrary())
	for _, tc := range []struct{ method, path, body string }{
		{http.MethodPut, "/photos/favorite", `{"ids":["p1"],"favorite":true}`},
		{http.MethodPost, "/albums/album-1/photos", `{"photo_ids":["p1"]}`},
	} {
		req := httptest.NewRequest(tc.method, tc.path, bytes.NewBufferString(tc.body))
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusUnauthorized {
			t.Errorf("%s %s: status %d, want 401", tc.method, tc.path, w.Code)
		}
	}
}

func TestDeleteAlbumsNeedsIDsAndOwnership(t *testing.T) {
	lib := batchLibrary()
	r := batchRouter(lib)

	// No ids at all is a bad request, not a silent no-op.
	w := doJSON(r, http.MethodDelete, "/albums", "", "owner")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("no ids: status %d, want 400", w.Code)
	}

	// An album the reader does not own takes nothing with it.
	w = doJSON(r, http.MethodDelete, "/albums?id=album-1&id=ghost", "", "owner")
	if w.Code != http.StatusForbidden {
		t.Fatalf("foreign id: status %d, want 403: %s", w.Code, w.Body.String())
	}
	if _, ok := lib.albums["album-1"]; !ok {
		t.Error("a refused batch deleted the album it did own")
	}

	w = doJSON(r, http.MethodDelete, "/albums?id=album-1", "", "owner")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if _, ok := lib.albums["album-1"]; ok {
		t.Error("the album was not deleted")
	}
}
