package sources

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNormalizeLocalRequiresAllowedRoot(t *testing.T) {
	root := t.TempDir()
	inside := filepath.Join(root, "family")
	if err := os.Mkdir(inside, 0o755); err != nil {
		t.Fatal(err)
	}
	got, err := normalizeLocation(TypeLocal, inside+"/", []string{root})
	if err != nil || got != inside {
		t.Fatalf("got %q err %v", got, err)
	}
	for _, bad := range []string{"relative/dir", filepath.Join(root, "..", "elsewhere"), "/etc"} {
		if _, err := normalizeLocation(TypeLocal, bad, []string{root}); !errors.Is(err, ErrInvalid) {
			t.Fatalf("%q: err = %v", bad, err)
		}
	}
}

func TestNormalizeLocalRejectsSymlinkOutOfRoot(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	link := filepath.Join(root, "sneaky")
	if err := os.Symlink(outside, link); err != nil {
		t.Skip("symlinks unsupported")
	}
	if _, err := normalizeLocation(TypeLocal, link, []string{root}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("err = %v", err)
	}
}

func TestSMBSourcesAreRejectedWithSomethingToDo(t *testing.T) {
	// Rows written before ADR 0020 removed SMB still exist. Opening one must
	// say what to do about it, not report an unknown type.
	_, err := normalizeLocation(TypeSMB, "smb://nas/photos", nil)
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("err = %v, want ErrInvalid", err)
	}
	if !strings.Contains(err.Error(), "mount the share") {
		t.Fatalf("error should say what to do instead, got %v", err)
	}
}

func TestNormalizeWebDAV(t *testing.T) {
	got, err := normalizeLocation(TypeWebDAV, "HTTPS://cloud.example.com/remote.php/dav/files/me/Photos/?x=1", nil)
	if err != nil || got != "https://cloud.example.com/remote.php/dav/files/me/Photos" {
		t.Fatalf("got %q err %v", got, err)
	}
	for _, bad := range []string{"ftp://host/x", "https://me:pw@host/dav", "not a url"} {
		if _, err := normalizeLocation(TypeWebDAV, bad, nil); !errors.Is(err, ErrInvalid) {
			t.Fatalf("%q: err = %v", bad, err)
		}
	}
}

func TestSealerRoundTrip(t *testing.T) {
	s, _ := NewSealer("secret-a")
	sealed, err := s.Seal("hunter2")
	if err != nil || sealed == "" || sealed == "hunter2" {
		t.Fatalf("sealed %q err %v", sealed, err)
	}
	if plain, err := s.Open(sealed); err != nil || plain != "hunter2" {
		t.Fatalf("plain %q err %v", plain, err)
	}
	other, _ := NewSealer("secret-b")
	if _, err := other.Open(sealed); err == nil {
		t.Fatal("other key must not open")
	}
	if empty, _ := s.Seal(""); empty != "" {
		t.Fatal("empty password stays empty")
	}
}
