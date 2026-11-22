package exif

import (
	"encoding/binary"
)

// HEIF keeps EXIF in an item of its own rather than in a leading segment the
// way JPEG does: `meta` holds an `iinf` listing the items and an `iloc` saying
// where each one lives, and the Exif item's payload is an ordinary TIFF block
// (ISO/IEC 23008-12 Annex A). So nothing here parses EXIF — it finds the TIFF
// block and hands it to the same reader JPEG uses.
//
// Without this a HEIC has no capture time at all and falls back to the file's
// mtime, which puts every photo of a bulk-copied library on the day it was
// copied. The timeline is the product (ADR 0005, ADR 0019), so that is a bug
// rather than a limitation (ADR 0026).
//
// Every read is bounds-checked. The indexer walks whatever is on the disk,
// including truncated and malformed files, and a panic there would take down
// a whole index run.

// maxBoxDepth stops a crafted file with deeply nested boxes from recursing
// without bound. Real files need three levels; this leaves room to spare.
const maxBoxDepth = 8

// IsHEIF reports whether data looks like a HEIF container.
//
// Sniffed from the bytes rather than taken from the extension: a `.jpg` that
// is really a HEIC should still get its capture time, and an extension is
// whatever someone typed.
func IsHEIF(data []byte) bool {
	if len(data) < 12 {
		return false
	}
	if string(data[4:8]) != "ftyp" {
		return false
	}
	size := int(binary.BigEndian.Uint32(data[:4]))
	if size < 12 || size > len(data) {
		size = len(data)
	}
	// The major brand, then any compatible brand in the rest of the box.
	for off := 8; off+4 <= size; off += 4 {
		switch string(data[off : off+4]) {
		case "heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1", "avif":
			return true
		}
		// The minor version sits between the major brand and the list.
		if off == 8 {
			off += 4
		}
	}
	return false
}

// box is one ISOBMFF box: its type, and the bounds of its payload.
type box struct {
	typ        string
	start, end int
}

// boxes lists the boxes directly inside data[from:to].
func boxes(data []byte, from, to int) []box {
	var out []box
	for off := from; off+8 <= to; {
		size := int(binary.BigEndian.Uint32(data[off : off+4]))
		typ := string(data[off+4 : off+8])
		header := 8
		switch size {
		case 1:
			// 64-bit size follows the type.
			if off+16 > to {
				return out
			}
			size64 := binary.BigEndian.Uint64(data[off+8 : off+16])
			if size64 > uint64(to-off) {
				return out
			}
			size = int(size64)
			header = 16
		case 0:
			// Runs to the end of the enclosing box.
			size = to - off
		}
		if size < header || off+size > to {
			return out
		}
		out = append(out, box{typ: typ, start: off + header, end: off + size})
		off += size
	}
	return out
}

// find returns the first box of typ among those listed.
func find(list []box, typ string) (box, bool) {
	for _, b := range list {
		if b.typ == typ {
			return b, true
		}
	}
	return box{}, false
}

// ExifFromHEIF returns the TIFF block held in a HEIF file's Exif item.
//
// The second result is false when the file is not HEIF, carries no Exif item,
// or is malformed — all of which are "no EXIF here", not errors worth
// stopping an index for.
func ExifFromHEIF(data []byte) ([]byte, bool) {
	if !IsHEIF(data) {
		return nil, false
	}
	meta, ok := findMeta(data, 0, len(data), 0)
	if !ok {
		return nil, false
	}
	// meta is a FullBox: four bytes of version and flags before its children.
	if meta.start+4 > meta.end {
		return nil, false
	}
	children := boxes(data, meta.start+4, meta.end)

	iinf, ok := find(children, "iinf")
	if !ok {
		return nil, false
	}
	itemID, ok := exifItemID(data, iinf)
	if !ok {
		return nil, false
	}

	iloc, ok := find(children, "iloc")
	if !ok {
		return nil, false
	}
	payload, ok := itemPayload(data, iloc, itemID, children)
	if !ok {
		return nil, false
	}
	return tiffBlock(payload)
}

