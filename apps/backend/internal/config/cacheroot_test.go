package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Thumbnails are a regenerable cache, so they belong under the XDG cache
// directory — and under systemd, wherever systemd says (ADR 0028).
func TestDefaultCacheRootPrefersSystemdCacheDirectory(t *testing.T) {
	t.Setenv("CACHE_DIRECTORY", "/var/cache/memries")
	t.Setenv("XDG_CACHE_HOME", "/should/not/win")
	if got, want := defaultCacheRoot(), filepath.Join("/var/cache/memries", "thumbs"); got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

// systemd lists several directories colon-separated when a unit names more
// than one; the first is the one named first.
func TestDefaultCacheRootTakesTheFirstSystemdDirectory(t *testing.T) {
	t.Setenv("CACHE_DIRECTORY", "/var/cache/memries:/var/cache/other")
	if got := defaultCacheRoot(); got != filepath.Join("/var/cache/memries", "thumbs") {
		t.Fatalf("got %q", got)
	}
}

func TestDefaultCacheRootFallsBackToXDG(t *testing.T) {
	t.Setenv("CACHE_DIRECTORY", "")
	t.Setenv("XDG_CACHE_HOME", "/home/someone/.cache")
	if got, want := defaultCacheRoot(), "/home/someone/.cache/memries/thumbs"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

// A relative XDG_CACHE_HOME is invalid per the spec and is ignored, rather
// than producing a relative cache path for a service.
func TestDefaultCacheRootIgnoresARelativeXDGValue(t *testing.T) {
	t.Setenv("CACHE_DIRECTORY", "")
	t.Setenv("XDG_CACHE_HOME", "relative/cache")
	got := defaultCacheRoot()
	if strings.Contains(got, "relative/cache") {
		t.Fatalf("relative XDG_CACHE_HOME was honoured: %q", got)
	}
}

func TestDefaultCacheRootUsesTheHomeCacheDirectory(t *testing.T) {
	t.Setenv("CACHE_DIRECTORY", "")
	t.Setenv("XDG_CACHE_HOME", "")
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		t.Skip("no home directory here")
	}
	if got, want := defaultCacheRoot(), filepath.Join(home, ".cache", "memries", "thumbs"); got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}
