package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/memries/memries/internal/db"
	"github.com/memries/memries/internal/sources"
	"github.com/memries/memries/internal/thumb"
)

type fakeSettings struct {
	values map[string]string
	fail   bool
}

func (f *fakeSettings) Setting(_ context.Context, key string) (string, error) {
	return f.values[key], nil
}

func (f *fakeSettings) SetSetting(_ context.Context, key, value string) error {
	if f.fail {
		return os.ErrPermission
	}
	if f.values == nil {
		f.values = map[string]string{}
	}
	f.values[key] = value
	return nil
}

// locatedSources reports whatever local folders a test needs the validator to
// see, so the "cache inside a Source" rules can be exercised.
type locatedSources struct{ views []sources.View }

func (l *locatedSources) List(context.Context) ([]sources.View, error) { return l.views, nil }
func (l *locatedSources) Create(context.Context, sources.Input) (sources.View, error) {
	return sources.View{}, nil
}
func (l *locatedSources) Update(context.Context, string, sources.Input) (sources.View, error) {
	return sources.View{}, nil
}
func (l *locatedSources) Remove(context.Context, string) (sources.View, error) {
	return sources.View{}, nil
}

func settingsAPI(t *testing.T, allowed string, views ...sources.View) (*API, *fakeSettings) {
	t.Helper()
	defaultRoot := filepath.Join(allowed, "cache")
	tg, err := thumb.NewGenerator(defaultRoot)
	if err != nil {
		t.Fatal(err)
	}
	store := &fakeSettings{}
	return &API{
		Thumb:                tg,
		Settings:             store,
		Sources:              &locatedSources{views: views},
		CacheRoots:           []string{allowed},
		DefaultThumbnailRoot: defaultRoot,
		IsAdmin:              func(string) bool { return true },
	}, store
}

func putThumbnailRoot(t *testing.T, a *API, path string) *httptest.ResponseRecorder {
	t.Helper()
	body := strings.NewReader(`{"path":` + quote(path) + `}`)
	req := httptest.NewRequest(http.MethodPut, "/admin/settings/thumbnails", body)
	req = withUser(req, "admin")
	w := httptest.NewRecorder()
	r := chi.NewRouter()
	r.Route("/admin", a.adminRoutes)
	r.ServeHTTP(w, req)
	return w
}

func quote(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func TestSetThumbnailRootMovesTheGeneratorAndPersists(t *testing.T) {
	base := t.TempDir()
	a, store := settingsAPI(t, base)
	target := filepath.Join(base, "external", "thumbs")

	w := putThumbnailRoot(t, a, target)
	if w.Code != http.StatusOK {
		t.Fatalf("got %d: %s", w.Code, w.Body)
	}

	var got thumbnailRootResponse
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.ThumbnailRoot != target {
		t.Fatalf("root %q", got.ThumbnailRoot)
	}
	// Thumbs already written stay under the old root, so the admin has to be
	// told that reindexing is what fills the new one.
	if !got.NeedsReindex {
		t.Error("expected needs_reindex on a move")
	}
	if a.Thumb.Root() != target {
		t.Errorf("generator still at %q", a.Thumb.Root())
	}
	if store.values[db.SettingThumbnailRoot] != target {
		t.Errorf("stored %q", store.values[db.SettingThumbnailRoot])
	}
	// The directory is created, not merely accepted.
	if st, err := os.Stat(target); err != nil || !st.IsDir() {
		t.Errorf("target not created: %v", err)
	}
}

func TestSetThumbnailRootSameLocationNeedsNoReindex(t *testing.T) {
	base := t.TempDir()
	a, _ := settingsAPI(t, base)

	w := putThumbnailRoot(t, a, a.Thumb.Root())
	if w.Code != http.StatusOK {
		t.Fatalf("got %d: %s", w.Code, w.Body)
	}
	var got thumbnailRootResponse
	_ = json.Unmarshal(w.Body.Bytes(), &got)
	if got.NeedsReindex {
		t.Error("re-saving the same path should not ask for a reindex")
	}
}

// Empty means "back to the install default", which is how an admin undoes a
// choice without knowing what the unit file says.
func TestSetThumbnailRootEmptyRestoresTheDefault(t *testing.T) {
	base := t.TempDir()
	a, store := settingsAPI(t, base)
	if w := putThumbnailRoot(t, a, filepath.Join(base, "elsewhere")); w.Code != http.StatusOK {
		t.Fatalf("setup: %d %s", w.Code, w.Body)
	}

	w := putThumbnailRoot(t, a, "   ")
	if w.Code != http.StatusOK {
		t.Fatalf("got %d: %s", w.Code, w.Body)
	}
	if a.Thumb.Root() != a.DefaultThumbnailRoot {
		t.Errorf("root %q, want the default", a.Thumb.Root())
	}
	if store.values[db.SettingThumbnailRoot] != a.DefaultThumbnailRoot {
		t.Errorf("stored %q", store.values[db.SettingThumbnailRoot])
	}
}

func TestSetThumbnailRootRejectsPathsOutsideTheAllowedRoots(t *testing.T) {
	base := t.TempDir()
	outside := t.TempDir()
	a, _ := settingsAPI(t, base)
	before := a.Thumb.Root()

	w := putThumbnailRoot(t, a, filepath.Join(outside, "thumbs"))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("got %d: %s", w.Code, w.Body)
	}
	if !strings.Contains(w.Body.String(), "MEMRIES_CACHE_ROOTS") {
		t.Errorf("message should name the setting to change: %s", w.Body)
	}
	if a.Thumb.Root() != before {
		t.Error("a rejected path must not move the generator")
	}
}

