package api

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/memries/memries/internal/db"
	"github.com/memries/memries/internal/storage"
	"github.com/memries/memries/internal/thumb"
)

// oneFileStore serves one key, which is all the original handler needs.
type oneFileStore struct {
	key  string
	body string
}

func (o *oneFileStore) Backend() string { return "local" }
func (o *oneFileStore) Get(_ context.Context, key string) (io.ReadCloser, error) {
	if key != o.key {
		return nil, storage.ErrNotFound
	}
	return io.NopCloser(strings.NewReader(o.body)), nil
}
func (o *oneFileStore) Put(context.Context, string, io.Reader) error { return nil }
func (o *oneFileStore) Stat(context.Context, string) (storage.ObjectInfo, error) {
	return storage.ObjectInfo{}, nil
}
func (o *oneFileStore) URL(context.Context, string, time.Duration) (string, error) {
	return "", nil
}
func (o *oneFileStore) Delete(context.Context, string) error { return nil }
func (o *oneFileStore) Walk(context.Context, string, func(storage.ObjectInfo) error) error {
	return nil
}

// displayAPI wires the original handler over a thumb cache holding one
// rendition, so the HEIC path can be exercised without a Source.
func displayAPI(t *testing.T, photo *db.Photo, renditions map[string][]byte) *API {
	t.Helper()
	root := t.TempDir()
	tg, err := thumb.NewGenerator(root)
	if err != nil {
		t.Fatal(err)
	}
	for rel, body := range renditions {
		abs := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(abs, body, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return &API{
		DB:    &fakeLibrary{photos: map[string]*db.Photo{photo.Key: photo}},
		Thumb: tg,
		Store: &oneFileStore{key: photo.Storage.Path, body: "original-bytes"},
	}
}

func getOriginal(t *testing.T, a *API, key string) *httptest.ResponseRecorder {
	t.Helper()
	r := chi.NewRouter()
	r.Get("/original/{id}", a.original)
	req := httptest.NewRequest(http.MethodGet, "/original/"+key, nil)
	req = withUser(req, "reader")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// The whole point of the display rendition: a browser that cannot render
// HEIC still opens the photo, and the server decodes nothing to make that
// happen — which is what keeps it a pure-Go build (ADR 0025).
func TestOriginalServesTheDisplayRenditionForHEIC(t *testing.T) {
	a := displayAPI(t,
		&db.Photo{
			Key:     "heic1",
			MIME:    "image/heic",
			Thumbs:  db.Thumbs{S1024: "ab/heic1/l.jpg", S2048: "ab/heic1/d.jpg"},
			Storage: db.StoragePtr{Path: "photos/IMG_1.heic"},
		},
		map[string][]byte{"ab/heic1/d.jpg": []byte("display-jpeg-bytes")},
	)

	w := getOriginal(t, a, "heic1")
	if w.Code != http.StatusOK {
		t.Fatalf("got %d: %s", w.Code, w.Body)
	}
	if got := w.Header().Get("Content-Type"); got != "image/jpeg" {
		t.Errorf("content type %q, want image/jpeg — not the stored image/heic", got)
	}
	if w.Body.String() != "display-jpeg-bytes" {
		t.Errorf("body %q", w.Body.String())
	}
}

// A JPEG has no display rendition, so nothing changes for the common case:
// the original bytes are streamed as before.
func TestOriginalStillStreamsAWebSafeOriginal(t *testing.T) {
	a := displayAPI(t,
		&db.Photo{
			Key:     "jpg1",
			MIME:    "image/jpeg",
			Thumbs:  db.Thumbs{S1024: "ab/jpg1/l.jpg"},
			Storage: db.StoragePtr{Path: "photos/IMG_2.jpg"},
		},
		nil,
	)
	w := getOriginal(t, a, "jpg1")
	if w.Code != http.StatusOK {
		t.Fatalf("got %d: %s", w.Code, w.Body)
	}
	if w.Body.String() != "original-bytes" {
		t.Errorf("body %q, want the original streamed through", w.Body.String())
	}
	if got := w.Header().Get("Content-Type"); got != "image/jpeg" {
		t.Errorf("content type %q, want the stored MIME", got)
	}
}

// A missing rendition is a cache problem, not a missing photo, so the
// handler falls through to the original rather than 404ing — Safari can show
// a HEIC, and the thumb fallback below still covers a lost original.
func TestOriginalFallsThroughToTheOriginalWhenTheRenditionIsGone(t *testing.T) {
	a := displayAPI(t,
		&db.Photo{
			Key:     "heic2",
			MIME:    "image/heic",
			Thumbs:  db.Thumbs{S256: "ab/heic2/s.jpg", S2048: "ab/heic2/d.jpg"},
			Storage: db.StoragePtr{Path: "photos/IMG_3.heic"},
		},
		// d.jpg deliberately absent.
		map[string][]byte{"ab/heic2/s.jpg": []byte("small-jpeg")},
	)

	w := getOriginal(t, a, "heic2")
	if w.Code != http.StatusOK {
		t.Fatalf("got %d: %s", w.Code, w.Body)
	}
	if w.Body.String() != "original-bytes" {
		t.Errorf("body %q, want the original streamed through", w.Body.String())
	}
}

// With neither the rendition nor the original readable, the existing thumb
// fallback takes over and the reader sees a small image rather than an error.
func TestOriginalFallsBackToAThumbWhenNothingElseOpens(t *testing.T) {
	a := displayAPI(t,
		&db.Photo{
			Key:     "heic3",
			MIME:    "image/heic",
			Thumbs:  db.Thumbs{S256: "ab/heic3/s.jpg", S2048: "ab/heic3/d.jpg"},
			Storage: db.StoragePtr{Path: "photos/IMG_4.heic"},
		},
		map[string][]byte{"ab/heic3/s.jpg": []byte("small-jpeg")},
	)
	// The store serves one key, and it is not this photo's.
	a.Store = &oneFileStore{key: "photos/other.heic", body: "nope"}

	w := getOriginal(t, a, "heic3")
	if w.Code != http.StatusOK {
		t.Fatalf("got %d: %s", w.Code, w.Body)
	}
	if w.Body.String() != "small-jpeg" {
		t.Errorf("body %q, want the thumb fallback", w.Body.String())
	}
}

// The fallback has to know the display rendition is the biggest one there is.
func TestThumbCandidatesLeadWithTheDisplayRendition(t *testing.T) {
	got := thumbCandidates(db.Thumbs{S256: "s.jpg", S512: "m.jpg", S1024: "l.jpg", S2048: "d.jpg"})
	if len(got) != 4 || got[0] != "d.jpg" {
		t.Fatalf("got %v, want d.jpg first", got)
	}
}

// seekableStore serves one key as something a player can seek in, which is
// what a video needs (ADR 0029).
type seekableStore struct {
	key  string
	body string
}

type nopSeekCloser struct{ *strings.Reader }

func (nopSeekCloser) Close() error { return nil }

func (s *seekableStore) Backend() string { return "local" }
func (s *seekableStore) Get(_ context.Context, key string) (io.ReadCloser, error) {
	if key != s.key {
		return nil, storage.ErrNotFound
	}
	return nopSeekCloser{strings.NewReader(s.body)}, nil
}
func (s *seekableStore) Put(context.Context, string, io.Reader) error { return nil }
func (s *seekableStore) Stat(context.Context, string) (storage.ObjectInfo, error) {
	return storage.ObjectInfo{}, nil
}
func (s *seekableStore) URL(context.Context, string, time.Duration) (string, error) {
	return "", nil
}
func (s *seekableStore) Delete(context.Context, string) error { return nil }
func (s *seekableStore) Walk(context.Context, string, func(storage.ObjectInfo) error) error {
	return nil
}

// Dragging a player's scrubber is a request for the middle of the file.
// Without 206 the browser either refuses to seek or refetches the whole clip,
// which for a 528MB phone video is the difference between playable and not.
func TestOriginalAnswersAByteRangeForAVideo(t *testing.T) {
	a := displayAPI(t, &db.Photo{
		Key:     "vid1",
		Kind:    db.KindVideo,
		MIME:    "video/quicktime",
		Storage: db.StoragePtr{Path: "clips/IMG_0181.MOV"},
	}, nil)
	a.Store = &seekableStore{key: "clips/IMG_0181.MOV", body: "0123456789"}

	r := chi.NewRouter()
	r.Get("/original/{id}", a.original)
	req := withUser(httptest.NewRequest(http.MethodGet, "/original/vid1", nil), "reader")
	req.Header.Set("Range", "bytes=2-5")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusPartialContent {
		t.Fatalf("status = %d, want 206: %s", w.Code, w.Body)
	}
	if w.Body.String() != "2345" {
		t.Errorf("body = %q", w.Body.String())
	}
	if got := w.Header().Get("Content-Range"); got != "bytes 2-5/10" {
		t.Errorf("Content-Range = %q", got)
	}
	if got := w.Header().Get("Content-Type"); got != "video/quicktime" {
		t.Errorf("Content-Type = %q, want the stored MIME", got)
	}
}

// A whole-file request still works, and says ranges are available so the
// player knows it may seek.
func TestOriginalAdvertisesRangesForASeekableStore(t *testing.T) {
	a := displayAPI(t, &db.Photo{
		Key:     "vid2",
		Kind:    db.KindVideo,
		MIME:    "video/mp4",
		Storage: db.StoragePtr{Path: "clips/a.mp4"},
	}, nil)
	a.Store = &seekableStore{key: "clips/a.mp4", body: "0123456789"}
	w := getOriginal(t, a, "vid2")
	if w.Code != http.StatusOK || w.Body.String() != "0123456789" {
		t.Fatalf("status %d body %q", w.Code, w.Body.String())
	}
	if got := w.Header().Get("Accept-Ranges"); got != "bytes" {
		t.Errorf("Accept-Ranges = %q", got)
	}
}

// A backend that cannot seek still streams, and says so rather than letting a
// player believe it can seek.
func TestOriginalSaysSoWhenTheBackendCannotSeek(t *testing.T) {
	a := displayAPI(t, &db.Photo{
		Key:     "vid3",
		Kind:    db.KindVideo,
		MIME:    "video/mp4",
		Storage: db.StoragePtr{Path: "clips/remote.mp4"},
	}, nil)
	a.Store = &oneFileStore{key: "clips/remote.mp4", body: "original-bytes"}
	w := getOriginal(t, a, "vid3")
	if w.Code != http.StatusOK || w.Body.String() != "original-bytes" {
		t.Fatalf("status %d body %q", w.Code, w.Body.String())
	}
	if got := w.Header().Get("Accept-Ranges"); got != "none" {
		t.Errorf("Accept-Ranges = %q", got)
	}
}
