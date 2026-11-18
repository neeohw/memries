package index

import (
	"context"
	"time"

	"github.com/memries/memries/internal/db"
	"github.com/memries/memries/internal/storage"
)

const recentOriginalSample = 8

type PhotoLister interface {
	Photos(ctx context.Context, ownerID string, from, to time.Time, limit int, cursor string) ([]db.Photo, string, error)
}

type PathStater interface {
	Stat(ctx context.Context, key string) (storage.ObjectInfo, error)
}

// Library probes whether recent indexed originals still exist on disk.
type Library struct {
	Photos PhotoLister
	Store  PathStater
}

func (l Library) RecentOriginalsMissing(ctx context.Context, ownerID string) (bool, error) {
	from := time.Date(1970, 1, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2100, 1, 1, 0, 0, 0, 0, time.UTC)
	photos, _, err := l.Photos.Photos(ctx, ownerID, from, to, recentOriginalSample, "")
	if err != nil {
		return false, err
	}
	if len(photos) == 0 {
		return false, nil
	}
	for _, p := range photos {
		if p.Storage.Path == "" {
			continue
		}
		// Only a definite "not found" counts: an unreachable network Source
		// must not trigger a rescan on every page load.
		if _, err := l.Store.Stat(ctx, p.Storage.Path); err == nil || !storage.IsNotFound(err) {
			return false, nil
		}
	}
	return true, nil
}
