package db

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// MaxBatchPhotos bounds a multi-photo request. Selections come from a grid the
// reader is looking at, so this is generous; the cap exists so one request
// cannot build an unbounded SQL statement.
const MaxBatchPhotos = 500

// dedupe keeps the first occurrence of each id, preserving order. Duplicates
// would make the affected-row counts below disagree with the request size.
func dedupe(ids []string) []string {
	seen := make(map[string]bool, len(ids))
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

// SetFavorites flips the favorite flag on several of the Owner's Photos at
// once (ADR 0018) and reports how many rows changed.
//
// The update is owner-scoped in SQL, so another Owner's Photo cannot be
// touched even if its id is submitted. A count that does not match the request
// means at least one id was not the Owner's, which is ErrForbidden rather than
// a silent partial success: the ids come from the reader's own grid, so a
// mismatch is a bug worth surfacing, not a condition to paper over.
func (s *Store) SetFavorites(ctx context.Context, ownerID string, photoIDs []string, favorite bool) (int, error) {
	ids := dedupe(photoIDs)
	if len(ids) == 0 {
		return 0, nil
	}
	if len(ids) > MaxBatchPhotos {
		return 0, fmt.Errorf("at most %d photos per request, got %d", MaxBatchPhotos, len(ids))
	}

	args := []any{favorite, ownerID}
	q := `UPDATE photos SET favorite = ? WHERE owner_id = ? AND ` +
		inClause("key", ids, &args)
	res, err := s.exec(ctx, q, args...)
	if err != nil {
		return 0, err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		// A driver that will not count rows cannot prove ownership either.
		return 0, nil
	}
	if int(affected) != len(ids) {
		return int(affected), ErrForbidden
	}
	return int(affected), nil
}

// AddPhotosToAlbum adds several Photos to one Album in a single transaction
// (ADR 0018).
//
// Ownership of the Album and of every Photo is checked before anything is
// written, so a batch containing one foreign id adds nothing at all rather
// than half the selection.
func (s *Store) AddPhotosToAlbum(ctx context.Context, ownerID, albumID string, photoIDs []string) (*AlbumView, error) {
	ids := dedupe(photoIDs)
	if len(ids) == 0 {
		return nil, fmt.Errorf("no photos given")
	}
	if len(ids) > MaxBatchPhotos {
		return nil, fmt.Errorf("at most %d photos per request, got %d", MaxBatchPhotos, len(ids))
	}

	album, err := s.GetAlbum(ctx, albumID)
	if err != nil {
		return nil, err
	}
	if album.OwnerID != ownerID {
		return nil, ErrForbidden
	}

	// One round trip to establish that every id is a live Photo of this Owner.
	args := []any{ownerID}
	countQ := `SELECT COUNT(*) FROM photos
	           WHERE owner_id = ? AND deleted_at IS NULL AND ` +
		inClause("key", ids, &args)
	var usable int
	if err := s.queryRow(ctx, countQ, args...).Scan(&usable); err != nil {
		return nil, err
	}
	if usable != len(ids) {
		return nil, ErrForbidden
	}

	now := micros(time.Now().UTC())
	err = s.tx(ctx, func(tx *sql.Tx) error {
		for _, id := range ids {
			// Idempotent: the primary key already enforces one row per pair.
			if _, err := tx.ExecContext(ctx, s.rebind(`
				INSERT INTO album_photos (album_key, photo_key, added_at)
				VALUES (?, ?, ?)
				ON CONFLICT (album_key, photo_key) DO NOTHING`),
				albumID, id, now); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.albumViewForOwner(ctx, ownerID, albumID)
}
