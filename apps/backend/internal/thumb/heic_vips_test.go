//go:build vips

package thumb

import (
	"os"
	"path/filepath"
	"testing"
)

// HEIC is why the indexer is a cgo build at all (ADR 0025): pure Go measured
// 4.6-24.7s per 12MP frame on an A53 against ~0.8s native. This test is the
// one that proves the libvips in the build has the HEIF loader — without it
// every HEIC in the library fails at index time, one by one.
//
// vips-tagged only: the pure Go backend has no HEIF decoder and is not
// expected to grow one.
func TestVipsGeneratesThumbsFromHEIC(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("testdata", "sample.heic"))
	if err != nil {
		t.Fatal(err)
	}

	g, root := newGen(t)
	res, err := g.Generate(testKey, data, 1, SizesWithDisplay)
	if err != nil {
		t.Fatalf("HEIC decode failed — is libvips built with the HEIF loader? %v", err)
	}

	if res.Width != 400 || res.Height != 300 {
		t.Errorf("dims = %dx%d, want 400x300", res.Width, res.Height)
	}

	// Every rung, including the display rendition the viewer opens.
	for _, size := range SizesWithDisplay {
		rel, ok := res.Paths[size]
		if !ok {
			t.Errorf("missing %d rendition", size)
			continue
		}
		// The written files are JPEG whatever went in, which is the point:
		// the server serves these and never decodes a HEIC itself.
		w, h := thumbBounds(t, root, rel)
		if w <= 0 || h <= 0 {
			t.Errorf("%d rendition is %dx%d", size, w, h)
		}
		// 400x300 is smaller than every rung above 400, and neither backend
		// upscales, so each rendition caps at the original.
		if w > 400 || h > 300 {
			t.Errorf("%d rendition = %dx%d, larger than the original", size, w, h)
		}
	}
}

// The backend is logged at startup, so a build that silently fell back to
// pure Go would be indistinguishable from one that did not.
func TestVipsBackendIsReported(t *testing.T) {
	if Backend != "vips" {
		t.Fatalf("Backend = %q in a -tags vips build", Backend)
	}
}