// findMeta locates the meta box, which sits at the top level in every file
// seen in the wild but is permitted deeper.
func findMeta(data []byte, from, to, depth int) (box, bool) {
	if depth > maxBoxDepth {
		return box{}, false
	}
	list := boxes(data, from, to)
	if b, ok := find(list, "meta"); ok {
		return b, true
	}
	for _, b := range list {
		// Only containers worth descending into; mdat is image data.
		if b.typ == "moov" || b.typ == "trak" || b.typ == "mdia" {
			if found, ok := findMeta(data, b.start, b.end, depth+1); ok {
				return found, true
			}
		}
	}
	return box{}, false
}

// exifItemID finds the item whose type is "Exif" in the item information box.
func exifItemID(data []byte, iinf box) (uint32, bool) {
	p := iinf.start
	if p+4 > iinf.end {
		return 0, false
	}
	version := data[p]
	p += 4 // version and flags

	var count int
	if version == 0 {
		if p+2 > iinf.end {
			return 0, false
		}
		count = int(binary.BigEndian.Uint16(data[p : p+2]))
		p += 2
	} else {
		if p+4 > iinf.end {
			return 0, false
		}
		count = int(binary.BigEndian.Uint32(data[p : p+4]))
		p += 4
	}

	for i := 0; i < count; i++ {
		entries := boxes(data, p, iinf.end)
		if len(entries) == 0 {
			return 0, false
		}
		infe := entries[0]
		if infe.typ != "infe" {
			return 0, false
		}
		if id, ok := infeExif(data, infe); ok {
			return id, true
		}
		// boxes() gave payload bounds; step over the whole box.
		p = infe.end
	}
	return 0, false
}

// infeExif reads one item entry and reports its ID if it is the Exif item.
func infeExif(data []byte, infe box) (uint32, bool) {
	p := infe.start
	if p+4 > infe.end {
		return 0, false
	}
	version := data[p]
	p += 4

	var id uint32
	switch version {
	case 0, 1, 2:
		if p+2 > infe.end {
			return 0, false
		}
		id = uint32(binary.BigEndian.Uint16(data[p : p+2]))
		p += 2
	default: // version 3 widened the ID
		if p+4 > infe.end {
			return 0, false
		}
		id = binary.BigEndian.Uint32(data[p : p+4])
		p += 4
	}
	if version < 2 {
		// Versions 0 and 1 have no item_type; they are only used for the
		// primary image, never for metadata.
		return 0, false
	}
	p += 2 // protection index
	if p+4 > infe.end {
		return 0, false
	}
	if string(data[p:p+4]) != "Exif" {
		return 0, false
	}
	return id, true
}

