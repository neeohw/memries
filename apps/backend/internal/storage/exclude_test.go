package storage

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

func seedTree(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	files := []string{
		"a.jpg",
		"2019/old.jpg",
		"2019/08/older.jpg",
		"2026/new.jpg",
		"2026/.thumbs/cache.jpg",
		"2026/RAW/raw.jpg",
	}
	for _, f := range files {
		p := filepath.Join(root, filepath.FromSlash(f))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func walked(t *testing.T, l *Local) []string {
	t.Helper()
	var keys []string
	if err := l.Walk(context.Background(), "", func(o ObjectInfo) error {
		keys = append(keys, filepath.ToSlash(o.Key))
		return nil
	}); err != nil {
		t.Fatalf("walk: %v", err)
	}
	sort.Strings(keys)
	return keys
}

func TestLocalWalkSkipsExcludedTrees(t *testing.T) {
	root := seedTree(t)
	l, err := OpenLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	before := walked(t, l)
	if len(before) != 6 {
		t.Fatalf("expected 6 files before excluding, got %v", before)
	}

	var asked []string
	l.SkipDir = func(dir string) bool {
		asked = append(asked, dir)
		return dir == "2019" || strings.HasSuffix(dir, "/.thumbs")
	}
	after := walked(t, l)
	want := []string{"2026/RAW/raw.jpg", "2026/new.jpg", "a.jpg"}
	if strings.Join(after, " ") != strings.Join(want, " ") {
		t.Fatalf("after excluding got %v, want %v", after, want)
	}

	// The point of skipping at the directory, not filtering files: nothing
	// below an excluded tree is ever asked about.
	for _, dir := range asked {
		if strings.HasPrefix(dir, "2019/") {
			t.Fatalf("descended into an excluded tree: %q", dir)
		}
	}
}

func TestLocalWalkNeverSkipsItsOwnBase(t *testing.T) {
	l, err := OpenLocal(seedTree(t))
	if err != nil {
		t.Fatal(err)
	}
	l.SkipDir = func(string) bool { return true }
	// Everything is excluded, but the base is not a candidate, so the files
	// directly in it still index.
	if got := walked(t, l); strings.Join(got, " ") != "a.jpg" {
		t.Fatalf("got %v, want just a.jpg", got)
	}
}
