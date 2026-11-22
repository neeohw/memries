package exif

import (
	"encoding/binary"
	"testing"
)

// buildTIFF assembles a TIFF block with the given ASCII tags in an EXIF
// sub-IFD, which is where cameras put the offset-time tags.
func buildTIFF(order binary.ByteOrder, tags map[uint16]string) []byte {
	put16 := func(b []byte, v uint16) { order.PutUint16(b, v) }
	put32 := func(b []byte, v uint32) { order.PutUint32(b, v) }

	magic := []byte("II\x2a\x00")
	if order == binary.BigEndian {
		magic = []byte("MM\x00\x2a")
	}
	head := make([]byte, 8)
	copy(head, magic)
	put32(head[4:], 8)

	// IFD0 holds one entry: the pointer to the EXIF sub-IFD.
	ifd0 := make([]byte, 2+12+4)
	put16(ifd0, 1)
	put16(ifd0[2:], tagExifIFD)
	put16(ifd0[4:], 4) // LONG
	put32(ifd0[6:], 1)
	exifOff := uint32(8 + len(ifd0))
	put32(ifd0[10:], exifOff)

	order2 := make([]uint16, 0, len(tags))
	for tag := range tags {
		order2 = append(order2, tag)
	}
	// Deterministic layout.
	for i := 0; i < len(order2); i++ {
		for j := i + 1; j < len(order2); j++ {
			if order2[j] < order2[i] {
				order2[i], order2[j] = order2[j], order2[i]
			}
		}
	}

	sub := make([]byte, 2+12*len(order2)+4)
	put16(sub, uint16(len(order2)))
	dataOff := exifOff + uint32(len(sub))
	var data []byte
	for i, tag := range order2 {
		v := tags[tag] + "\x00"
		e := 2 + i*12
		put16(sub[e:], tag)
		put16(sub[e+2:], typeASCII)
		put32(sub[e+4:], uint32(len(v)))
		put32(sub[e+8:], dataOff+uint32(len(data)))
		data = append(data, v...)
	}

	out := append(head, ifd0...)
	out = append(out, sub...)
	return append(out, data...)
}

// goexif registers no FieldName for these tags, so every photo was stored as
// if shot in UTC — JPEG as much as HEIC (ADR 0026).
func TestRawOffsetTimeReadsTheOriginalOffset(t *testing.T) {
	for _, order := range []binary.ByteOrder{binary.LittleEndian, binary.BigEndian} {
		tiff := buildTIFF(order, map[uint16]string{tagOffsetTimeOriginal: "+02:00"})
		got, ok := rawOffsetTime(tiff)
		if !ok || got != "+02:00" {
			t.Errorf("%v: got %q %v", order, got, ok)
		}
	}
}

// DateTimeOriginal is what the timeline reads, so its own offset wins over
// the ones belonging to the other timestamps.
func TestRawOffsetTimePrefersTheOriginalOverTheOthers(t *testing.T) {
	tiff := buildTIFF(binary.LittleEndian, map[uint16]string{
		tagOffsetTime:          "+01:00",
		tagOffsetTimeOriginal:  "+02:00",
		tagOffsetTimeDigitized: "+03:00",
	})
	if got, _ := rawOffsetTime(tiff); got != "+02:00" {
		t.Errorf("got %q, want +02:00", got)
	}
}

// Cameras that write only one of the three still get an offset.
func TestRawOffsetTimeFallsBackToTheOtherOffsetTags(t *testing.T) {
	tiff := buildTIFF(binary.LittleEndian, map[uint16]string{tagOffsetTime: "-05:00"})
	if got, ok := rawOffsetTime(tiff); !ok || got != "-05:00" {
		t.Errorf("got %q %v, want -05:00", got, ok)
	}
}

// An older camera records no timezone at all, which is not a failure.
func TestRawOffsetTimeReportsAbsence(t *testing.T) {
	if _, ok := rawOffsetTime(buildTIFF(binary.LittleEndian, nil)); ok {
		t.Error("a TIFF with no offset tags should report absence")
	}
	for _, junk := range [][]byte{nil, []byte("II"), []byte("not a tiff"), []byte("MM\x00\x2a")} {
		if _, ok := rawOffsetTime(junk); ok {
			t.Errorf("%q should report absence", junk)
		}
	}
}

func TestRawOffsetTimeSurvivesCorruption(t *testing.T) {
	base := buildTIFF(binary.BigEndian, map[uint16]string{tagOffsetTimeOriginal: "+02:00"})
	for i := 0; i < len(base); i++ {
		for _, b := range []byte{0x00, 0xFF} {
			data := make([]byte, len(base))
			copy(data, base)
			data[i] = b
			func() {
				defer func() {
					if r := recover(); r != nil {
						t.Fatalf("panic with byte %d set to %#x: %v", i, b, r)
					}
				}()
				_, _ = rawOffsetTime(data)
			}()
		}
	}
}

func TestLocateTIFFFindsTheBlockInEitherContainer(t *testing.T) {
	bare := buildTIFF(binary.LittleEndian, nil)
	if got, ok := locateTIFF(bare); !ok || !isTIFF(got) {
		t.Error("a bare TIFF block should be found as itself")
	}

	// A JPEG puts it behind an APP1 marker.
	jpeg := append([]byte("\xFF\xD8\xFF\xE1\x00\x20Exif\x00\x00"), bare...)
	if got, ok := locateTIFF(jpeg); !ok || !isTIFF(got) {
		t.Error("a JPEG's APP1 block should be found")
	}

	if _, ok := locateTIFF([]byte("\xFF\xD8 no exif segment here")); ok {
		t.Error("a JPEG without EXIF should report absence")
	}
}
