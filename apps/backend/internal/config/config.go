// Package config reads the server's settings from one YAML file.
//
// There is no environment-variable layer. A setting has exactly one home, so
// "where does this value come from" never has two answers, and a running
// server can be explained by one file that can be read, diffed and backed up
// (ADR 0028).
package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// DefaultPath is where the server looks when nothing says otherwise.
const DefaultPath = "/etc/memries/config.yaml"

// LocalPath is tried before DefaultPath, so a checkout runs from its own
// directory without touching /etc.
const LocalPath = "memries.yaml"

// EnvPath names the file. It is the one environment variable left: a process
// has to be told where its configuration lives, and that is not itself a
// setting.
const EnvPath = "MEMRIES_CONFIG"

type Config struct {
	Server   Server   `yaml:"server"`
	Database Database `yaml:"database"`
	Library  Library  `yaml:"library"`
	Admins   Admins   `yaml:"admins"`
	Storage  Storage  `yaml:"storage"`

	// Path is the file this was read from, for log lines and error messages
	// that would otherwise leave a reader guessing which file is in force.
	Path string `yaml:"-"`
}

type Server struct {
	Addr string `yaml:"addr"`
	// PublicURL is the origin browsers reach this server on. It is the CORS
	// allow-list, so a wrong value shows up as a blank page, not a warning.
	PublicURL string `yaml:"public_url"`
	// SessionKey signs session cookies: 32 bytes, base64. Rotating it signs
	// everyone out and means re-entering folder passwords (ADR 0013).
	SessionKey string `yaml:"session_key"`
	// E2E relaxes a check for the Playwright suite. Never set in production.
	E2E bool `yaml:"e2e"`
}

type Database struct {
	// Driver is "sqlite" (the default) or "postgres" (ADR 0014).
	Driver string `yaml:"driver"`
	// DSN is a file path for sqlite, a connection URL for postgres.
	DSN string `yaml:"dsn"`
}

type Library struct {
	// Roots are the directories a local folder may live under. The first is
	// also where the pre-Sources local store reads from.
	Roots []string `yaml:"roots"`
	// Cache is where generated thumbnails are written. Thumbnails are
	// regenerable, so this is a cache directory rather than data. Optional:
	// left out, it follows the platform's cache location (ADR 0028).
	Cache string `yaml:"cache"`
}

type Admins struct {
	// Emails may manage folders. Lowercased on load.
	Emails []string `yaml:"emails"`
	// BootstrapPassword gives those accounts a password on a fresh install
	// (ADR 0016). It only ever fills an empty one, so leaving it in the file
	// does not undo a later password change.
	BootstrapPassword string `yaml:"bootstrap_password"`
}

// Storage is the originals backend. Local is the only one Phase 1 ships;
// the S3 fields exist because the factory still reads them.
type Storage struct {
	Backend string `yaml:"backend"`
	S3      S3     `yaml:"s3"`
}

type S3 struct {
	Endpoint  string `yaml:"endpoint"`
	Bucket    string `yaml:"bucket"`
	AccessKey string `yaml:"access_key"`
	SecretKey string `yaml:"secret_key"`
	Region    string `yaml:"region"`
}

// IsAdmin reports whether email may manage folders.
func (c *Config) IsAdmin(email string) bool {
	e := strings.ToLower(strings.TrimSpace(email))
	if e == "" {
		return false
	}
	for _, a := range c.Admins.Emails {
		if a == e {
			return true
		}
	}
	return false
}

// LocalRoot is the first library root: where the pre-Sources local storage
// backend reads, and the folder an admin's path is relative to by default.
func (c *Config) LocalRoot() string {
	if len(c.Library.Roots) == 0 {
		return ""
	}
	return c.Library.Roots[0]
}

// Find returns the configuration file to read: the path given on the command
// line, then $MEMRIES_CONFIG, then ./memries.yaml, then /etc/memries.
func Find(flagPath string) string {
	if p := strings.TrimSpace(flagPath); p != "" {
		return p
	}
	if p := strings.TrimSpace(os.Getenv(EnvPath)); p != "" {
		return p
	}
	if _, err := os.Stat(LocalPath); err == nil {
		return LocalPath
	}
	return DefaultPath
}

