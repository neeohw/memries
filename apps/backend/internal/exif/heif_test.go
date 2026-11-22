package exif

import (
	"os"
	"path/filepath"
	"testing"
)

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// The bug this closes: a HEIC had no capture time at all, so it fell back to
// the file's mtime and a bulk-copied library landed every photo on the day it
// was copied. The timeline is the product (ADR 0005, ADR 0019, ADR 0026).
func TestParseAnyReadsTheCaptureTimeFromAHEIC(t *testing.T) {
	res, err := ParseAny(fixture(t, "exif.heic"))
	if err != nil {
		t.Fatal(err)
	}
	if res.TakenAtLocal != "2019-07-14T18:22:31" {
		t.Errorf("TakenAtLocal = %q", res.TakenAtLocal)
	}
	// +02:00, so the stored instant is two hours earlier than the wall clock.
	if res.TZOffset != 7200 {
		t.Errorf("TZOffset = %d, want 7200", res.TZOffset)
	}
	if got := res.TakenAt.UTC().Format("2006-01-02T15:04:05Z"); got != "2019-07-14T16:22:31Z" {
		t.Errorf("TakenAt = %s", got)
	}
	if res.Orientation != 6 {
		t.Errorf("Orientation = %d, want 6", res.Orientation)
	}
	if res.EXIF.Camera != "Test Camera" {
		t.Errorf("Camera = %q", res.EXIF.Camera)
	}
}

// JPEG must keep working unchanged; it is still the bulk of any library.
func TestParseAnyStillReadsAJPEG(t *testing.T) {
	res, err := ParseAny(fixture(t, "exif.jpg"))
	if err != nil {
		t.Fatal(err)
	}
	if res.TakenAtLocal != "2019-07-14T18:22:31" {
		t.Errorf("TakenAtLocal = %q", res.TakenAtLocal)
	}
	if res.TZOffset != 7200 {
		t.Errorf("TZOffset = %d, want 7200", res.TZOffset)
	}
}

// A HEIC carrying no Exif item is ordinary — a screenshot, or an export that
// stripped metadata — and must not be an error that stops an index.
func TestParseAnyReportsNoEXIFForAHEICWithoutAnExifItem(t *testing.T) {
	data := fixture(t, "noexif.heic")
	if !IsHEIF(data) {
		t.Fatal("fixture should still be recognised as HEIF")
	}
	if _, ok := ExifFromHEIF(data); ok {
		t.Fatal("fixture is supposed to have no Exif item")
	}
	if _, err := ParseAny(data); err != ErrNoEXIF {
		t.Errorf("err = %v, want ErrNoEXIF", err)
	}
}

func TestIsHEIFSniffsTheContainerRatherThanTheName(t *testing.T) {
	if !IsHEIF(fixture(t, "exif.heic")) {
		t.Error("a HEIC should be recognised")
	}
	for name, data := range map[string][]byte{
		"jpeg":     fixture(t, "exif.jpg"),
		"empty":    {},
		"short":    []byte("ftyp"),
		"png":      []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"),
		"ftyp-mp4": append([]byte{0, 0, 0, 20}, []byte("ftypmp42mp42")...),
		"junk":     []byte("not an image at all, just text"),
	} {
		if IsHEIF(data) {
			t.Errorf("%s should not be recognised as HEIF", name)
		}
	}
}

func TestExifFromHEIFReturnsATIFFBlock(t *testing.T) {
	tiff, ok := ExifFromHEIF(fixture(t, "exif.heic"))
	if !ok {
		t.Fatal("no Exif item found")
	}
	// Apple writes big-endian here; the reader must take either.
	if !isTIFF(tiff) {
		t.Fatalf("not a TIFF block: %q", tiff[:min(4, len(tiff))])
	}
}

// The indexer walks whatever is on the disk, including half-copied files. A
// panic in here would take down a whole index run, so every truncation of a
// real file has to come back cleanly.
func TestExifFromHEIFSurvivesTruncation(t *testing.T) {
	data := fixture(t, "exif.heic")
	for n := 0; n < len(data); n++ {
		func() {
			defer func() {
				if r := recover(); r != nil {
					t.Fatalf("panic at %d bytes: %v", n, r)
				}
			}()
			if tiff, ok := ExifFromHEIF(data[:n]); ok && !isTIFF(tiff) {
				t.Fatalf("at %d bytes: returned a non-TIFF block", n)
			}
			if _, err := ParseAny(data[:n]); err == nil && n < 100 {
				t.Fatalf("at %d bytes: reported success on a stub", n)
			}
		}()
	}
}

// Corrupting single bytes walks the parser into malformed box sizes, bad
// item counts and offsets past the end of the file.
func TestExifFromHEIFSurvivesCorruption(t *testing.T) {
	base := fixture(t, "exif.heic")
	for i := 0; i < len(base); i++ {
		for _, b := range []byte{0x00, 0xFF, 0x7F} {
			data := make([]byte, len(base))
			copy(data, base)
			data[i] = b
			func() {
				defer func() {
					if r := recover(); r != nil {
						t.Fatalf("panic with byte %d set to %#x: %v", i, b, r)
					}
				}()
				if tiff, ok := ExifFromHEIF(data); ok && !isTIFF(tiff) {
					t.Fatalf("byte %d = %#x: returned a non-TIFF block", i, b)
				}
			}()
		}
	}
}

func TestTiffBlockToleratesAWrongHeaderOffset(t *testing.T) {
	tiff := []byte("MM\x00*\x00\x00\x00\x08rest")
	// The count says 6 ("Exif\0\0"), which is right.
	good := append([]byte{0, 0, 0, 6}, append([]byte("Exif\x00\x00"), tiff...)...)
	if got, ok := tiffBlock(good); !ok || !isTIFF(got) {
		t.Error("a correct header offset should be followed")
	}
	// The count is wrong, but the magic is still findable nearby.
	bad := append([]byte{0, 0, 0, 99}, append([]byte("Exif\x00\x00"), tiff...)...)
	if got, ok := tiffBlock(bad); !ok || !isTIFF(got) {
		t.Error("a wrong header offset should fall back to searching")
	}
	// Nothing resembling a TIFF header at all.
	if _, ok := tiffBlock(append([]byte{0, 0, 0, 0}, []byte("no tiff here, only prose")...)); ok {
		t.Error("payload without a TIFF header should be rejected")
	}
}
