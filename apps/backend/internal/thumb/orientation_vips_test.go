//go:build vips

package thumb

import (
	"os"
	"testing"
)

// HEIF records its rotation twice — in the container's irot box and in the
// EXIF orientation tag — and libheif applies irot while decoding. Applying
// the tag on top turned every portrait iPhone photo on its side: measured
// 3024x4032 decoded, then rotated to 4032x3024 (ADR 0026).
//
// So for HEIF the decoder's output is final, whatever orientation the caller
// read from the EXIF. Set MEMRIES_HEIC_SAMPLE to a real camera HEIC.
func TestVipsIgnoresEXIFOrientationForHEIF(t *testing.T) {
	path := os.Getenv("MEMRIES_HEIC_SAMPLE")
	if path == "" {
		t.Skip("set MEMRIES_HEIC_SAMPLE to a real HEIC")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	g, _ := newGen(t)
	decoded, err := g.Generate(testKey, data, 1, Sizes)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("decoded: %dx%d", decoded.Width, decoded.Height)

	// An iPhone portrait photo: irot has already been applied, so the taller
	// side is the height before this package touches anything.
	if decoded.Height <= decoded.Width {
		t.Skipf("sample is not portrait (%dx%d); the regression needs one that is",
			decoded.Width, decoded.Height)
	}

	// Every EXIF orientation must leave it alone. Before the fix, 6 and 8
	// produced the transpose and the photo came out sideways.
	for _, orientation := range []int{1, 3, 6, 8} {
		g2, root2 := newGen(t)
		got, err := g2.Generate(testKey, data, orientation, Sizes)
		if err != nil {
			t.Fatal(err)
		}
		if got.Width != decoded.Width || got.Height != decoded.Height {
			t.Errorf("orientation %d gave %dx%d, want the decoded %dx%d — rotated twice",
				orientation, got.Width, got.Height, decoded.Width, decoded.Height)
		}
		w, h := thumbBounds(t, root2, got.Paths[1024])
		if h <= w {
			t.Errorf("orientation %d: 1024 rung is %dx%d, no longer portrait", orientation, w, h)
		}
	}
}

// A JPEG has no irot, so this package still applies the EXIF orientation and
// the two backends keep agreeing about it.
func TestVipsStillRotatesJPEGByEXIFOrientation(t *testing.T) {
	g, _ := newGen(t)
	stored, err := g.Generate(testKey, photoJPEG(t, 1600, 1200), 1, Sizes)
	if err != nil {
		t.Fatal(err)
	}
	g2, _ := newGen(t)
	turned, err := g2.Generate(testKey, photoJPEG(t, 1600, 1200), 6, Sizes)
	if err != nil {
		t.Fatal(err)
	}
	if turned.Width != stored.Height || turned.Height != stored.Width {
		t.Errorf("orientation 6 gave %dx%d, want the transpose of %dx%d",
			turned.Width, turned.Height, stored.Width, stored.Height)
	}
}