func TestSetThumbnailRootRejectsRelativePaths(t *testing.T) {
	base := t.TempDir()
	a, _ := settingsAPI(t, base)
	w := putThumbnailRoot(t, a, "data/cache")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("got %d: %s", w.Code, w.Body)
	}
	if !strings.Contains(w.Body.String(), "absolute") {
		t.Errorf("message %q", w.Body)
	}
}

// A cache inside a Source would be walked by the next scan, so the indexer
// would index its own thumbnails as photos.
func TestSetThumbnailRootRejectsALocationInsideASource(t *testing.T) {
	base := t.TempDir()
	library := filepath.Join(base, "library")
	if err := os.MkdirAll(library, 0o755); err != nil {
		t.Fatal(err)
	}
	a, _ := settingsAPI(t, base, sources.View{
		ID: "1", Name: "Photos", Type: sources.TypeLocal, Location: library,
	})

	w := putThumbnailRoot(t, a, filepath.Join(library, "thumbs"))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("got %d: %s", w.Code, w.Body)
	}
	if !strings.Contains(w.Body.String(), "index the thumbnails as photos") {
		t.Errorf("message should say why: %s", w.Body)
	}
}

// The reverse is just as bad: a cache above the library would put thumbnails
// on top of the photos.
func TestSetThumbnailRootRejectsALocationContainingASource(t *testing.T) {
	base := t.TempDir()
	library := filepath.Join(base, "outer", "library")
	if err := os.MkdirAll(library, 0o755); err != nil {
		t.Fatal(err)
	}
	a, _ := settingsAPI(t, base, sources.View{
		ID: "1", Name: "Photos", Type: sources.TypeLocal, Location: library,
	})

	w := putThumbnailRoot(t, a, filepath.Join(base, "outer"))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("got %d: %s", w.Code, w.Body)
	}
	if !strings.Contains(w.Body.String(), "on top of the photo library") {
		t.Errorf("message %q", w.Body)
	}
}

// A WebDAV Source has a URL, not a server path, so it constrains nothing.
func TestSetThumbnailRootIgnoresRemoteSources(t *testing.T) {
	base := t.TempDir()
	a, _ := settingsAPI(t, base, sources.View{
		ID: "1", Name: "Cloud", Type: sources.TypeWebDAV, Location: "https://dav.example.com/photos",
	})
	if w := putThumbnailRoot(t, a, filepath.Join(base, "thumbs")); w.Code != http.StatusOK {
		t.Fatalf("got %d: %s", w.Code, w.Body)
	}
}

// MkdirAll succeeds on a directory this user cannot write, and a read-only
// mount is exactly the mistake worth catching before an index run fails on
// every photo.
func TestSetThumbnailRootRejectsAnUnwritableDirectory(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root can write anywhere")
	}
	base := t.TempDir()
	locked := filepath.Join(base, "locked")
	if err := os.MkdirAll(locked, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(locked, 0o755) })

	a, _ := settingsAPI(t, base)
	w := putThumbnailRoot(t, a, locked)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("got %d: %s", w.Code, w.Body)
	}
	if !strings.Contains(w.Body.String(), "not writable") {
		t.Errorf("message %q", w.Body)
	}
}

