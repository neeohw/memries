package sources

import (
	"context"
	"image/color"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/memries/memries/internal/db"
	"github.com/memries/memries/internal/index"
	"github.com/memries/memries/internal/thumb"
)

// twoLibraries lays out two folders that share a shape but no bytes, so a
// photo missing from one cannot be explained by deduplication against the
// other.
func twoLibraries(t *testing.T) (root string) {
	t.Helper()
	root = t.TempDir()
	files := map[string]color.RGBA{
		"libA/keep/a.jpg": {200, 10, 10, 255},
		"libA/RAW/b.jpg":  {10, 200, 10, 255},
		"libB/keep/c.jpg": {10, 10, 200, 255},
		"libB/RAW/d.jpg":  {200, 200, 10, 255},
	}
	for rel, c := range files {
		p := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, jpegBytes(t, c), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func indexerOver(t *testing.T, reg *Registry) (*index.Indexer, *memPhotos) {
	t.Helper()
	tg, err := thumb.NewGenerator(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	photos := &memPhotos{byKey: map[string]*db.Photo{}}
	return &index.Indexer{Store: reg, DB: photos, Thumb: tg, Log: reg.Log}, photos
}

func runAll(t *testing.T, reg *Registry, idx *index.Indexer) {
	t.Helper()
	ctx := context.Background()
	scopes, err := reg.Scopes(ctx)
	if err != nil {
		t.Fatal(err)
	}
	prefixes := make([]string, 0, len(scopes))
	for _, s := range scopes {
		prefixes = append(prefixes, s.Prefix)
	}
	sort.Strings(prefixes)
	if _, err := idx.Run(ctx, index.Options{Prefixes: prefixes}); err != nil {
		t.Fatal(err)
	}
}

// livePaths names what is in the library, with each Source's id replaced by
// the name it was created with so a failure reads as folder paths.
func livePaths(photos *memPhotos, names map[string]string) []string {
	var out []string
	photos.mu.Lock()
	defer photos.mu.Unlock()
	for _, p := range photos.byKey {
		if p.DeletedAt != nil {
			continue
		}
		path := p.Storage.Path
		if id, rest, ok := strings.Cut(path, "/"); ok {
			if name, known := names[id]; known {
				path = name + "/" + rest
			}
		}
		out = append(out, path)
	}
	sort.Strings(out)
	return out
}

// An exclude belongs to the folder it was typed into. One folder's patterns
// must never reach another's tree (ADR 0013, ADR 0020).
func TestExcludesApplyToTheirOwnSourceOnly(t *testing.T) {
	root := twoLibraries(t)
	sealer, err := NewSealer("test-secret")
	if err != nil {
		t.Fatal(err)
	}
	reg := &Registry{
		Repo:   newMemRepo(),
		Sealer: sealer,
		Roots:  []string{root},
		Log:    slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	ctx := context.Background()

	a, err := reg.Create(ctx, Input{Name: "libA", Type: TypeLocal, Location: filepath.Join(root, "libA")})
	if err != nil {
		t.Fatal(err)
	}
	b, err := reg.Create(ctx, Input{
		Name: "libB", Type: TypeLocal, Location: filepath.Join(root, "libB"),
		Excludes: []string{"^RAW"},
	})
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]string{a.ID: "libA", b.ID: "libB"}

	idx, photos := indexerOver(t, reg)
	runAll(t, reg, idx)

	want := []string{"libA/RAW/b.jpg", "libA/keep/a.jpg", "libB/keep/c.jpg"}
	if got := livePaths(photos, names); !equalPaths(got, want) {
		t.Errorf("library = %v, want %v", got, want)
	}
}

// The same, the other way round: adding a pattern to a folder that is
// already indexed must take photos out of that folder and no other.
func TestAddingAnExcludeLeavesTheOtherFolderAlone(t *testing.T) {
	root := twoLibraries(t)
	sealer, err := NewSealer("test-secret")
	if err != nil {
		t.Fatal(err)
	}
	reg := &Registry{
		Repo:   newMemRepo(),
		Sealer: sealer,
		Roots:  []string{root},
		Log:    slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	ctx := context.Background()

	a, err := reg.Create(ctx, Input{Name: "libA", Type: TypeLocal, Location: filepath.Join(root, "libA")})
	if err != nil {
		t.Fatal(err)
	}
	b, err := reg.Create(ctx, Input{Name: "libB", Type: TypeLocal, Location: filepath.Join(root, "libB")})
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]string{a.ID: "libA", b.ID: "libB"}

	idx, photos := indexerOver(t, reg)
	runAll(t, reg, idx)
	all := []string{"libA/RAW/b.jpg", "libA/keep/a.jpg", "libB/RAW/d.jpg", "libB/keep/c.jpg"}
	if got := livePaths(photos, names); !equalPaths(got, all) {
		t.Fatalf("first run = %v, want %v", got, all)
	}

	if _, err := reg.Update(ctx, b.ID, Input{
		Name: "libB", Type: TypeLocal, Location: filepath.Join(root, "libB"),
		Excludes: []string{"^RAW"},
	}); err != nil {
		t.Fatal(err)
	}
	runAll(t, reg, idx)

	want := []string{"libA/RAW/b.jpg", "libA/keep/a.jpg", "libB/keep/c.jpg"}
	if got := livePaths(photos, names); !equalPaths(got, want) {
		t.Errorf("after excluding libB/RAW = %v, want %v", got, want)
	}
}

func equalPaths(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}
