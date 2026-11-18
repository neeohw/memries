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
		CacheRoot:         env("MEMRIES_CACHE_ROOT", "./data/cache"),
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