// A failed write must not leave the running server reading one folder while
// the catalog names another.
func TestSetThumbnailRootRollsBackWhenTheStoreFails(t *testing.T) {
	base := t.TempDir()
	a, store := settingsAPI(t, base)
	before := a.Thumb.Root()
	store.fail = true

	w := putThumbnailRoot(t, a, filepath.Join(base, "thumbs"))
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("got %d: %s", w.Code, w.Body)
	}
	if a.Thumb.Root() != before {
		t.Errorf("generator left at %q after a failed save", a.Thumb.Root())
	}
}

func TestSettingsReportsTheCurrentStateAndFreeSpace(t *testing.T) {
	base := t.TempDir()
	a, _ := settingsAPI(t, base)

	req := httptest.NewRequest(http.MethodGet, "/admin/settings", nil)
	req = withUser(req, "admin")
	w := httptest.NewRecorder()
	r := chi.NewRouter()
	r.Route("/admin", a.adminRoutes)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("got %d: %s", w.Code, w.Body)
	}
	var got settingsResponse
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.ThumbnailRoot != a.DefaultThumbnailRoot {
		t.Errorf("root %q", got.ThumbnailRoot)
	}
	if got.DefaultThumbnailRoot != a.DefaultThumbnailRoot {
		t.Errorf("default %q", got.DefaultThumbnailRoot)
	}
	if len(got.AllowedRoots) != 1 || got.AllowedRoots[0] != base {
		t.Errorf("allowed %+v", got.AllowedRoots)
	}
	// A real temp dir sits on a real filesystem, so this is never 0 here.
	if got.FreeBytes == 0 {
		t.Error("expected free space for a tempdir")
	}
}

// The settings routes sit behind the admin gate, like Sources (ADR 0013).
func TestSettingsRequiresAdmin(t *testing.T) {
	base := t.TempDir()
	a, _ := settingsAPI(t, base)
	a.IsAdmin = func(string) bool { return false }

	for _, tc := range []struct{ method, path string }{
		{http.MethodGet, "/admin/settings"},
		{http.MethodPut, "/admin/settings/thumbnails"},
	} {
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(`{"path":"/tmp/x"}`))
		req = withUser(req, "reader")
		w := httptest.NewRecorder()
		r := chi.NewRouter()
		r.Route("/admin", a.adminRoutes)
		r.ServeHTTP(w, req)
		if w.Code != http.StatusForbidden {
			t.Errorf("%s %s got %d, want 403", tc.method, tc.path, w.Code)
		}
	}
}

// The confinement check resolves the deepest existing ancestor, so a root
// reached through a symlink still works. macOS puts every TempDir under
// /var -> /private/var, which is exactly this case; a symlinked mount point
// on the Pi is the same shape.
func TestThumbnailRootAllowsARootBehindASymlink(t *testing.T) {
	base := t.TempDir()
	real := filepath.Join(base, "real")
	if err := os.MkdirAll(real, 0o755); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(base, "link")
	if err := os.Symlink(real, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	// The allowed root is named through the link; the target does not exist.
	if !withinAllowedRoots(filepath.Join(link, "thumbs"), []string{link}) {
		t.Error("a path under a symlinked root should be allowed")
	}
}

// A symlink inside an allowed root must not become a way out of it.
func TestThumbnailRootRefusesASymlinkEscapingTheRoot(t *testing.T) {
	base := t.TempDir()
	outside := t.TempDir()
	allowed := filepath.Join(base, "allowed")
	if err := os.MkdirAll(allowed, 0o755); err != nil {
		t.Fatal(err)
	}
	escape := filepath.Join(allowed, "escape")
	if err := os.Symlink(outside, escape); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if withinAllowedRoots(filepath.Join(escape, "thumbs"), []string{allowed}) {
		t.Error("a symlink out of the root must be refused")
	}
}

func TestThumbnailRootRefusesATraversalOutOfTheRoot(t *testing.T) {
	base := t.TempDir()
	if withinAllowedRoots(filepath.Join(base, "..", "elsewhere"), []string{base}) {
		t.Error("..  must not leave the root")
	}
}
