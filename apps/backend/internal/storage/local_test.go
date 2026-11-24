package storage

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestResolveKeepsRootOnUnix(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix join semantics")
	}
	l := &Local{root: "/data/photos"}
	full, err := l.resolve("admin@example.com/foo.jpg")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	want := "/data/photos/admin@example.com/foo.jpg"
	if full != want {
		t.Fatalf("got %q want %q", full, want)
	}
}

func TestLocalGetReadsOwnerPrefixedKey(t *testing.T) {
	root := t.TempDir()
	store, err := NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	key := "admin@example.com/71ef5782-09ef-486d-85e2-f73558d18d7a.jpg"
	full := filepath.Join(root, filepath.FromSlash(key))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	want := []byte("jpeg-bytes")
	if err := os.WriteFile(full, want, 0o644); err != nil {
		t.Fatal(err)
	}

	rc, err := store.Get(context.Background(), key)
	if err != nil {
		t.Fatalf("Get(%q): %v", key, err)
	}
	defer rc.Close()
	got, err := io.ReadAll(rc)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestLocalGetRejectsPathEscape(t *testing.T) {
	root := t.TempDir()
	store, err := NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.Get(context.Background(), "../outside.jpg")
	if err == nil {
		t.Fatal("expected path escape error")
	}
	if !strings.Contains(err.Error(), "path escape") {
		t.Fatalf("got %v, want path escape", err)
	}
}

func TestLocalGetMissingFile(t *testing.T) {
	root := t.TempDir()
	store, err := NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.Get(context.Background(), "admin@example.com/missing.jpg")
	if !IsNotFound(err) {
		t.Fatalf("got %v, want not found", err)
	}
}

// An excluded tree is gone as far as this Source is concerned, not merely
// unwalked: the prune pass asks Stat whether an unseen path still exists, so
// a Stat that looked past the exclude would keep the Photo alive for ever
// (ADR 0020).
func TestLocalHidesAnExcludedTreeFromStatAndGet(t *testing.T) {
	root := t.TempDir()
	for _, rel := range []string{"keep/a.jpg", "RAW/b.jpg", "RAW/deep/c.jpg", "RAWSCANS/d.jpg"} {
		p := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	l, err := NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	l.SkipDir = func(dir string) bool { return dir == "RAW" || strings.HasPrefix(dir, "RAW/") }

	for _, key := range []string{"RAW/b.jpg", "RAW/deep/c.jpg"} {
		if _, err := l.Stat(context.Background(), key); !IsNotFound(err) {
			t.Errorf("Stat(%q) = %v, want not found", key, err)
		}
		if _, err := l.Get(context.Background(), key); !IsNotFound(err) {
			t.Errorf("Get(%q) = %v, want not found", key, err)
		}
	}
	// A folder whose name merely starts the same is a different folder.
	for _, key := range []string{"keep/a.jpg", "RAWSCANS/d.jpg"} {
		if _, err := l.Stat(context.Background(), key); err != nil {
			t.Errorf("Stat(%q) = %v, want it to exist", key, err)
		}
	}
}

// Without excludes nothing changes, and the file itself is never offered to
// the filter: the patterns name folders.
func TestLocalWithoutExcludesStatsEverything(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "a.jpg"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	l, err := NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := l.Stat(context.Background(), "a.jpg"); err != nil {
		t.Fatal(err)
	}
	asked := []string{}
	l.SkipDir = func(dir string) bool {
		asked = append(asked, dir)
		return false
	}
	if _, err := l.Stat(context.Background(), "a.jpg"); err != nil {
		t.Fatal(err)
	}
	if len(asked) != 0 {
		t.Errorf("a file in the root asked the filter about %v", asked)
	}
}