// Load reads and validates one file.
//
// Unknown fields are an error rather than a shrug: a misspelled key in a file
// that is the only source of truth would otherwise be silently ignored and
// the default used, which is the failure mode this format exists to avoid.
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("no configuration file at %s: copy memries.example.yaml and edit it, or pass --config", path)
		}
		return nil, err
	}
	c := &Config{Path: path}
	dec := yaml.NewDecoder(strings.NewReader(string(data)))
	dec.KnownFields(true)
	if err := dec.Decode(c); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	c.applyDefaults()
	if err := c.validate(); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return c, nil
}

func (c *Config) applyDefaults() {
	if c.Server.Addr == "" {
		c.Server.Addr = ":8080"
	}
	if c.Server.PublicURL == "" {
		c.Server.PublicURL = "http://localhost"
	}
	if c.Database.Driver == "" {
		c.Database.Driver = "sqlite"
	}
	if c.Storage.Backend == "" {
		c.Storage.Backend = "local"
	}
	if c.Storage.S3.Region == "" {
		c.Storage.S3.Region = "us-east-1"
	}
	roots := make([]string, 0, len(c.Library.Roots))
	for _, r := range c.Library.Roots {
		if r = strings.TrimSpace(r); r != "" {
			roots = append(roots, filepath.Clean(r))
		}
	}
	c.Library.Roots = roots

	emails := make([]string, 0, len(c.Admins.Emails))
	for _, e := range c.Admins.Emails {
		if e = strings.ToLower(strings.TrimSpace(e)); e != "" {
			emails = append(emails, e)
		}
	}
	c.Admins.Emails = emails

	if c.Library.Cache = strings.TrimSpace(c.Library.Cache); c.Library.Cache == "" {
		c.Library.Cache = defaultCacheRoot()
	}
	// An absolute cache path, so a service started from / does not scatter a
	// relative directory wherever its working directory happened to be.
	if abs, err := filepath.Abs(c.Library.Cache); err == nil {
		c.Library.Cache = abs
	}
}

func (c *Config) validate() error {
	var missing []string
	if c.Database.DSN == "" {
		missing = append(missing, "database.dsn")
	}
	if c.Server.SessionKey == "" {
		missing = append(missing, "server.session_key")
	}
	if len(c.Library.Roots) == 0 {
		missing = append(missing, "library.roots")
	}
	if len(missing) > 0 {
		return fmt.Errorf("missing required setting(s): %s", strings.Join(missing, ", "))
	}
	switch c.Database.Driver {
	case "sqlite", "postgres":
	default:
		return fmt.Errorf("database.driver must be sqlite or postgres, not %q", c.Database.Driver)
	}
	return nil
}

// WorldReadable reports whether the file can be read by anyone at all.
//
// It holds the session key and the bootstrap password, so this is worth
// saying out loud. It is a warning and not a refusal: a bind-mounted file in
// a container is routinely 0644 and the server still has to start.
//
// Group access is deliberately not flagged. The Debian package installs the
// config as root:memries 0640, which is how a service account reads a file it
// does not own — the tighter check called that out as a problem on every
// start of a correctly installed system (ADR 0030).
func WorldReadable(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return info.Mode().Perm()&0o007 != 0
}

// defaultCacheRoot is where generated thumbnails go when library.cache says
// nothing.
//
// Thumbnails are a regenerable cache — reindexing rebuilds them — so they
// belong under the platform's cache directory rather than in a data
// directory a reader would miss. This is the one place the environment is
// still consulted, and for the same reason $MEMRIES_CONFIG is: the service
// manager is telling the process where its directories are, which is not
// itself a setting.
//
//  1. $CACHE_DIRECTORY, which systemd sets from CacheDirectory=memries. It
//     gives /var/cache/memries for a system unit and ~/.cache/memries under
//     systemd --user, which is the FHS answer in both cases — a system
//     account often has no usable home at all.
//  2. $XDG_CACHE_HOME/memries, for a plain run with the spec honoured.
//  3. ~/.cache/memries, the spec's own default.
//
// A last resort of ./data/cache keeps a checkout runnable on a machine with
// no home directory.
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
