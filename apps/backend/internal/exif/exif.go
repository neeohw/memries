package exif

import (
	"bytes"
	"errors"
	"io"
	"strings"
	"time"

	goexif "github.com/rwcarlsen/goexif/exif"

	"github.com/memries/memries/internal/db"
)

type Result struct {
	TakenAt      time.Time
	TakenAtLocal string
	TZOffset     int
	Orientation  int
	EXIF         db.EXIF
}

// ErrNoEXIF means the file carries no EXIF to read, which is ordinary for a
// PNG or a screenshot and not a reason to fail an index.
var ErrNoEXIF = errors.New("no exif")

// jpegEXIFWindow is how much of a JPEG is searched for its APP1 segment. EXIF
// sits at the front of a JPEG, so reading the whole frame would be wasted
// work on a 50MB file.
const jpegEXIFWindow = 64 << 10

// ParseAny reads EXIF from whatever format the bytes turn out to be.
//
// HEIF keeps EXIF in an item that can sit anywhere in the file, including
// past the JPEG window and after the image data, so it gets the whole buffer
// and its own extractor (ADR 0026). The indexer already holds every byte to
// hash it, so passing the full slice costs nothing.
func ParseAny(data []byte) (Result, error) {
	if IsHEIF(data) {
		tiff, ok := ExifFromHEIF(data)
		if !ok {
			return Result{}, ErrNoEXIF
		}
		return Parse(bytes.NewReader(tiff))
	}
	window := data
	if len(window) > jpegEXIFWindow {
		window = window[:jpegEXIFWindow]
	}
	return Parse(bytes.NewReader(window))
}

// Parse reads EXIF from a JPEG or a bare TIFF block.
func Parse(r io.Reader) (Result, error) {
	// Read once and keep the bytes: goexif does not expose the offset-time
	// tags, so those are taken from the raw IFDs afterwards (ADR 0026).
	buf, err := io.ReadAll(r)
	if err != nil {
		return Result{}, err
	}
	x, err := goexif.Decode(bytes.NewReader(buf))
	if err != nil {
		return Result{}, err
	}
	res := Result{Orientation: 1}
	res.TakenAtLocal, res.TakenAt, res.TZOffset = readCaptureClock(x, buf)
	if tag, err := x.Get(goexif.Orientation); err == nil {
		if v, err := tag.Int(0); err == nil {
			res.Orientation = v
		}
	}
	if tag, err := x.Get(goexif.Model); err == nil {
		s, _ := tag.StringVal()
		res.EXIF.Camera = strings.TrimSpace(s)
	}
	if tag, err := x.Get(goexif.LensModel); err == nil {
		s, _ := tag.StringVal()
		res.EXIF.Lens = strings.TrimSpace(s)
	}
	if tag, err := x.Get(goexif.ISOSpeedRatings); err == nil {
		if v, err := tag.Int(0); err == nil {
			res.EXIF.ISO = v
		}
	}
	if tag, err := x.Get(goexif.FNumber); err == nil {
		if n, d, err := tag.Rat2(0); err == nil && d != 0 {
			res.EXIF.FNum = float64(n) / float64(d)
		}
	}
	if tag, err := x.Get(goexif.ExposureTime); err == nil {
		res.EXIF.Shutter = tag.String()
	}
	if lat, lon, err := x.LatLong(); err == nil {
		res.EXIF.GPS = &db.GPS{Lat: lat, Lon: lon}
	}
	return res, nil
}

func readCaptureClock(x *goexif.Exif, raw []byte) (local string, taken time.Time, offset int) {
	for _, name := range []goexif.FieldName{goexif.DateTimeOriginal, goexif.DateTimeDigitized, goexif.DateTime} {
		tag, err := x.Get(name)
		if err != nil {
			continue
		}
		s, err := tag.StringVal()
		if err != nil {
			continue
		}
		clock, ok := NormalizeExifClock(s)
		if !ok {
			continue
		}
		local = clock
		break
	}
	// goexif registers no FieldName for the offset-time tags, so this lookup
	// never matched and every photo was stored as if shot in UTC. It is kept
	// in case a later goexif learns them, with the raw IFD walk below as the
	// path that actually works today (ADR 0026).
	if tag, err := x.Get("OffsetTimeOriginal"); err == nil {
		if s, err := tag.StringVal(); err == nil {
			if off, ok := ParseTZOffset(strings.TrimSpace(s)); ok {
				offset = off
			}
		}
	}
	if offset == 0 && len(raw) > 0 {
		if tiff, ok := locateTIFF(raw); ok {
			if s, ok := rawOffsetTime(tiff); ok {
				if off, ok := ParseTZOffset(strings.TrimSpace(s)); ok {
					offset = off
				}
			}
		}
	}
	if local != "" {
		taken = UTCFromLocal(local, offset)
	}
	return local, taken, offset
}
