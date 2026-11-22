package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type Config struct {
	Addr string
	// DBDriver is "sqlite" (the default) or "postgres" (ADR 0014).
	DBDriver string
	// DBDSN is a file path for sqlite, a connection URL for postgres.
	DBDSN          string
	StorageBackend string
	LocalRoot      string
	CacheRoot      string
	S3Endpoint     string
	S3Bucket       string
	S3AccessKey    string
	S3SecretKey    string
	S3Region       string
	SessionKey     string
	PublicURL      string
	// BootstrapPassword gives the AdminEmails accounts a password on a fresh
	// install (ADR 0016). It only ever fills an empty one, so leaving it set
	// in a unit file does not undo a later password change.
	BootstrapPassword string
	// AdminEmails may manage Sources. Lowercased.
	AdminEmails []string
	// SourceRoots are directories local Sources must live under. LocalRoot is always allowed.
	SourceRoots []string
	// CacheRoots are directories the thumbnail cache may be moved to by an
	// admin (ADR 0022). CacheRoot's own parent is always allowed, so the
	// default install can move the cache beside itself without configuration.
	CacheRoots []string
}

// IsAdmin reports whether email may manage Sources.
func (c *Config) IsAdmin(email string) bool {
	e := strings.ToLower(strings.TrimSpace(email))
	if e == "" {
		return false
	}
	for _, a := range c.AdminEmails {
		if a == e {
			return true
		}
	}
	return false
}

func FromEnv() (*Config, error) {
	c := &Config{
		Addr:              env("MEMRIES_ADDR", ":8080"),
		DBDriver:          env("MEMRIES_DB_DRIVER", "sqlite"),
		DBDSN:             env("MEMRIES_DB_DSN", "./data/memries.db"),
		StorageBackend:    env("MEMRIES_STORAGE_BACKEND", "local"),
		LocalRoot:         env("MEMRIES_LOCAL_ROOT", "./data/photos"),
		CacheRoot:         env("MEMRIES_CACHE_ROOT", defaultCacheRoot()),
		S3Endpoint:        os.Getenv("MEMRIES_S3_ENDPOINT"),
		S3Bucket:          os.Getenv("MEMRIES_S3_BUCKET"),
		S3AccessKey:       os.Getenv("MEMRIES_S3_ACCESS_KEY"),
		S3SecretKey:       os.Getenv("MEMRIES_S3_SECRET_KEY"),
		S3Region:          env("MEMRIES_S3_REGION", "us-east-1"),
		SessionKey:        os.Getenv("MEMRIES_SESSION_KEY"),
		PublicURL:         env("MEMRIES_PUBLIC_URL", "http://localhost"),
		BootstrapPassword: os.Getenv("MEMRIES_BOOTSTRAP_PASSWORD"),
	}
	c.AdminEmails = splitList(os.Getenv("MEMRIES_ADMIN_EMAILS"), strings.ToLower)
	c.SourceRoots = append([]string{c.LocalRoot}, splitList(os.Getenv("MEMRIES_SOURCE_ROOTS"), filepath.Clean)...)
	// An absolute cache root, so a service started from / does not scatter a
	// relative directory wherever its working directory happened to be, and
	// so the admin page shows a path that means something (ADR 0022).
	if abs, err := filepath.Abs(c.CacheRoot); err == nil {
		c.CacheRoot = abs
	}
	cacheParent := filepath.Dir(filepath.Clean(c.CacheRoot))
	c.CacheRoots = append([]string{cacheParent}, splitList(os.Getenv("MEMRIES_CACHE_ROOTS"), filepath.Clean)...)
	if c.DBDSN == "" {
		return nil, fmt.Errorf("MEMRIES_DB_DSN required")
	}
	if c.SessionKey == "" {
		return nil, fmt.Errorf("MEMRIES_SESSION_KEY required")
	}
	return c, nil
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// splitList parses a comma-separated env value, dropping blanks.
func splitList(v string, norm func(string) string) []string {
	var out []string
	for _, part := range strings.Split(v, ",") {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, norm(part))
		}
	}
	return out
}

// defaultCacheRoot is where generated thumbnails go when MEMRIES_CACHE_ROOT
// says nothing.
//
// Thumbnails are a regenerable cache — reindexing rebuilds them — so they
// belong under the XDG cache directory rather than in a data directory a
// reader would miss. The order matters:
//
//  1. $CACHE_DIRECTORY, which systemd sets from CacheDirectory=memries. It
//     gives /var/cache/memries for a system unit and ~/.cache/memries under
//     systemd --user, which is the FHS answer in both cases — a system
//     account often has no usable home at all.
//  2. $XDG_CACHE_HOME/memries, for a plain run with the spec honoured.
//  3. ~/.cache/memries, the spec's own default.
//
// A last resort of ./data/cache keeps a checkout runnable on a machine with
// no home directory, which is what the dev Compose file sets explicitly
// anyway.
func defaultCacheRoot() string {
	if dir := strings.TrimSpace(os.Getenv("CACHE_DIRECTORY")); dir != "" {
		// systemd may list several directories, colon-separated; the first is
		// the one named first in the unit.
		if first := strings.Split(dir, ":")[0]; first != "" {
			return filepath.Join(first, "thumbs")
		}
	}
	if xdg := strings.TrimSpace(os.Getenv("XDG_CACHE_HOME")); xdg != "" && filepath.IsAbs(xdg) {
		return filepath.Join(xdg, "memries", "thumbs")
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return filepath.Join(home, ".cache", "memries", "thumbs")
	}
	return filepath.Join("data", "cache")
}
