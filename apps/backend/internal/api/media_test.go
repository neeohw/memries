package api

import (
	"errors"
	"io/fs"
	"net/http"
	"testing"

	"github.com/memries/memries/internal/db"
	"github.com/memries/memries/internal/storage"
)

func TestThumbCandidatesRunLargestFirst(t *testing.T) {
	got := thumbCandidates(db.Thumbs{S256: "s.jpg", S512: "m.jpg", S1024: "l.jpg"})
	want := []string{"l.jpg", "m.jpg", "s.jpg"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

// Only written renditions are offered, so the caller never tries to open an
// empty path.
func TestThumbCandidatesSkipUnwrittenRenditions(t *testing.T) {
	got := thumbCandidates(db.Thumbs{S256: "s.jpg"})
	if len(got) != 1 || got[0] != "s.jpg" {
		t.Fatalf("got %v, want [s.jpg]", got)
	}
	if len(thumbCandidates(db.Thumbs{})) != 0 {
		t.Fatal("a photo with no renditions offers no candidates")
	}
}

func TestMediaOpenStatusMapsMissingFileToNotFound(t *testing.T) {
	if got := mediaOpenStatus(fs.ErrNotExist); got != http.StatusNotFound {
		t.Fatalf("got %d, want 404", got)
	}
	if got := mediaOpenStatus(errors.New("path escape: ../x")); got != http.StatusNotFound {
		t.Fatalf("got %d, want 404 for path escape", got)
	}
	if got := mediaOpenStatus(fs.ErrPermission); got != http.StatusInternalServerError {
		t.Fatalf("got %d, want 500", got)
	}
	if got := originalErrorBody(http.StatusNotFound); got != "not found" {
		t.Fatalf("got %q, want not found", got)
	}
	if !storage.IsNotFound(fs.ErrNotExist) {
		t.Fatal("expected IsNotFound for ErrNotExist")
	}
}
