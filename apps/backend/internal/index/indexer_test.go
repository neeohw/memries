package index

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/jpeg"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/memries/memries/internal/db"
	"github.com/memries/memries/internal/storage"
	"github.com/memries/memries/internal/thumb"
)

type memPhotos struct {
	mu    sync.Mutex
	byKey map[string]*db.Photo
}

// clone also truncates the stored mtime to microseconds, because that is what
// the SQL store does (`nullMicros`) and a double that keeps more precision
// than the real thing hides exactly one bug: the cheap "unchanged on disk"
// check comparing a nanosecond mtime against a microsecond one.
func (m *memPhotos) clone(p *db.Photo) *db.Photo {
	cp := *p
	if cp.Storage.ModTime != nil {
		t := time.UnixMicro(cp.Storage.ModTime.UTC().UnixMicro()).UTC()
		cp.Storage.ModTime = &t
	}
	return &cp
}

func (m *memPhotos) GetPhoto(_ context.Context, _, key string) (*db.Photo, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	p, ok := m.byKey[key]
	if !ok {
		return nil, db.ErrNotFound
	}
	return m.clone(p), nil
}

func (m *memPhotos) GetPhotoByHash(_ context.Context, hash string) (*db.Photo, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, p := range m.byKey {
		if p.Hash == hash {
			return m.clone(p), nil
		}
	}
	return nil, db.ErrNotFound
}

func (m *memPhotos) GetPhotoByPath(_ context.Context, path string) (*db.Photo, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, p := range m.byKey {
		if p.Storage.Path == path {
			return m.clone(p), nil
		}
	}
	return nil, db.ErrNotFound
}

func (m *memPhotos) UpsertPhoto(_ context.Context, p *db.Photo) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.byKey == nil {
		m.byKey = map[string]*db.Photo{}
	}
	m.byKey[p.Key] = m.clone(p)
	return nil
}

func (m *memPhotos) UpdateIndexedPhoto(_ context.Context, p *db.Photo) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	existing, ok := m.byKey[p.Key]
	if !ok {
		return db.ErrNotFound
	}
	favorite := existing.Favorite
	next := m.clone(p)
	next.Favorite = favorite
	m.byKey[p.Key] = next
	return nil
}

func (m *memPhotos) ListPhotoStorage(_ context.Context) ([]db.PhotoStorageRef, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []db.PhotoStorageRef
	for _, p := range m.byKey {
		out = append(out, db.PhotoStorageRef{Key: p.Key, Path: p.Storage.Path})
	}
	return out, nil
}

func (m *memPhotos) SoftDeletePhoto(_ context.Context, key string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if p, ok := m.byKey[key]; ok {
		now := time.Now().UTC()
		p.DeletedAt = &now
	}
	return nil
}

func writeJPEG(t *testing.T, path string, r, g, b uint8) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	img := image.NewRGBA(image.Rect(0, 0, 32, 32))
	for y := 0; y < 32; y++ {
		for x := 0; x < 32; x++ {
			img.Set(x, y, image.NewRGBA(image.Rect(0, 0, 1, 1)).At(0, 0))
			img.Pix[(y*img.Stride)+x*4+0] = r
			img.Pix[(y*img.Stride)+x*4+1] = g
			img.Pix[(y*img.Stride)+x*4+2] = b
			img.Pix[(y*img.Stride)+x*4+3] = 255
		}
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := jpeg.Encode(f, img, &jpeg.Options{Quality: 80}); err != nil {
		f.Close()
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
}

func newTestIndexer(t *testing.T, root string, repo *memPhotos) *Indexer {
	t.Helper()
	store, err := storage.NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	tg, err := thumb.NewGenerator(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return &Indexer{Store: store, DB: repo, Thumb: tg, Log: slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))}
}

