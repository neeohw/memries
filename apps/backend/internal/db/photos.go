package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

var ErrNotFound = errors.New("not found")
var ErrForbidden = errors.New("forbidden")

// ErrKeyOwnedByAnother reports that the Photo key is already held by a
// different Owner. Photo keys are table-unique, so an upsert must never
// quietly overwrite someone else's row (ADR 0014).
var ErrKeyOwnedByAnother = errors.New("photo key belongs to another owner")

func (s *Store) UpsertPhoto(ctx context.Context, p *Photo) error {
	cols := compactColumns(photoColumns)
	// The guard makes a cross-owner key collision affect zero rows instead of
	// replacing the other Owner's Photo.
	q := `INSERT INTO photos (` + cols + `) VALUES (` + placeholders(photoColumnCount) + `)
		ON CONFLICT (key) DO UPDATE SET ` + excludedAssignments(cols, "key") + `
		WHERE photos.owner_id = excluded.owner_id`
	res, err := s.exec(ctx, q, photoValues(p)...)
	if err != nil {
		return err
	}
	if n, err := res.RowsAffected(); err == nil && n == 0 {
		return ErrKeyOwnedByAnother
	}
	return nil
}

func (s *Store) GetPhoto(ctx context.Context, key string) (*Photo, error) {
	row := s.queryRow(ctx,
		`SELECT `+photoColumns+` FROM photos WHERE key = ?`, key)
	p, err := scanPhoto(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

type Bucket struct {
	Bucket       string    `json:"bucket"`
	Count        int       `json:"count"`
	CoverPhotoID string    `json:"cover_photo_id"`
	First        time.Time `json:"first"`
	Last         time.Time `json:"last"`
}

// Timeline groups the Owner's Photos into calendar buckets. Buckets come from
// taken_at_local, not taken_at: the UI reasons in the capture clock (ADR 0005),
// and a substring of the local text is identical in both dialects where an
// epoch conversion would not be. Rows with no local capture clock are skipped.
func (s *Store) Timeline(ctx context.Context, ownerID, granularity string, from, to time.Time) ([]Bucket, error) {
	bucket := s.bucketExpr(granularity)
	q := `
		WITH ranked AS (
		  SELECT key, taken_at, ` + bucket + ` AS bucket,
		         ROW_NUMBER() OVER (
		           PARTITION BY ` + bucket + `
		           ORDER BY taken_at DESC, key DESC
		         ) AS rn
		  FROM photos
		  WHERE owner_id = ?
		    AND deleted_at IS NULL
		    AND taken_at >= ? AND taken_at < ?
		    AND taken_at_local <> ''
		)
		SELECT bucket, COUNT(*) AS n,
		       MIN(taken_at) AS first_at, MAX(taken_at) AS last_at,
		       MIN(CASE WHEN rn = 1 THEN key END) AS cover
		FROM ranked
		GROUP BY bucket
		ORDER BY bucket DESC`
	rows, err := s.query(ctx, q, ownerID, micros(from), micros(to))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Bucket
	for rows.Next() {
		var (
			b               Bucket
			firstAt, lastAt int64
			cover           sql.NullString
		)
		if err := rows.Scan(&b.Bucket, &b.Count, &firstAt, &lastAt, &cover); err != nil {
			return nil, err
		}
		b.First = fromMicros(firstAt)
		b.Last = fromMicros(lastAt)
		b.CoverPhotoID = cover.String
		out = append(out, b)
	}
	return out, rows.Err()
}

type PhotoFilter struct {
	Years     []string
	Months    []string
	Favorite  *bool
	Query     string
	LocalFrom string
	LocalTo   string
}

func (s *Store) Photos(ctx context.Context, ownerID string, from, to time.Time, limit int, cursor string) ([]Photo, string, error) {
	return s.PhotosFiltered(ctx, ownerID, from, to, limit, cursor, PhotoFilter{})
}

func (s *Store) PhotosFiltered(ctx context.Context, ownerID string, from, to time.Time, limit int, cursor string, filter PhotoFilter) ([]Photo, string, error) {
	limit = ClampPhotoLimit(limit)
	where := []string{"owner_id = ?", "deleted_at IS NULL", "taken_at >= ?", "taken_at < ?"}
	args := []any{ownerID, micros(from), micros(to)}

	appendPhotoFilter(filter, &where, &args)

	if cursor != "" {
		taken, key, err := DecodeCursor(cursor)
		if err != nil {
			return nil, "", err
		}
		where = append(where, "(taken_at < ? OR (taken_at = ? AND key < ?))")
		args = append(args, micros(taken), micros(taken), key)
	}
	args = append(args, limit+1)

	q := `SELECT ` + photoColumns + ` FROM photos
		WHERE ` + strings.Join(where, " AND ") + `
		ORDER BY taken_at DESC, key DESC
		LIMIT ?`
	rows, err := s.query(ctx, q, args...)
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()
	var out []Photo
	for rows.Next() {
		p, err := scanPhoto(rows)
		if err != nil {
			return nil, "", err
		}
		out = append(out, *p)
	}
	if err := rows.Err(); err != nil {
		return nil, "", err
	}
	page, next := ClipPage(out, limit)
	return page, next, nil
}

func (s *Store) CountOwnerPhotos(ctx context.Context, ownerID string) (int64, error) {
	var n int64
	err := s.queryRow(ctx,
		`SELECT COUNT(*) FROM photos WHERE owner_id = ? AND deleted_at IS NULL`,
		ownerID).Scan(&n)
	return n, err
}

type PhotoStorageRef struct {
	Key  string `json:"_key"`
	Path string `json:"path"`
}

func (s *Store) ListOwnerPhotoStorage(ctx context.Context, ownerID string) ([]PhotoStorageRef, error) {
	rows, err := s.query(ctx,
		`SELECT key, storage_path FROM photos
		 WHERE owner_id = ? AND deleted_at IS NULL`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PhotoStorageRef
	for rows.Next() {
		var ref PhotoStorageRef
		if err := rows.Scan(&ref.Key, &ref.Path); err != nil {
			return nil, err
		}
		out = append(out, ref)
	}
	return out, rows.Err()
}

func (s *Store) SoftDeletePhoto(ctx context.Context, key string) error {
	_, err := s.exec(ctx,
		`UPDATE photos SET deleted_at = ? WHERE key = ?`,
		micros(time.Now().UTC()), key)
	return err
}

// bucketExpr renders the calendar bucket label from taken_at_local. ISO
// year-week is the one expression the two dialects spell differently.
func (s *Store) bucketExpr(granularity string) string {
	switch granularity {
	case "year":
		return "substr(taken_at_local, 1, 4)"
	case "day":
		return "substr(taken_at_local, 1, 10)"
	case "week":
		return s.weekExpr("taken_at_local")
	default: // month
		return "substr(taken_at_local, 1, 7)"
	}
}

func appendPhotoFilter(filter PhotoFilter, where *[]string, args *[]any) {
	if len(filter.Years) > 0 {
		*where = append(*where, inClause("substr(taken_at_local, 1, 4)", filter.Years, args))
	}
	if len(filter.Months) > 0 {
		*where = append(*where, inClause("substr(taken_at_local, 6, 2)", filter.Months, args))
	}
	if filter.LocalFrom != "" {
		*where = append(*where, "substr(taken_at_local, 1, 10) >= ?")
		*args = append(*args, filter.LocalFrom)
	}
	if filter.LocalTo != "" {
		*where = append(*where, "substr(taken_at_local, 1, 10) < ?")
		*args = append(*args, filter.LocalTo)
	}
	if filter.Favorite != nil {
		*where = append(*where, "favorite = ?")
		*args = append(*args, *filter.Favorite)
	}
	if q := strings.ToLower(strings.TrimSpace(filter.Query)); q != "" {
		// The Arango original matched a literal substring, so LIKE wildcards
		// in the user's query must not act as wildcards.
		*where = append(*where, `LOWER(taken_at_local) LIKE ? ESCAPE '\'`)
		*args = append(*args, "%"+escapeLike(q)+"%")
	}
}

// escapeLike neutralises LIKE metacharacters so the pattern matches literally.
func escapeLike(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r == '\\' || r == '%' || r == '_' {
			b.WriteByte('\\')
		}
		b.WriteRune(r)
	}
	return b.String()
}

// GetPhotoByHash finds a Photo of this Owner by content hash. Owner-scoped, so
// identical bytes in two libraries stay two Photos (ADR 0014). Live rows win
// over soft-deleted ones.
func (s *Store) GetPhotoByHash(ctx context.Context, ownerID, hash string) (*Photo, error) {
	return s.readPhoto(ctx,
		`SELECT `+photoColumns+` FROM photos
		 WHERE owner_id = ? AND hash = ?
		 ORDER BY (deleted_at IS NULL) DESC
		 LIMIT 1`, ownerID, hash)
}

func (s *Store) GetPhotoByOwnerPath(ctx context.Context, ownerID, path string) (*Photo, error) {
	return s.readPhoto(ctx,
		`SELECT `+photoColumns+` FROM photos
		 WHERE owner_id = ? AND storage_path = ?
		 ORDER BY (deleted_at IS NULL) DESC
		 LIMIT 1`, ownerID, path)
}

func (s *Store) readPhoto(ctx context.Context, q string, args ...any) (*Photo, error) {
	p, err := scanPhoto(s.queryRow(ctx, q, args...))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

// UpdateIndexedPhoto refreshes everything an Index run can learn about a Photo
// and clears deleted_at, so rediscovered content comes back with its identity,
// favorite flag and Album membership intact.
func (s *Store) UpdateIndexedPhoto(ctx context.Context, p *Photo) error {
	var lat, lon any
	if p.EXIF.GPS != nil {
		lat, lon = p.EXIF.GPS.Lat, p.EXIF.GPS.Lon
	}
	_, err := s.exec(ctx, `
		UPDATE photos SET
		  taken_at = ?, taken_at_local = ?, taken_at_source = ?, tz_offset = ?,
		  storage_backend = ?, storage_path = ?, storage_bucket = ?, storage_mtime = ?,
		  hash = ?, size_bytes = ?, mime = ?, width = ?, height = ?, orientation = ?,
		  exif_camera = ?, exif_lens = ?, exif_iso = ?, exif_f_number = ?,
		  exif_shutter = ?, exif_gps_lat = ?, exif_gps_lon = ?,
		  thumb_256 = ?, thumb_512 = ?, thumb_1024 = ?,
		  deleted_at = NULL
		WHERE key = ?`,
		micros(p.TakenAt), p.TakenAtLocal, p.TakenAtSource, p.TZOffset,
		p.Storage.Backend, p.Storage.Path, p.Storage.Bucket, nullMicros(p.Storage.ModTime),
		p.Hash, p.SizeBytes, p.MIME, p.Dims.W, p.Dims.H, p.Orientation,
		p.EXIF.Camera, p.EXIF.Lens, p.EXIF.ISO, p.EXIF.FNum,
		p.EXIF.Shutter, lat, lon,
		p.Thumbs.S256, p.Thumbs.S512, p.Thumbs.S1024,
		p.Key)
	return err
}

func (s *Store) SetFavorite(ctx context.Context, ownerID, photoID string, favorite bool) (*Photo, error) {
	p, err := s.GetPhoto(ctx, photoID)
	if err != nil {
		return nil, err
	}
	if p.OwnerID != ownerID {
		return nil, ErrForbidden
	}
	if _, err := s.exec(ctx,
		`UPDATE photos SET favorite = ? WHERE key = ?`, favorite, photoID); err != nil {
		return nil, err
	}
	p.Favorite = favorite
	return p, nil
}

// --- column plumbing ----------------------------------------------------

// photoColumnCount must match the number of names in photoColumns.
var photoColumnCount = len(strings.Split(compactColumns(photoColumns), ", "))

// compactColumns collapses the multi-line photoColumns constant onto one line.
func compactColumns(cols string) string {
	parts := strings.Split(cols, ",")
	for i := range parts {
		parts[i] = strings.TrimSpace(parts[i])
	}
	return strings.Join(parts, ", ")
}

// excludedAssignments renders "a = excluded.a, b = excluded.b" for an upsert,
// skipping the conflict key.
func excludedAssignments(cols string, skip ...string) string {
	skipped := map[string]bool{}
	for _, s := range skip {
		skipped[s] = true
	}
	var parts []string
	for _, c := range strings.Split(cols, ", ") {
		if skipped[c] {
			continue
		}
		parts = append(parts, fmt.Sprintf("%s = excluded.%s", c, c))
	}
	return strings.Join(parts, ", ")
}
