package index

import (
	"time"

	"github.com/memries/memries/internal/db"
	"github.com/memries/memries/internal/exif"
	"github.com/memries/memries/internal/storage"
	"github.com/memries/memries/internal/video"
)

const (
	SourceEXIF = "exif"
	// SourceContainer is a video's own creation tags, which are not EXIF but
	// are just as authoritative about when it was shot (ADR 0029).
	SourceContainer = "container"
	SourceBirth     = "birth"
	SourceMtime     = "mtime"
)

type Capture struct {
	TakenAt      time.Time
	TakenAtLocal string
	TZOffset     int
	Source       string
}

func ResolveCaptureTime(ex exif.Result, info storage.ObjectInfo) Capture {
	if ex.TakenAtLocal != "" || !ex.TakenAt.IsZero() {
		local := ex.TakenAtLocal
		if local == "" {
			local = ex.TakenAt.UTC().Format("2006-01-02T15:04:05")
		}
		taken := ex.TakenAt
		if taken.IsZero() {
			taken = exif.UTCFromLocal(local, ex.TZOffset)
		}
		return Capture{
			TakenAt:      taken.UTC(),
			TakenAtLocal: local,
			TZOffset:     ex.TZOffset,
			Source:       SourceEXIF,
		}
	}
	if !info.CreatedAt.IsZero() {
		return captureFromFileTime(info.CreatedAt, SourceBirth)
	}
	if !info.ModTime.IsZero() {
		return captureFromFileTime(info.ModTime, SourceMtime)
	}
	return captureFromFileTime(time.Now().UTC(), SourceMtime)
}

// ResolveVideoCaptureTime is ResolveCaptureTime for a clip. The container's
// creation tags stand in for EXIF — including the UTC offset, which is why
// Apple's creationdate is preferred over creation_time (ADR 0026, ADR 0029) —
// and the fall back to file times is the same one stills get.
func ResolveVideoCaptureTime(v video.Info, info storage.ObjectInfo) Capture {
	c := ResolveCaptureTime(exif.Result{
		TakenAt:      v.TakenAt,
		TakenAtLocal: v.TakenAtLocal,
		TZOffset:     v.TZOffset,
	}, info)
	if c.Source == SourceEXIF {
		c.Source = SourceContainer
	}
	return c
}

func captureFromFileTime(t time.Time, source string) Capture {
	utc := t.UTC()
	return Capture{
		TakenAt:      utc,
		TakenAtLocal: utc.Format("2006-01-02T15:04:05"),
		TZOffset:     0,
		Source:       source,
	}
}

func CaptureChanged(existing db.Photo, next Capture) bool {
	if existing.TakenAtLocal != next.TakenAtLocal {
		return true
	}
	if existing.TZOffset != next.TZOffset {
		return true
	}
	if existing.TakenAtSource != "" && existing.TakenAtSource != next.Source {
		return true
	}
	return !existing.TakenAt.Equal(next.TakenAt)
}

func applyCapture(p *db.Photo, cap Capture) {
	p.TakenAt = cap.TakenAt
	p.TakenAtLocal = cap.TakenAtLocal
	p.TZOffset = cap.TZOffset
	p.TakenAtSource = cap.Source
}
