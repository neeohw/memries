package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
)

const sourceColumns = `key, name, type, location, username, secret,
	created_at, updated_at, excludes`

func scanSource(sc rowScanner) (*Source, error) {
	var (
		s                    Source
		createdAt, updatedAt int64
		excludes             string
	)
	err := sc.Scan(&s.Key, &s.Name, &s.Type, &s.Location, &s.Username, &s.Secret,
		&createdAt, &updatedAt, &excludes)
	if err != nil {
		return nil, err
	}
	s.CreatedAt = fromMicros(createdAt)
	s.UpdatedAt = fromMicros(updatedAt)
	s.Excludes = decodeExcludes(excludes)
	return &s, nil
}

// decodeExcludes reads the stored JSON array.
//
// Unreadable content yields no patterns rather than an error: a Source whose
// excludes cannot be parsed should index everything, which is visible and
// recoverable, instead of refusing to load and taking its photos with it.
func decodeExcludes(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var out []string
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil
	}
	return out
}

// encodeExcludes writes the JSON array, with no patterns stored as "" so the
// empty case has one spelling.
func encodeExcludes(patterns []string) string {
	if len(patterns) == 0 {
		return ""
	}
	b, err := json.Marshal(patterns)
	if err != nil {
		return ""
	}
	return string(b)
}

func (s *Store) ListSources(ctx context.Context) ([]Source, error) {
	return s.querySources(ctx,
		`SELECT `+sourceColumns+` FROM sources ORDER BY name, key`)
}

func (s *Store) querySources(ctx context.Context, q string, args ...any) ([]Source, error) {
	rows, err := s.query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Source{}
	for rows.Next() {
		src, err := scanSource(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *src)
	}
	return out, rows.Err()
}

func (s *Store) GetSource(ctx context.Context, key string) (*Source, error) {
	src, err := scanSource(s.queryRow(ctx,
		`SELECT `+sourceColumns+` FROM sources WHERE key = ?`, key))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return src, err
}

// CreateSource inserts src, assigning a key when the caller left it empty
// (the key is generated here, not by the database).
func (s *Store) CreateSource(ctx context.Context, src *Source) error {
	if src.Key == "" {
		src.Key = newDocumentKey()
	}
	_, err := s.exec(ctx,
		`INSERT INTO sources (`+compactColumns(sourceColumns)+`)
		 VALUES (`+placeholders(len(splitColumns(sourceColumns)))+`)`,
		src.Key, src.Name, src.Type, src.Location, src.Username, src.Secret,
		micros(src.CreatedAt), micros(src.UpdatedAt), encodeExcludes(src.Excludes))
	return err
}

func (s *Store) ReplaceSource(ctx context.Context, src *Source) error {
	res, err := s.exec(ctx, `
		UPDATE sources SET
		  name = ?, type = ?, location = ?, username = ?, secret = ?,
		  created_at = ?, updated_at = ?, excludes = ?
		WHERE key = ?`,
		src.Name, src.Type, src.Location, src.Username, src.Secret,
		micros(src.CreatedAt), micros(src.UpdatedAt),
		encodeExcludes(src.Excludes), src.Key)
	if err != nil {
		return err
	}
	return errIfNoRows(res)
}

func (s *Store) DeleteSource(ctx context.Context, key string) error {
	res, err := s.exec(ctx, `DELETE FROM sources WHERE key = ?`, key)
	if err != nil {
		return err
	}
	return errIfNoRows(res)
}

// OwnerSourcesMigrated reports whether the Owner's legacy email folder was
// already turned into an explicit Source. Missing users report false.
func (s *Store) RelocatePhotoPrefix(ctx context.Context, oldPrefix, newPrefix string) error {
	old := oldPrefix + "/"
	// substr is 1-based, so the tail starts one past the prefix length.
	tailStart := strconv.Itoa(len(old) + 1)
	_, err := s.exec(ctx, `
		UPDATE photos SET
		  storage_backend = 'source',
		  storage_path = ? || substr(storage_path, `+tailStart+`)
		WHERE storage_path LIKE ? ESCAPE '\'`,
		newPrefix+"/", escapeLike(old)+"%")
	return err
}

func errIfNoRows(res sql.Result) error {
	n, err := res.RowsAffected()
	if err != nil {
		// Some drivers do not report affected rows; treat as success.
		return nil
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
