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
		// Every rung, not only the top one: the rungs below it are derived
		// from the rung above, and that is where a second rotation hid.
		for _, size := range Sizes {
			w, h := thumbBounds(t, root2, got.Paths[size])
			if h <= w {
				t.Errorf("orientation %d: %d rung is %dx%d, no longer portrait",
					orientation, size, w, h)
			}
		}
	}
}

// A JPEG has no irot, so this package still applies the EXIF orientation and
// the two backends keep agreeing about it.
//
// Both ladder shapes, because they rotate in different places. A source at
// most twice the top rung resamples every rung straight from the file, so each
// one is rotated by `upright`. A larger one chains: the top rung is rotated and
// the rungs below it are thumbnailed from it, already upright. That second path
// is where a portrait photo came out sideways at 512 and 256 while the 1024
// above them was right — and the timeline shows 256 and 512.
//
// The assertions on disk are the point. `Result.Width/Height` come from the
// file header plus `swapsAxes`, so they report the transpose whether or not a
// single pixel was actually turned; only the rungs say what was written.
func TestVipsStillRotatesJPEGByEXIFOrientation(t *testing.T) {
	for _, src := range []struct {
		name string
		w, h int
	}{
		{"direct", 1600, 1200},
		{"chained", 2560, 1440},
	} {
		t.Run(src.name, func(t *testing.T) {
			g, _ := newGen(t)
			stored, err := g.Generate(testKey, jpegWithOrientation(t, src.w, src.h, 1), 1, Sizes)
			if err != nil {
				t.Fatal(err)
			}
			g2, root2 := newGen(t)
			turned, err := g2.Generate(testKey, jpegWithOrientation(t, src.w, src.h, 8), 8, Sizes)
			if err != nil {
				t.Fatal(err)
			}
			if turned.Width != stored.Height || turned.Height != stored.Width {
				t.Errorf("orientation 8 gave %dx%d, want the transpose of %dx%d",
					turned.Width, turned.Height, stored.Width, stored.Height)
			}
			for _, size := range Sizes {
				w, h := thumbBounds(t, root2, turned.Paths[size])
				if h <= w {
					t.Errorf("orientation 8: %d rung is %dx%d, want portrait", size, w, h)
				}
			}
		})
	}
}

// jpegWithOrientation wraps photoJPEG in a minimal EXIF APP1 carrying nothing
// but the orientation tag.
//
// The tag has to be in the *file*, not only in the argument. libvips' loader
// reads it into VIPS_META_ORIENTATION, and any thumbnail operation that is not
// told otherwise applies it — so a fixture without EXIF cannot see a second
// rotation happening, which is how sideways 512 and 256 rungs reached a real
// library with this suite green.
func jpegWithOrientation(tb testing.TB, w, h, orientation int) []byte {
	tb.Helper()
	body := photoJPEG(tb, w, h)
	if len(body) < 2 || body[0] != 0xFF || body[1] != 0xD8 {
		tb.Fatal("photoJPEG did not start with SOI")
	}
	payload := append([]byte("Exif\x00\x00"), []byte{
		'I', 'I', 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, // little-endian TIFF header
		0x01, 0x00, // one IFD0 entry
		0x12, 0x01, // tag 0x0112, Orientation
		0x03, 0x00, // type SHORT
		0x01, 0x00, 0x00, 0x00, // count 1
		byte(orientation), 0x00, 0x00, 0x00, // the value, padded to four bytes
		0x00, 0x00, 0x00, 0x00, // no IFD1
	}...)
	size := len(payload) + 2 // the length field counts itself
	out := append([]byte{}, body[:2]...)
	out = append(out, 0xFF, 0xE1, byte(size>>8), byte(size))
	out = append(out, payload...)
	return append(out, body[2:]...)
}