func TestIndexUsesFileTimeWhenExifMissing(t *testing.T) {
	root := t.TempDir()
	key := "admin@example.com/plain.jpg"
	full := filepath.Join(root, filepath.FromSlash(key))
	writeJPEG(t, full, 200, 10, 10)
	mtime := time.Date(2022, 6, 1, 12, 0, 0, 0, time.UTC)
	if err := os.Chtimes(full, mtime, mtime); err != nil {
		t.Fatal(err)
	}
	repo := &memPhotos{}
	idx := newTestIndexer(t, root, repo)
	if _, err := idx.Run(context.Background(), Options{Prefixes: []string{"admin@example.com"}}); err != nil {
		t.Fatal(err)
	}
	if len(repo.byKey) != 1 {
		t.Fatalf("photos %d", len(repo.byKey))
	}
	for _, p := range repo.byKey {
		if p.TakenAtSource != SourceBirth && p.TakenAtSource != SourceMtime {
			t.Fatalf("source %q", p.TakenAtSource)
		}
		if p.TakenAtLocal[:10] != "2022-06-01" && p.TakenAtSource == SourceMtime {
			t.Fatalf("local %q source %q", p.TakenAtLocal, p.TakenAtSource)
		}
	}
}

func TestResyncKeepsIdentityAndFavoriteWhenContentChanges(t *testing.T) {
	root := t.TempDir()
	key := "admin@example.com/keep.jpg"
	full := filepath.Join(root, filepath.FromSlash(key))
	writeJPEG(t, full, 10, 200, 10)
	repo := &memPhotos{}
	idx := newTestIndexer(t, root, repo)
	if _, err := idx.Run(context.Background(), Options{Prefixes: []string{"admin@example.com"}}); err != nil {
		t.Fatal(err)
	}
	if len(repo.byKey) != 1 {
		t.Fatalf("photos %d", len(repo.byKey))
	}
	var id, oldHash string
	for _, p := range repo.byKey {
		id = p.Key
		oldHash = p.Hash
		p.Favorite = true
	}
	writeJPEG(t, full, 10, 10, 200)
	if _, err := idx.Run(context.Background(), Options{Prefixes: []string{"admin@example.com"}}); err != nil {
		t.Fatal(err)
	}
	if len(repo.byKey) != 1 {
		t.Fatalf("after resync photos %d", len(repo.byKey))
	}
	got := repo.byKey[id]
	if got == nil {
		t.Fatal("identity lost")
	}
	if !got.Favorite {
		t.Fatal("favorite lost")
	}
	if got.Hash == oldHash {
		t.Fatal("expected new hash")
	}
}

func TestRestoredOriginalClearsSoftDelete(t *testing.T) {
	root := t.TempDir()
	key := "admin@example.com/restore.jpg"
	full := filepath.Join(root, filepath.FromSlash(key))
	writeJPEG(t, full, 10, 200, 10)
	repo := &memPhotos{}
	idx := newTestIndexer(t, root, repo)
	if _, err := idx.Run(context.Background(), Options{Prefixes: []string{"admin@example.com"}}); err != nil {
		t.Fatal(err)
	}
	if len(repo.byKey) != 1 {
		t.Fatalf("photos %d", len(repo.byKey))
	}
	var id string
	for _, p := range repo.byKey {
		id = p.Key
	}

	if err := os.Remove(full); err != nil {
		t.Fatal(err)
	}
	if _, err := idx.Run(context.Background(), Options{Prefixes: []string{"admin@example.com"}}); err != nil {
		t.Fatal(err)
	}

	writeJPEG(t, full, 10, 200, 10)
	if _, err := idx.Run(context.Background(), Options{Prefixes: []string{"admin@example.com"}}); err != nil {
		t.Fatal(err)
	}
	got := repo.byKey[id]
	if got == nil {
		t.Fatal("identity lost")
	}
	if got.DeletedAt != nil {
		t.Fatal("expected DeletedAt cleared after same-path restore")
	}
}

// failingPrefix walks like its inner store except for one prefix, which is
// unreachable (e.g. a sleeping NAS).
type failingPrefix struct {
	storage.Storage
	down string
}

func (f failingPrefix) Walk(ctx context.Context, prefix string, fn func(storage.ObjectInfo) error) error {
	if prefix == f.down {
		return errors.New("dial tcp: connection refused")
	}
	return f.Storage.Walk(ctx, prefix, fn)
}

