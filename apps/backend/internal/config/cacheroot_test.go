package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Thumbnails are a regenerable cache, so they belong under the XDG cache
// directory — and under systemd, wherever systemd says (ADR 0022).
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

// Whatever the source, the configured root ends up absolute: a service
// started from / must not scatter a relative directory, and the admin page
// has to show a path that means something.
func TestFromEnvMakesTheCacheRootAbsolute(t *testing.T) {
	t.Setenv("MEMRIES_CACHE_ROOT", "data/cache")
	t.Setenv("MEMRIES_SESSION_KEY", "k")
	c, err := FromEnv()
	if err != nil {
		t.Fatal(err)
	}
	if !filepath.IsAbs(c.CacheRoot) {
		t.Fatalf("cache root %q is not absolute", c.CacheRoot)
	}
	if filepath.Base(c.CacheRoot) != "cache" {
		t.Fatalf("cache root %q lost its name", c.CacheRoot)
	}
}

// An explicit MEMRIES_CACHE_ROOT still wins, which is what the dev Compose
// file relies on.
func TestFromEnvHonoursAnExplicitCacheRoot(t *testing.T) {
	t.Setenv("MEMRIES_CACHE_ROOT", "/media/sdhc/memries/thumbs")
	t.Setenv("CACHE_DIRECTORY", "/var/cache/memries")
	t.Setenv("MEMRIES_SESSION_KEY", "k")
	c, err := FromEnv()
	if err != nil {
		t.Fatal(err)
	}
	if c.CacheRoot != "/media/sdhc/memries/thumbs" {
		t.Fatalf("got %q", c.CacheRoot)
	}
	// The cache root's parent is always an allowed destination, so an admin
	// can move the cache beside itself with no extra configuration.
	if c.CacheRoots[0] != "/media/sdhc/memries" {
		t.Fatalf("allowed roots %+v", c.CacheRoots)
	}
}
