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

// SetFavorites adds or removes this reader's favorites in one go (ADR 0018),
// and reports how many ids it acted on.
//
// Every id is checked to be a live Photo first, so a batch holding one id
// that is not adds nothing at all rather than half the selection: the ids
// come from the reader's own grid, so a mismatch is a bug worth surfacing,
// not a condition to paper over.
func (s *Store) SetFavorites(ctx context.Context, viewer string, photoIDs []string, favorite bool) (int, error) {
	ids := dedupe(photoIDs)
	if len(ids) == 0 {
		return 0, nil
	}
	if len(ids) > MaxBatchPhotos {
		return 0, fmt.Errorf("at most %d photos per request, got %d", MaxBatchPhotos, len(ids))
	}
	if err := s.requireLivePhotos(ctx, ids); err != nil {
		return 0, err
	}

	now := micros(time.Now().UTC())
	err := s.tx(ctx, func(tx *sql.Tx) error {
		for _, id := range ids {
			var err error
			if favorite {
				_, err = tx.ExecContext(ctx, s.rebind(
					`INSERT INTO favorites (user_key, photo_key, created_at) VALUES (?, ?, ?)
					 ON CONFLICT (user_key, photo_key) DO NOTHING`), viewer, id, now)
			} else {
				_, err = tx.ExecContext(ctx, s.rebind(
					`DELETE FROM favorites WHERE user_key = ? AND photo_key = ?`), viewer, id)
			}
			if err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return len(ids), nil
}

// requireLivePhotos reports ErrForbidden unless every id is a live Photo.
func (s *Store) requireLivePhotos(ctx context.Context, ids []string) error {
	var args []any
	q := `SELECT COUNT(*) FROM photos WHERE deleted_at IS NULL AND ` +
		inClause("key", ids, &args)
	var usable int
	if err := s.queryRow(ctx, q, args...).Scan(&usable); err != nil {
		return err
	}
	if usable != len(ids) {
		return ErrForbidden
	}
	return nil
}

// AddPhotosToAlbum adds several Photos to one Album in a single transaction
// (ADR 0018).
//
// The Album's ownership and every Photo's existence are checked before
// anything is written, so a batch containing one bad id adds nothing at all
// rather than half the selection. The library is shared, so a Photo has no
// owner to check — only the Album does (ADR 0020).
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

	if err := s.requireLivePhotos(ctx, ids); err != nil {
		return nil, err
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