func (f failingPrefix) Stat(ctx context.Context, key string) (storage.ObjectInfo, error) {
	if strings.HasPrefix(key, f.down+"/") {
		return storage.ObjectInfo{}, errors.New("dial tcp: connection refused")
	}
	return f.Storage.Stat(ctx, key)
}

func TestUnreachablePrefixFailsSoftAndKeepsItsPhotos(t *testing.T) {
	root := t.TempDir()
	writeJPEG(t, filepath.Join(root, "nas", "a.jpg"), 10, 200, 10)
	writeJPEG(t, filepath.Join(root, "disk", "b.jpg"), 200, 10, 10)
	repo := &memPhotos{}
	idx := newTestIndexer(t, root, repo)
	opts := Options{Prefixes: []string{"nas", "disk"}}
	if _, err := idx.Run(context.Background(), opts); err != nil {
		t.Fatal(err)
	}
	if len(repo.byKey) != 2 {
		t.Fatalf("photos %d", len(repo.byKey))
	}

	idx.Store = failingPrefix{Storage: idx.Store, down: "nas"}
	res, err := idx.Run(context.Background(), opts)
	if err != nil {
		t.Fatalf("one reachable source should not fail the run: %v", err)
	}
	if res.Failed != 1 || res.Discovered != 1 {
		t.Fatalf("result = %+v", res)
	}
	for _, p := range repo.byKey {
		if p.DeletedAt != nil {
			t.Fatalf("pruned %s while its source was unreachable", p.Storage.Path)
		}
	}
}

// A resync must not re-read the library. The cheap check is size plus mtime,
// so the second run here should stat one file and stop — and the mtime carries
// nanoseconds, as every file on a real disk does, because that remainder is
// what the catalog drops and what the comparison used to trip over (ADR 0004).
func TestSecondRunSkipsWhatDidNotChange(t *testing.T) {
	root := t.TempDir()
	key := "admin@example.com/holiday.jpg"
	full := filepath.Join(root, filepath.FromSlash(key))
	writeJPEG(t, full, 200, 10, 10)
	mtime := time.Unix(1700000000, 123456789)
	if err := os.Chtimes(full, mtime, mtime); err != nil {
		t.Fatal(err)
	}

	repo := &memPhotos{}
	idx := newTestIndexer(t, root, repo)
	opts := Options{Prefixes: []string{"admin@example.com"}}

	first, err := idx.Run(context.Background(), opts)
	if err != nil {
		t.Fatal(err)
	}
	if first.Indexed != 1 {
		t.Fatalf("first run indexed %d, want 1", first.Indexed)
	}

	second, err := idx.Run(context.Background(), opts)
	if err != nil {
		t.Fatal(err)
	}
	if second.Skipped != 1 || second.Indexed != 0 {
		t.Errorf("second run indexed %d and skipped %d, want 0 and 1 — the file was read again",
			second.Indexed, second.Skipped)
	}
}

// --force is the way past the cheap check, for a file edited in place without
// its size or mtime moving, and for repairing a thumb that is wrong rather
// than missing.
func TestForceReindexesEvenWhenNothingChanged(t *testing.T) {
	root := t.TempDir()
	key := "admin@example.com/holiday.jpg"
	full := filepath.Join(root, filepath.FromSlash(key))
	writeJPEG(t, full, 200, 10, 10)
	mtime := time.Unix(1700000000, 123456789)
	if err := os.Chtimes(full, mtime, mtime); err != nil {
		t.Fatal(err)
	}

	repo := &memPhotos{}
	idx := newTestIndexer(t, root, repo)
	if _, err := idx.Run(context.Background(), Options{Prefixes: []string{"admin@example.com"}}); err != nil {
		t.Fatal(err)
	}
	forced, err := idx.Run(context.Background(), Options{
		Prefixes: []string{"admin@example.com"},
		Force:    true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if forced.Skipped != 0 {
		t.Errorf("forced run skipped %d, want 0", forced.Skipped)
	}
}