// itemPayload returns the bytes of one item, following the item location box.
func itemPayload(data []byte, iloc box, want uint32, siblings []box) ([]byte, bool) {
	p := iloc.start
	if p+6 > iloc.end {
		return nil, false
	}
	version := data[p]
	p += 4

	sizes := data[p]
	offsetSize := int(sizes >> 4)
	lengthSize := int(sizes & 0xF)
	p++
	baseAndIndex := data[p]
	baseOffsetSize := int(baseAndIndex >> 4)
	indexSize := int(baseAndIndex & 0xF)
	p++

	var count int
	if version < 2 {
		if p+2 > iloc.end {
			return nil, false
		}
		count = int(binary.BigEndian.Uint16(data[p : p+2]))
		p += 2
	} else {
		if p+4 > iloc.end {
			return nil, false
		}
		count = int(binary.BigEndian.Uint32(data[p : p+4]))
		p += 4
	}

	for i := 0; i < count; i++ {
		var id uint32
		if version < 2 {
			if p+2 > iloc.end {
				return nil, false
			}
			id = uint32(binary.BigEndian.Uint16(data[p : p+2]))
			p += 2
		} else {
			if p+4 > iloc.end {
				return nil, false
			}
			id = binary.BigEndian.Uint32(data[p : p+4])
			p += 4
		}

		construction := 0
		if version == 1 || version == 2 {
			if p+2 > iloc.end {
				return nil, false
			}
			construction = int(binary.BigEndian.Uint16(data[p:p+2]) & 0xF)
			p += 2
		}
		p += 2 // data reference index

		base, ok := readUint(data, p, baseOffsetSize, iloc.end)
		if !ok {
			return nil, false
		}
		p += baseOffsetSize

		if p+2 > iloc.end {
			return nil, false
		}
		extents := int(binary.BigEndian.Uint16(data[p : p+2]))
		p += 2

		for e := 0; e < extents; e++ {
			p += indexSize
			offset, ok := readUint(data, p, offsetSize, iloc.end)
			if !ok {
				return nil, false
			}
			p += offsetSize
			length, ok := readUint(data, p, lengthSize, iloc.end)
			if !ok {
				return nil, false
			}
			p += lengthSize

			if id != want || e > 0 {
				continue
			}
			// The first extent carries the TIFF header, which is all that is
			// needed; EXIF split across extents is not something any writer
			// does for an item this small.
			switch construction {
			case 0:
				return slice(data, base+offset, length)
			case 1:
				// Offsets are relative to the idat box rather than the file.
				idat, ok := find(siblings, "idat")
				if !ok {
					return nil, false
				}
				return slice(data, uint64(idat.start)+base+offset, length)
			default:
				// construction_method 2 points into another item; no writer
				// uses it for EXIF.
				return nil, false
			}
		}
	}
	return nil, false
}

// readUint reads an n-byte big-endian value, where n is 0, 4 or 8 in practice.
func readUint(data []byte, at, n, limit int) (uint64, bool) {
	if n == 0 {
		return 0, true
	}
	if at < 0 || at+n > limit || n > 8 {
		return 0, false
	}
	var v uint64
	for _, b := range data[at : at+n] {
		v = v<<8 | uint64(b)
	}
	return v, true
}

// slice bounds-checks an item's extent against the file it came from.
func slice(data []byte, offset, length uint64) ([]byte, bool) {
	if length == 0 || offset > uint64(len(data)) {
		return nil, false
	}
	end := offset + length
	if end > uint64(len(data)) {
		// Truncated file: take what is there rather than nothing, since the
		// TIFF header and the date sit at the front of the block.
		end = uint64(len(data))
	}
	if end <= offset {
		return nil, false
	}
	return data[offset:end], true
}

// tiffBlock strips the Exif item's own header and returns the TIFF block.
//
// The payload is a four-byte count of bytes preceding the TIFF header, then
// usually "Exif\0\0", then the header itself. Writers have been known to get
// that count wrong, so the magic is verified and searched for if it is not
// where the count says.
func tiffBlock(payload []byte) ([]byte, bool) {
	if len(payload) < 8 {
		return nil, false
	}
	skip := int(binary.BigEndian.Uint32(payload[:4]))
	if start := 4 + skip; start >= 0 && start+4 <= len(payload) && isTIFF(payload[start:]) {
		return payload[start:], true
	}
	// Search a short way in: the header is within the first few bytes of any
	// real payload, and scanning further would risk matching image data.
	limit := 32
	if len(payload) < limit {
		limit = len(payload)
	}
	for i := 0; i+4 <= limit; i++ {
		if isTIFF(payload[i:]) {
			return payload[i:], true
		}
	}
	return nil, false
}

func isTIFF(b []byte) bool {
	if len(b) < 4 {
		return false
	}
	switch {
	case b[0] == 'I' && b[1] == 'I' && b[2] == 0x2A && b[3] == 0x00:
		return true
	case b[0] == 'M' && b[1] == 'M' && b[2] == 0x00 && b[3] == 0x2A:
		return true
	}
	return false
}
