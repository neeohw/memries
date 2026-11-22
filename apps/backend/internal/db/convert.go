package db

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// Timestamps are unix microseconds in BIGINT columns (ADR 0014).

func micros(t time.Time) int64 { return t.UTC().UnixMicro() }

func fromMicros(v int64) time.Time { return time.UnixMicro(v).UTC() }

func nullMicros(t *time.Time) any {
	if t == nil {
		return nil
	}
	return t.UTC().UnixMicro()
}

func timeFromNull(n sql.NullInt64) *time.Time {
	if !n.Valid {
		return nil
	}
	t := fromMicros(n.Int64)
	return &t
}

// boolVal scans a boolean across both dialects: PostgreSQL returns bool,
// SQLite returns an int64 (and, depending on the column, text or bytes).
type boolVal bool

func (b *boolVal) Scan(src any) error {
	var v bool
	switch t := src.(type) {
	case nil:
		v = false
	case bool:
		v = t
	case int64:
		v = t != 0
	case float64:
		v = t != 0
	case []byte:
		v = len(t) == 1 && (t[0] == '1' || t[0] == 't' || t[0] == 'T')
	case string:
		v = t == "1" || strings.EqualFold(t, "true") || strings.EqualFold(t, "t")
	default:
		return fmt.Errorf("cannot scan %T into bool", src)
	}
	*b = boolVal(v)
	return nil
}

// photoColumns is what is stored on the row. It carries no favorite: the
// library is shared and a heart belongs to the reader who pressed it, so that
// flag lives in the favorites table and is read per viewer (ADR 0020).
const photoColumns = `key, kind, taken_at, taken_at_local, taken_at_source,
	tz_offset, hash, size_bytes, mime, width, height, orientation,
	storage_backend, storage_path, storage_bucket, storage_mtime,
	exif_camera, exif_lens, exif_iso, exif_f_number, exif_shutter,
	exif_gps_lat, exif_gps_lon, thumb_256, thumb_512, thumb_1024, thumb_2048,
	imported_at, deleted_at`

// rowScanner is satisfied by both *sql.Row and *sql.Rows.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanPhoto(sc rowScanner) (*Photo, error) {
	var (
		p         Photo
		takenAt   int64
		favorite  boolVal
		mtime     sql.NullInt64
		lat, lon  sql.NullFloat64
		imported  int64
		deletedAt sql.NullInt64
	)
	err := sc.Scan(
		&p.Key, &p.Kind, &takenAt, &p.TakenAtLocal, &p.TakenAtSource,
		&p.TZOffset, &p.Hash, &p.SizeBytes, &p.MIME,
		&p.Dims.W, &p.Dims.H, &p.Orientation,
		&p.Storage.Backend, &p.Storage.Path, &p.Storage.Bucket, &mtime,
		&p.EXIF.Camera, &p.EXIF.Lens, &p.EXIF.ISO, &p.EXIF.FNum, &p.EXIF.Shutter,
		&lat, &lon, &p.Thumbs.S256, &p.Thumbs.S512, &p.Thumbs.S1024, &p.Thumbs.S2048,
		&imported, &deletedAt, &favorite,
	)
	if err != nil {
		return nil, err
	}
	p.TakenAt = fromMicros(takenAt)
	p.Favorite = bool(favorite)
	p.Storage.ModTime = timeFromNull(mtime)
	p.ImportedAt = fromMicros(imported)
	p.DeletedAt = timeFromNull(deletedAt)
	if lat.Valid && lon.Valid {
		p.EXIF.GPS = &GPS{Lat: lat.Float64, Lon: lon.Float64}
	}
	return &p, nil
}

// photoValues mirrors photoColumns for INSERT.
func photoValues(p *Photo) []any {
	var lat, lon any
	if p.EXIF.GPS != nil {
		lat, lon = p.EXIF.GPS.Lat, p.EXIF.GPS.Lon
	}
	kind := p.Kind
	if kind == "" {
		kind = "photo"
	}
	return []any{
		p.Key, kind, micros(p.TakenAt), p.TakenAtLocal, p.TakenAtSource,
		p.TZOffset, p.Hash, p.SizeBytes, p.MIME,
		p.Dims.W, p.Dims.H, p.Orientation,
		p.Storage.Backend, p.Storage.Path, p.Storage.Bucket, nullMicros(p.Storage.ModTime),
		p.EXIF.Camera, p.EXIF.Lens, p.EXIF.ISO, p.EXIF.FNum, p.EXIF.Shutter,
		lat, lon, p.Thumbs.S256, p.Thumbs.S512, p.Thumbs.S1024, p.Thumbs.S2048,
		micros(p.ImportedAt), nullMicros(p.DeletedAt),
	}
}

// placeholders renders "?, ?, ?" for n values.
func placeholders(n int) string {
	if n <= 0 {
		return ""
	}
	return strings.TrimSuffix(strings.Repeat("?, ", n), ", ")
}

// inClause renders "col IN (?, ?)" and appends the values to args.
func inClause(col string, values []string, args *[]any) string {
	for _, v := range values {
		*args = append(*args, v)
	}
	return col + " IN (" + placeholders(len(values)) + ")"
}

// splitColumns splits a column list into trimmed names.
func splitColumns(cols string) []string {
	parts := strings.Split(cols, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
