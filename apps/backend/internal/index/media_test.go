package index

import (
	"testing"

	"github.com/memries/memries/internal/db"
)

func TestIsMediaTakesHEIC(t *testing.T) {
	for _, key := range []string{"a/IMG_0001.heic", "a/IMG_0001.HEIC", "b/x.heif"} {
		if !IsMedia(key) {
			t.Errorf("%q should be indexed", key)
		}
	}
}

func TestIsMediaStillTakesTheWebFormatsAndSkipsTheRest(t *testing.T) {
	for _, key := range []string{"a.jpg", "a.JPEG", "a.png", "a.webp", "a.gif"} {
		if !IsMedia(key) {
			t.Errorf("%q should be indexed", key)
		}
	}
	// Raw and TIFF are deliberately still out (ADR 0025), and so are the
	// containers ffmpeg could open but a browser could not play (ADR 0029).
	for _, key := range []string{"a.cr2", "a.nef", "a.tif", "a.avif", "a.mkv", "a.avi", "a.txt", "a"} {
		if IsMedia(key) {
			t.Errorf("%q should be skipped", key)
		}
	}
}

// Video is indexed, but never given the JPEG stand-in a HEIC gets: the viewer
// plays the original (ADR 0029).
func TestIsMediaTakesVideo(t *testing.T) {
	for _, key := range []string{"a/IMG_0181.MOV", "b.mp4", "c.m4v", "d.webm"} {
		if !IsMedia(key) {
			t.Errorf("%q should be indexed", key)
		}
		if IsWebSafe(key) {
			t.Errorf("%q should not be given a display rendition", key)
		}
		if got := mediaMIME(key); got == "" || got == "application/octet-stream" {
			t.Errorf("mediaMIME(%q) = %q", key, got)
		}
	}
	if got := mediaMIME("a.MOV"); got != "video/quicktime" {
		t.Errorf("mediaMIME(.MOV) = %q", got)
	}
}

// A clip whose poster could not be made keeps its row rather than being
// retried, and called changed, on every scan.
func TestExpectedThumbsForAVideoWithoutAPoster(t *testing.T) {
	if got := expectedThumbs("a.mov", db.Thumbs{}); got != nil {
		t.Errorf("expected %v, want nothing to check", got)
	}
	full := db.Thumbs{S256: "a", S512: "b", S1024: "c"}
	if got := expectedThumbs("a.mov", full); len(got) != 3 {
		t.Errorf("expected %v", got)
	}
}

// Chrome and Firefox will not render HEIC, so those photos need a JPEG
// rendition for the viewer to open.
func TestIsWebSafe(t *testing.T) {
	for _, key := range []string{"a.jpg", "a.jpeg", "a.png", "a.webp", "a.gif"} {
		if !IsWebSafe(key) {
			t.Errorf("%q is displayable by a browser", key)
		}
	}
	for _, key := range []string{"a.heic", "a.HEIC", "a.heif"} {
		if IsWebSafe(key) {
			t.Errorf("%q is not displayable by a browser", key)
		}
	}
}

// Go's MIME table has no HEIC entry, so without the override these rows would
// say application/octet-stream and the viewer would offer a download.
func TestMediaMIMENamesHEIC(t *testing.T) {
	if got := mediaMIME("a/IMG_1.heic"); got != "image/heic" {
		t.Errorf("heic -> %q", got)
	}
	if got := mediaMIME("a/IMG_1.HEIF"); got != "image/heif" {
		t.Errorf("heif -> %q", got)
	}
}

func TestMediaMIMEKeepsTheStandardTableAndFallsBack(t *testing.T) {
	if got := mediaMIME("a.png"); got != "image/png" {
		t.Errorf("png -> %q", got)
	}
	if got := mediaMIME("a.unknown-ext"); got != "application/octet-stream" {
		t.Errorf("unknown -> %q", got)
	}
}

// HasAll treats an empty path as missing, so expecting the display rendition
// everywhere would make every JPEG look incomplete and regenerate its whole
// ladder on each scan.
func TestExpectedThumbsOnlyWantsTheDisplayRenditionWhereOneIsWritten(t *testing.T) {
	full := db.Thumbs{S256: "s", S512: "m", S1024: "l", S2048: "d"}

	if got := expectedThumbs("a.jpg", full); len(got) != 3 {
		t.Errorf("jpeg expects %v, want three renditions", got)
	}
	got := expectedThumbs("a.heic", full)
	if len(got) != 4 || got[3] != "d" {
		t.Errorf("heic expects %v, want the display rendition too", got)
	}
}

// A HEIC indexed without its display rendition is incomplete, and the next
// scan has to notice rather than skip it as unchanged.
func TestExpectedThumbsCatchesAHEICMissingItsDisplayRendition(t *testing.T) {
	partial := db.Thumbs{S256: "s", S512: "m", S1024: "l"}
	got := expectedThumbs("a.heic", partial)
	if len(got) != 4 || got[3] != "" {
		t.Fatalf("got %v, want an empty fourth entry so HasAll reports it missing", got)
	}
}
