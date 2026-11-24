package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func write(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "memries.yaml")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

const minimal = `
server:
  session_key: "a2V5"
database:
  dsn: /data/db/memries.db
library:
  roots:
    - /data/photos
  cache: /data/cache
`

func TestLoadReadsTheFile(t *testing.T) {
	c, err := Load(write(t, minimal+`
admins:
  emails:
    - Admin@Example.com
    - ""
  bootstrap_password: secret
`))
	if err != nil {
		t.Fatal(err)
	}
	if c.Database.DSN != "/data/db/memries.db" || c.Library.Cache != "/data/cache" {
		t.Errorf("config = %+v", c)
	}
	// Lowercased on load, so an address typed with capitals still matches the
	// one the identity provider sends.
	if !c.IsAdmin("admin@example.com") || c.IsAdmin("someone@example.com") {
		t.Errorf("admins = %v", c.Admins.Emails)
	}
	if len(c.Admins.Emails) != 1 {
		t.Errorf("a blank address was kept: %v", c.Admins.Emails)
	}
	if c.LocalRoot() != "/data/photos" {
		t.Errorf("LocalRoot = %q", c.LocalRoot())
	}
	if c.Path == "" {
		t.Error("the file it came from should be recorded")
	}
}

func TestLoadFillsTheDefaults(t *testing.T) {
	c, err := Load(write(t, minimal))
	if err != nil {
		t.Fatal(err)
	}
	if c.Server.Addr != ":8080" || c.Server.PublicURL != "http://localhost" {
		t.Errorf("server = %+v", c.Server)
	}
	if c.Database.Driver != "sqlite" || c.Storage.Backend != "local" {
		t.Errorf("driver = %q, backend = %q", c.Database.Driver, c.Storage.Backend)
	}
}

// Omitting the cache is allowed: the platform's cache directory is a better
// answer than making every install state one (ADR 0028).
func TestLoadDefaultsTheCacheToThePlatformLocation(t *testing.T) {
	t.Setenv("CACHE_DIRECTORY", "/var/cache/memries")
	c, err := Load(write(t, `
server:
  session_key: "a2V5"
database:
  dsn: /x.db
library:
  roots: [/data/photos]
`))
	if err != nil {
		t.Fatal(err)
	}
	if c.Library.Cache != filepath.Join("/var/cache/memries", "thumbs") {
		t.Errorf("cache = %q", c.Library.Cache)
	}
}

// A service started from / must not scatter a relative directory.
func TestLoadMakesTheCacheAbsolute(t *testing.T) {
	c, err := Load(write(t, strings.Replace(minimal, "cache: /data/cache", "cache: data/cache", 1)))
	if err != nil {
		t.Fatal(err)
	}
	if !filepath.IsAbs(c.Library.Cache) {
		t.Errorf("cache %q is not absolute", c.Library.Cache)
	}
}

// The file is the only source of truth, so a misspelled key must not be
// quietly ignored in favour of a default.
func TestLoadRejectsAnUnknownKey(t *testing.T) {
	_, err := Load(write(t, minimal+"\nlibrarry:\n  cache: /tmp\n"))
	if err == nil || !strings.Contains(err.Error(), "librarry") {
		t.Fatalf("err = %v", err)
	}
}

func TestLoadReportsEveryMissingSetting(t *testing.T) {
	_, err := Load(write(t, "server:\n  addr: \":9000\"\n"))
	if err == nil {
		t.Fatal("want an error")
	}
	for _, want := range []string{"database.dsn", "server.session_key", "library.roots"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("%q missing from: %v", want, err)
		}
	}
}

func TestLoadRejectsAnUnknownDriver(t *testing.T) {
	_, err := Load(write(t, strings.Replace(minimal, "database:", "database:\n  driver: mysql", 1)))
	if err == nil || !strings.Contains(err.Error(), "sqlite or postgres") {
		t.Fatalf("err = %v", err)
	}
}

// The message has to say what to do, because this is the first thing a new
// install hits.
func TestLoadSaysWhatToDoWhenTheFileIsMissing(t *testing.T) {
	_, err := Load(filepath.Join(t.TempDir(), "nope.yaml"))
	if err == nil || !strings.Contains(err.Error(), "memries.example.yaml") {
		t.Fatalf("err = %v", err)
	}
}

func TestFindPrefersTheFlagThenTheEnvironment(t *testing.T) {
	t.Setenv(EnvPath, "/from/env.yaml")
	if got := Find("/from/flag.yaml"); got != "/from/flag.yaml" {
		t.Errorf("flag should win: %q", got)
	}
	if got := Find(""); got != "/from/env.yaml" {
		t.Errorf("env should be next: %q", got)
	}
	t.Setenv(EnvPath, "")
	// Nothing to go on and no file beside the binary: the packaged location.
	t.Chdir(t.TempDir())
	if got := Find(""); got != DefaultPath {
		t.Errorf("fallback = %q, want %q", got, DefaultPath)
	}
	if err := os.WriteFile(LocalPath, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := Find(""); got != LocalPath {
		t.Errorf("a file in the working directory should win: %q", got)
	}
}

// The file holds the session key and the bootstrap password.
func TestWorldReadableNoticesLoosePermissions(t *testing.T) {
	path := write(t, minimal)
	for _, mode := range []os.FileMode{0o600, 0o640, 0o660} {
		if err := os.Chmod(path, mode); err != nil {
			t.Fatal(err)
		}
		// 0640 root:memries is how the Debian package ships it: group access
		// is how a service account reads a file it does not own, not a
		// mistake to warn about on every start (ADR 0030).
		if WorldReadable(path) {
			t.Errorf("%o should be fine", mode)
		}
	}
	for _, mode := range []os.FileMode{0o644, 0o604, 0o666} {
		if err := os.Chmod(path, mode); err != nil {
			t.Fatal(err)
		}
		if !WorldReadable(path) {
			t.Errorf("%o should be reported", mode)
		}
	}
	if WorldReadable(filepath.Join(t.TempDir(), "absent")) {
		t.Error("a missing file is not a permissions problem")
	}
}
