package exif

import (
	"bytes"
	"encoding/binary"
)

// goexif does not register the offset-time tags, which arrived with EXIF 2.31
// in 2016. x.Get("OffsetTimeOriginal") therefore never matches, and every
// photo was stored with a zero UTC offset even when the file said +02:00 —
// JPEG as much as HEIC (ADR 0026).
//
// Rather than fork goexif for three tags, the raw IFDs are walked for them
// here. Only the offsets are read this way; everything else still comes from
// goexif.

const (
	tagOffsetTime          = 0x9010 // applies to DateTime
	tagOffsetTimeOriginal  = 0x9011 // applies to DateTimeOriginal
	tagOffsetTimeDigitized = 0x9012 // applies to DateTimeDigitized
	tagExifIFD             = 0x8769
	tagGPSIFD              = 0x8825

	typeASCII = 2
	// An IFD entry is tag(2) type(2) count(4) value-or-offset(4).
	entrySize = 12
	// Deep enough for IFD0 -> ExifIFD; the guard is against a crafted loop.
	maxIFDDepth = 4
)

// rawOffsetTime returns the UTC offset a TIFF block records for its capture
// time, preferring the tag that belongs to DateTimeOriginal.
//
// Malformed input yields false rather than a panic: the indexer reads whatever
// is on the disk.
func rawOffsetTime(tiff []byte) (string, bool) {
	if len(tiff) < 8 {
		return "", false
	}
	var order binary.ByteOrder
	switch {
	case tiff[0] == 'I' && tiff[1] == 'I':
		order = binary.LittleEndian
	case tiff[0] == 'M' && tiff[1] == 'M':
		order = binary.BigEndian
	default:
		return "", false
	}

	found := map[uint16]string{}
	walkIFD(tiff, order, order.Uint32(tiff[4:8]), 0, found)

	// DateTimeOriginal is what the timeline reads, so its own offset wins.
	// The others stand in only when it is absent, which is how cameras that
	// write just one of the three behave.
	for _, tag := range []uint16{tagOffsetTimeOriginal, tagOffsetTime, tagOffsetTimeDigitized} {
		if v, ok := found[tag]; ok && v != "" {
			return v, true
		}
	}
	return "", false
}

// walkIFD collects the offset tags in one IFD, descending into the EXIF
// sub-IFD where cameras actually put them.
func walkIFD(tiff []byte, order binary.ByteOrder, at uint32, depth int, out map[uint16]string) {
	if depth > maxIFDDepth || at == 0 || int(at)+2 > len(tiff) {
		return
	}
	count := int(order.Uint16(tiff[at : at+2]))
	base := int(at) + 2
	for i := 0; i < count; i++ {
		e := base + i*entrySize
		if e+entrySize > len(tiff) {
			return
		}
		tag := order.Uint16(tiff[e : e+2])
		typ := order.Uint16(tiff[e+2 : e+4])
		n := order.Uint32(tiff[e+4 : e+8])
		value := tiff[e+8 : e+12]

		switch tag {
		case tagOffsetTime, tagOffsetTimeOriginal, tagOffsetTimeDigitized:
			if typ != typeASCII {
				continue
			}
			if s, ok := asciiValue(tiff, order, value, n); ok {
				out[tag] = s
			}
		case tagExifIFD, tagGPSIFD:
			walkIFD(tiff, order, order.Uint32(value), depth+1, out)
		}
	}
}

// asciiValue reads an ASCII entry, which lives inline when it fits in the
// four value bytes and at an offset otherwise. "+02:00" plus its terminator
// is seven bytes, so in practice it is always at an offset.
func asciiValue(tiff []byte, order binary.ByteOrder, value []byte, n uint32) (string, bool) {
	if n == 0 || n > uint32(len(tiff)) {
		return "", false
	}
	var raw []byte
	if n <= 4 {
		raw = value[:n]
	} else {
		off := order.Uint32(value)
		if uint64(off)+uint64(n) > uint64(len(tiff)) {
			return "", false
		}
		raw = tiff[off : off+n]
	}
	// EXIF ASCII is NUL-terminated; trim the terminator and any padding.
	return string(bytes.TrimRight(raw, "\x00 ")), true
}

// locateTIFF finds the TIFF block inside whatever was handed to Parse: a bare
// block as HEIF yields, or the one inside a JPEG's APP1 segment.
func locateTIFF(buf []byte) ([]byte, bool) {
	if isTIFF(buf) {
		return buf, true
	}
	// APP1 begins with "Exif\0\0" and the block follows. Bounded to the
	// window Parse reads, so this never scans a whole frame.
	marker := []byte("Exif\x00\x00")
	limit := len(buf)
	if limit > jpegEXIFWindow {
		limit = jpegEXIFWindow
	}
	if i := bytes.Index(buf[:limit], marker); i >= 0 {
		if start := i + len(marker); start < len(buf) && isTIFF(buf[start:]) {
			return buf[start:], true
		}
	}
	return nil, false
}
