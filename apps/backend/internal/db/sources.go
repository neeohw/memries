package db

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
)

const sourceColumns = `key, name, type, location, username, secret,
	owner_id, owner_email, created_at, updated_at`

func scanSource(sc rowScanner) (*Source, error) {
	var (
		s                    Source
		createdAt, updatedAt int64
	)
	err := sc.Scan(&s.Key, &s.Name, &s.Type, &s.Location, &s.Username, &s.Secret,
		&s.OwnerID, &s.OwnerEmail, &createdAt, &updatedAt)
	if err != nil {
		return nil, err
	}
	s.CreatedAt = fromMicros(createdAt)
	s.UpdatedAt = fromMicros(updatedAt)
	return &s, nil
}

func (s *Store) ListSources(ctx context.Context) ([]Source, error) {
	return s.querySources(ctx,
		`SELECT `+sourceColumns+` FROM sources ORDER BY owner_email, name, key`)
}

func (s *Store) ListOwnerSources(ctx context.Context, ownerID string) ([]Source, error) {
	return s.querySources(ctx,
		`SELECT `+sourceColumns+` FROM sources WHERE owner_id = ? ORDER BY name, key`,
		ownerID)
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
// (Arango generated these server-side).
func (s *Store) CreateSource(ctx context.Context, src *Source) error {
	if src.Key == "" {
		src.Key = newDocumentKey()
	}
	_, err := s.exec(ctx,
		`INSERT INTO sources (`+compactColumns(sourceColumns)+`)
		 VALUES (`+placeholders(len(splitColumns(sourceColumns)))+`)`,
		src.Key, src.Name, src.Type, src.Location, src.Username, src.Secret,
		src.OwnerID, src.OwnerEmail, micros(src.CreatedAt), micros(src.UpdatedAt))
	return err
}

func (s *Store) ReplaceSource(ctx context.Context, src *Source) error {
	res, err := s.exec(ctx, `
		UPDATE sources SET
		  name = ?, type = ?, location = ?, username = ?, secret = ?,
		  owner_id = ?, owner_email = ?, created_at = ?, updated_at = ?
		WHERE key = ?`,
		src.Name, src.Type, src.Location, src.Username, src.Secret,
		src.OwnerID, src.OwnerEmail, micros(src.CreatedAt), micros(src.UpdatedAt),
		src.Key)
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
func (s *Store) OwnerSourcesMigrated(ctx context.Context, ownerID string) (bool, error) {
	var migrated boolVal
	err := s.queryRow(ctx,
		`SELECT sources_migrated FROM users WHERE key = ?`, ownerID).Scan(&migrated)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return bool(migrated), nil
}

// MarkOwnerSourcesMigrated is a no-op for a missing user, matching the Arango
// original.
func (s *Store) MarkOwnerSourcesMigrated(ctx context.Context, ownerID string) error {
	_, err := s.exec(ctx,
		`UPDATE users SET sources_migrated = ? WHERE key = ?`, true, ownerID)
	return err
}

// RelocatePhotoPrefix rewrites the Owner's storage paths from oldPrefix/... to
// newPrefix/... so Photos keep identity, favorites, and Album membership.
func (s *Store) RelocatePhotoPrefix(ctx context.Context, ownerID, oldPrefix, newPrefix string) error {
	old := oldPrefix + "/"
	// substr is 1-based, so the tail starts one past the prefix length.
	tailStart := strconv.Itoa(len(old) + 1)
	_, err := s.exec(ctx, `
		UPDATE photos SET
		  storage_backend = 'source',
		  storage_path = ? || substr(storage_path, `+tailStart+`)
		WHERE owner_id = ? AND storage_path LIKE ? ESCAPE '\'`,
		newPrefix+"/", ownerID, escapeLike(old)+"%")
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
