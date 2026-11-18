package sources

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"golang.org/x/net/webdav"

	"github.com/memries/memries/internal/db"
	"github.com/memries/memries/internal/index"
	"github.com/memries/memries/internal/storage"
	"github.com/memries/memries/internal/thumb"
)

func jpegBytes(t *testing.T, c color.RGBA) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 40, 30))
	for y := 0; y < 30; y++ {
		for x := 0; x < 40; x++ {
			img.SetRGBA(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// davServer serves an in-memory WebDAV tree behind basic auth.
func davServer(t *testing.T, user, pass string, files map[string][]byte) (*httptest.Server, webdav.FileSystem) {
	t.Helper()
	fs := webdav.NewMemFS()
	ctx := context.Background()
	for name, body := range files {
		if dir := filepath.ToSlash(filepath.Dir(name)); dir != "/" {
			_ = fs.Mkdir(ctx, dir, 0o755)
		}
		f, err := fs.OpenFile(ctx, name, os.O_CREATE|os.O_WRONLY, 0o644)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = f.Write(body)
		f.Close()
	}
	h := &webdav.Handler{FileSystem: fs, LockSystem: webdav.NewMemLS()}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if u, p, ok := r.BasicAuth(); !ok || u != user || p != pass {
			w.Header().Set("WWW-Authenticate", `Basic realm="dav"`)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		h.ServeHTTP(w, r)
	}))
	t.Cleanup(srv.Close)
	return srv, fs
}

func newRegistry(t *testing.T, repo *memRepo) *Registry {
	t.Helper()
	sealer, err := NewSealer("test-secret")
	if err != nil {
		t.Fatal(err)
	}
	return &Registry{Repo: repo, Sealer: sealer, Roots: []string{t.TempDir()}, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
}

func ptr(s string) *string { return &s }

func TestCreateWebDAVProbesCredentialsAndSealsPassword(t *testing.T) {
	srv, _ := davServer(t, "me", "right", map[string][]byte{"/a.jpg": {1}})
	repo := newMemRepo()
	reg := newRegistry(t, repo)
	ctx := context.Background()

	_, err := reg.Create(ctx, Input{Type: TypeWebDAV, Location: srv.URL, Username: "me", Password: ptr("wrong"), OwnerEmail: "bob@example.com"})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("wrong password err = %v", err)
	}
	if len(repo.sources) != 0 {
		t.Fatal("failed probe must not save")
	}

	v, err := reg.Create(ctx, Input{Name: "Nextcloud", Type: TypeWebDAV, Location: srv.URL + "/", Username: "me", Password: ptr("right"), OwnerEmail: "Bob@Example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if !v.HasPassword || v.OwnerEmail != "bob@example.com" || v.OwnerID != db.UserKeyFromEmail("bob@example.com") {
		t.Fatalf("view = %+v", v)
	}
	stored := repo.sources[v.ID]
	if stored.Secret == "" || stored.Secret == "right" {
		t.Fatalf("secret not sealed: %q", stored.Secret)
	}

	// Editing without a password keeps it; changing owner is refused.
	if _, err := reg.Update(ctx, v.ID, Input{Name: "Cloud", Type: TypeWebDAV, Location: srv.URL, Username: "me"}); err != nil {
		t.Fatalf("update keeping password: %v", err)
	}
	if _, err := reg.Update(ctx, v.ID, Input{Type: TypeWebDAV, Location: srv.URL, Username: "me", OwnerEmail: "eve@example.com"}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("owner change err = %v", err)
	}
}

func TestIndexWebDAVSourceWritesLocalThumbs(t *testing.T) {
	srv, fs := davServer(t, "me", "pw", map[string][]byte{
		"/2024/red.jpg":   jpegBytes(t, color.RGBA{200, 10, 10, 255}),
		"/2024/notes.txt": []byte("skip me"),
		"/blue.jpg":       jpegBytes(t, color.RGBA{10, 10, 200, 255}),
	})
	repo := newMemRepo()
	reg := newRegistry(t, repo)
	ctx := context.Background()
	v, err := reg.Create(ctx, Input{Type: TypeWebDAV, Location: srv.URL, Username: "me", Password: ptr("pw"), OwnerEmail: "bob@example.com"})
	if err != nil {
		t.Fatal(err)
	}

	cache := t.TempDir()
	tg, err := thumb.NewGenerator(cache)
	if err != nil {
		t.Fatal(err)
	}
	photos := &memPhotos{byKey: map[string]*db.Photo{}}
	idx := &index.Indexer{Store: reg, DB: photos, Thumb: tg, Log: reg.Log}
	scopes, err := reg.Scopes(ctx, v.OwnerID, v.OwnerEmail)
	if err != nil || len(scopes) != 1 || !scopes[0].Remote {
		t.Fatalf("scopes = %+v err %v", scopes, err)
	}
	res, err := idx.Run(ctx, index.Options{OwnerID: v.OwnerID, Prefixes: []string{scopes[0].Prefix}})
	if err != nil {
		t.Fatal(err)
	}
	if res.Indexed != 2 || res.Failed != 0 {
		t.Fatalf("result = %+v", res)
	}
	for _, p := range photos.byKey {
		if p.Storage.Backend != Backend || filepath.Dir(p.Storage.Path) == "." {
			t.Fatalf("storage = %+v", p.Storage)
		}
		if !tg.HasAll(p.Thumbs.S256, p.Thumbs.S512, p.Thumbs.S1024) {
			t.Fatalf("thumbs missing on local disk: %+v", p.Thumbs)
		}
		if _, err := os.Stat(filepath.Join(cache, p.Thumbs.S256)); err != nil {
			t.Fatal(err)
		}
		rc, err := reg.Get(ctx, p.Storage.Path)
		if err != nil {
			t.Fatalf("original via registry: %v", err)
		}
		rc.Close()
	}

	// Second run: unchanged size + mtime skips without re-downloading.
	res, err = idx.Run(ctx, index.Options{OwnerID: v.OwnerID, Prefixes: []string{scopes[0].Prefix}})
	if err != nil || res.Skipped != 2 {
		t.Fatalf("rerun = %+v err %v", res, err)
	}

	// A file deleted on the share is pruned; a removed Source prunes the rest.
	if err := fs.RemoveAll(ctx, "/blue.jpg"); err != nil {
		t.Fatal(err)
	}
	if _, err := idx.Run(ctx, index.Options{OwnerID: v.OwnerID, Prefixes: []string{scopes[0].Prefix}}); err != nil {
		t.Fatal(err)
	}
	if n := photos.live(); n != 1 {
		t.Fatalf("live after delete = %d", n)
	}
	if _, err := reg.Remove(ctx, v.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := idx.Run(ctx, index.Options{OwnerID: v.OwnerID}); err != nil {
		t.Fatal(err)
	}
	if n := photos.live(); n != 0 {
		t.Fatalf("live after source removed = %d", n)
	}
}

func TestUnreachableSourceKeepsPhotos(t *testing.T) {
	srv, _ := davServer(t, "me", "pw", map[string][]byte{"/a.jpg": jpegBytes(t, color.RGBA{1, 2, 3, 255})})
	repo := newMemRepo()
	reg := newRegistry(t, repo)
	ctx := context.Background()
	v, err := reg.Create(ctx, Input{Type: TypeWebDAV, Location: srv.URL, Username: "me", Password: ptr("pw"), OwnerEmail: "bob@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	tg, _ := thumb.NewGenerator(t.TempDir())
	photos := &memPhotos{byKey: map[string]*db.Photo{}}
	idx := &index.Indexer{Store: reg, DB: photos, Thumb: tg, Log: reg.Log}
	if _, err := idx.Run(ctx, index.Options{OwnerID: v.OwnerID, Prefixes: []string{v.ID}}); err != nil {
		t.Fatal(err)
	}
	srv.Close() // NAS goes to sleep
	res, err := idx.Run(ctx, index.Options{OwnerID: v.OwnerID, Prefixes: []string{v.ID}})
	if err == nil {
		t.Fatalf("expected walk error when the only source is down, got %+v", res)
	}
	if n := photos.live(); n != 1 {
		t.Fatalf("photos pruned while source unreachable: live = %d", n)
	}
}

func TestLegacyEmailFolderBecomesSourceOnce(t *testing.T) {
	legacy := t.TempDir()
	dir := filepath.Join(legacy, "bob@example.com")
	if err := os.Mkdir(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	repo := newMemRepo()
	reg := newRegistry(t, repo)
	reg.LegacyRoot = legacy
	reg.Roots = []string{legacy}
	ctx := context.Background()

	scopes, err := reg.Scopes(ctx, "owner-bob", "Bob@Example.com")
	if err != nil {
		t.Fatal(err)
	}
	if len(scopes) != 1 || scopes[0].Remote {
		t.Fatalf("scopes = %+v", scopes)
	}
	src := repo.sources[scopes[0].Prefix]
	if src.Type != TypeLocal || src.Location != dir || src.OwnerID != "owner-bob" {
		t.Fatalf("source = %+v", src)
	}
	if len(repo.relocated) != 1 || repo.relocated[0] != (relocation{"owner-bob", "bob@example.com", src.Key}) {
		t.Fatalf("relocated = %+v", repo.relocated)
	}

	// Truncated users (db-clear) re-run migration without duplicating the Source.
	repo.migrated = map[string]bool{}
	if scopes, err = reg.Scopes(ctx, "owner-bob", "bob@example.com"); err != nil || len(scopes) != 1 {
		t.Fatalf("scopes = %+v err %v", scopes, err)
	}

	// No folder: nothing to migrate.
	if scopes, err = reg.Scopes(ctx, "owner-eve", "eve@example.com"); err != nil || len(scopes) != 0 {
		t.Fatalf("eve scopes = %+v err %v", scopes, err)
	}
}

func TestRemovedSourceReadsAsNotFound(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "a.jpg"), []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	repo := newMemRepo()
	reg := newRegistry(t, repo)
	reg.Roots = []string{root}
	ctx := context.Background()
	v, err := reg.Create(ctx, Input{Type: TypeLocal, Location: root, OwnerEmail: "bob@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := reg.Stat(ctx, v.ID+"/a.jpg"); err != nil {
		t.Fatal(err)
	}
	if _, err := reg.Remove(ctx, v.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := reg.Stat(ctx, v.ID+"/a.jpg"); !storage.IsNotFound(err) {
		t.Fatalf("err = %v", err)
	}
}

// memPhotos is a minimal index.PhotoRepository.
type memPhotos struct {
	mu    sync.Mutex
	byKey map[string]*db.Photo
}

func (m *memPhotos) find(match func(*db.Photo) bool) (*db.Photo, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, p := range m.byKey {
		if match(p) {
			cp := *p
			return &cp, nil
		}
	}
	return nil, db.ErrNotFound
}

func (m *memPhotos) GetPhoto(_ context.Context, key string) (*db.Photo, error) {
	return m.find(func(p *db.Photo) bool { return p.Key == key })
}

func (m *memPhotos) GetPhotoByHash(_ context.Context, ownerID, hash string) (*db.Photo, error) {
	return m.find(func(p *db.Photo) bool { return p.OwnerID == ownerID && p.Hash == hash })
}

func (m *memPhotos) GetPhotoByOwnerPath(_ context.Context, owner, path string) (*db.Photo, error) {
	return m.find(func(p *db.Photo) bool { return p.OwnerID == owner && p.Storage.Path == path })
}

func (m *memPhotos) UpsertPhoto(_ context.Context, p *db.Photo) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := *p
	m.byKey[p.Key] = &cp
	return nil
}

func (m *memPhotos) UpdateIndexedPhoto(ctx context.Context, p *db.Photo) error {
	return m.UpsertPhoto(ctx, p)
}

func (m *memPhotos) ListOwnerPhotoStorage(_ context.Context, owner string) ([]db.PhotoStorageRef, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []db.PhotoStorageRef
	for _, p := range m.byKey {
		if p.OwnerID == owner && p.DeletedAt == nil {
			out = append(out, db.PhotoStorageRef{Key: p.Key, Path: p.Storage.Path})
		}
	}
	return out, nil
}

func (m *memPhotos) SoftDeletePhoto(_ context.Context, key string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	m.byKey[key].DeletedAt = &now
	return nil
}

func (m *memPhotos) live() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, p := range m.byKey {
		if p.DeletedAt == nil {
			n++
		}
	}
	return n
}
