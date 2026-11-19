package db

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"strings"
	"time"
)

type AlbumView struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	CreatedAt    time.Time `json:"created_at"`
	PhotoCount   int       `json:"photo_count"`
	CoverPhotoID string    `json:"cover_photo_id,omitempty"`
	PhotoIDs     []string  `json:"photo_ids"`
}

type AlbumDetail struct {
	AlbumView
	Photos []Photo `json:"photos"`
}

func newDocumentKey() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (s *Store) CreateAlbum(ctx context.Context, ownerID, name string) (*AlbumView, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("album name is required")
	}
	a := Album{
		Key:        newDocumentKey(),
		Name:       name,
		OwnerID:    ownerID,
		Visibility: "private",
		CreatedAt:  time.Now().UTC(),
	}
	_, err := s.exec(ctx,
		`INSERT INTO albums (key, name, owner_id, visibility, created_at)
		 VALUES (?, ?, ?, ?, ?)`,
		a.Key, a.Name, a.OwnerID, a.Visibility, micros(a.CreatedAt))
	if err != nil {
		return nil, err
	}
	return &AlbumView{ID: a.Key, Name: a.Name, CreatedAt: a.CreatedAt, PhotoIDs: []string{}}, nil
}

// ListAlbums returns the Owner's Albums, newest first, each with its ordered
// member keys.
//
// Membership here is deliberately NOT filtered on deleted_at, matching the
// photo_count still includes soft-deleted members, while
// GetAlbumView excludes them. See docs/todos/p2-album-deleted-counts.md.
func (s *Store) ListAlbums(ctx context.Context, ownerID string) ([]AlbumView, error) {
	rows, err := s.query(ctx, `
		SELECT a.key, a.name, a.created_at, p.key
		FROM albums a
		LEFT JOIN album_photos ap ON ap.album_key = a.key
		LEFT JOIN photos p ON p.key = ap.photo_key
		WHERE a.owner_id = ?
		ORDER BY a.created_at DESC, a.key DESC,
		         p.taken_at DESC, p.key DESC`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AlbumView{}
	index := map[string]int{}
	for rows.Next() {
		var (
			key, name string
			createdAt int64
			photoKey  sql.NullString
		)
		if err := rows.Scan(&key, &name, &createdAt, &photoKey); err != nil {
			return nil, err
		}
		at, ok := index[key]
		if !ok {
			out = append(out, AlbumView{
				ID:        key,
				Name:      name,
				CreatedAt: fromMicros(createdAt),
				PhotoIDs:  []string{},
			})
			at = len(out) - 1
			index[key] = at
		}
		if photoKey.Valid {
			out[at].PhotoIDs = append(out[at].PhotoIDs, photoKey.String)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		out[i].PhotoCount = len(out[i].PhotoIDs)
		if len(out[i].PhotoIDs) > 0 {
			out[i].CoverPhotoID = out[i].PhotoIDs[0]
		}
	}
	return out, nil
}

func (s *Store) GetAlbum(ctx context.Context, albumID string) (*Album, error) {
	var (
		a         Album
		createdAt int64
	)
	err := s.queryRow(ctx,
		`SELECT key, name, owner_id, visibility, created_at FROM albums WHERE key = ?`,
		albumID).Scan(&a.Key, &a.Name, &a.OwnerID, &a.Visibility, &createdAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	a.CreatedAt = fromMicros(createdAt)
	return &a, nil
}

func (s *Store) albumPhotos(ctx context.Context, viewer, albumID string) ([]Photo, []string, error) {
	rows, err := s.query(ctx, `
		SELECT `+prefixColumns(photoColumns, "p")+`,
		       EXISTS (SELECT 1 FROM favorites f
		               WHERE f.photo_key = p.key AND f.user_key = ?)
		FROM album_photos ap
		JOIN photos p ON p.key = ap.photo_key
		WHERE ap.album_key = ? AND p.deleted_at IS NULL
		ORDER BY p.taken_at DESC, p.key DESC`, viewer, albumID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	photos := []Photo{}
	ids := []string{}
	for rows.Next() {
		p, err := scanPhoto(rows)
		if err != nil {
			return nil, nil, err
		}
		photos = append(photos, *p)
		ids = append(ids, p.Key)
	}
	return photos, ids, rows.Err()
}

func (s *Store) GetAlbumView(ctx context.Context, ownerID, albumID string) (*AlbumDetail, error) {
	album, err := s.GetAlbum(ctx, albumID)
	if err != nil {
		return nil, err
	}
	if album.OwnerID != ownerID {
		return nil, ErrForbidden
	}
	// The Album is the owner's; the favorite flags on its photos are theirs too.
	photos, ids, err := s.albumPhotos(ctx, ownerID, albumID)
	if err != nil {
		return nil, err
	}
	cover := ""
	if len(ids) > 0 {
		cover = ids[0]
	}
	return &AlbumDetail{
		AlbumView: AlbumView{
			ID:           album.Key,
			Name:         album.Name,
			CreatedAt:    album.CreatedAt,
			PhotoCount:   len(ids),
			CoverPhotoID: cover,
			PhotoIDs:     ids,
		},
		Photos: photos,
	}, nil
}

func (s *Store) albumViewForOwner(ctx context.Context, ownerID, albumID string) (*AlbumView, error) {
	views, err := s.ListAlbums(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	for i := range views {
		if views[i].ID == albumID {
			return &views[i], nil
		}
	}
	return nil, ErrNotFound
}

func (s *Store) AddPhotoToAlbum(ctx context.Context, ownerID, albumID, photoID string) (*AlbumView, error) {
	album, err := s.GetAlbum(ctx, albumID)
	if err != nil {
		return nil, err
	}
	if album.OwnerID != ownerID {
		return nil, ErrForbidden
	}
	// The library is shared, so any photo may go in any Album; only the
	// Album itself is owned (ADR 0020).
	photo, err := s.GetPhoto(ctx, ownerID, photoID)
	if err != nil {
		return nil, err
	}
	if photo.DeletedAt != nil {
		return nil, ErrNotFound
	}
	// Idempotent: the primary key already enforces one row per pair.
	if _, err := s.exec(ctx, `
		INSERT INTO album_photos (album_key, photo_key, added_at)
		VALUES (?, ?, ?)
		ON CONFLICT (album_key, photo_key) DO NOTHING`,
		albumID, photoID, micros(time.Now().UTC())); err != nil {
		return nil, err
	}
	return s.albumViewForOwner(ctx, ownerID, albumID)
}

func (s *Store) RemovePhotoFromAlbum(ctx context.Context, ownerID, albumID, photoID string) (*AlbumView, error) {
	album, err := s.GetAlbum(ctx, albumID)
	if err != nil {
		return nil, err
	}
	if album.OwnerID != ownerID {
		return nil, ErrForbidden
	}
	if _, err := s.exec(ctx,
		`DELETE FROM album_photos WHERE album_key = ? AND photo_key = ?`,
		albumID, photoID); err != nil {
		return nil, err
	}
	return s.albumViewForOwner(ctx, ownerID, albumID)
}

// ClearOwnerAlbumsAndFavorites drops this reader's Albums and their
// favorites. One transaction, so a reset is all-or-nothing.
//
// It leaves the photos alone: they are the library's, not the reader's.
func (s *Store) ClearOwnerAlbumsAndFavorites(ctx context.Context, ownerID string) error {
	return s.tx(ctx, func(t *sql.Tx) error {
		if _, err := t.ExecContext(ctx, s.rebind(`
			DELETE FROM album_photos
			WHERE album_key IN (SELECT key FROM albums WHERE owner_id = ?)`),
			ownerID); err != nil {
			return err
		}
		if _, err := t.ExecContext(ctx, s.rebind(
			`DELETE FROM albums WHERE owner_id = ?`), ownerID); err != nil {
			return err
		}
		_, err := t.ExecContext(ctx, s.rebind(
			`DELETE FROM favorites WHERE user_key = ?`), ownerID)
		return err
	})
}

// prefixColumns qualifies every name in a column list with a table alias.
func prefixColumns(cols, alias string) string {
	parts := strings.Split(compactColumns(cols), ", ")
	for i := range parts {
		parts[i] = alias + "." + parts[i]
	}
	return strings.Join(parts, ", ")
}
