package index

import (
	"bytes"
	"context"
	"image"
	"image/jpeg"
	"log/slog"
	"os"
	"path/filepath"
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

func (m *memPhotos) clone(p *db.Photo) *db.Photo {
	cp := *p
	return &cp
}

func (m *memPhotos) GetPhoto(_ context.Context, key string) (*db.Photo, error) {
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

func (m *memPhotos) GetPhotoByOwnerPath(_ context.Context, ownerID, path string) (*db.Photo, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, p := range m.byKey {
		if p.OwnerID == ownerID && p.Storage.Path == path {
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

func (m *memPhotos) ListOwnerPhotoStorage(_ context.Context, ownerID string) ([]db.PhotoStorageRef, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []db.PhotoStorageRef
	for _, p := range m.byKey {
		if p.OwnerID == ownerID {
			out = append(out, db.PhotoStorageRef{Key: p.Key, Path: p.Storage.Path})
		}
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
	if _, err := idx.Run(context.Background(), Options{OwnerID: "owner", Prefix: "admin@example.com"}); err != nil {
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
	if _, err := idx.Run(context.Background(), Options{OwnerID: "owner", Prefix: "admin@example.com"}); err != nil {
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
	if _, err := idx.Run(context.Background(), Options{OwnerID: "owner", Prefix: "admin@example.com"}); err != nil {
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
	if _, err := idx.Run(context.Background(), Options{OwnerID: "owner", Prefix: "admin@example.com"}); err != nil {
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
	if _, err := idx.Run(context.Background(), Options{OwnerID: "owner", Prefix: "admin@example.com"}); err != nil {
		t.Fatal(err)
	}

	writeJPEG(t, full, 10, 200, 10)
	if _, err := idx.Run(context.Background(), Options{OwnerID: "owner", Prefix: "admin@example.com"}); err != nil {
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
