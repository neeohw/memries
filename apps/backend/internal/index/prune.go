package index

import (
	"context"
	"strings"

	"github.com/memries/memries/internal/db"
	"github.com/memries/memries/internal/storage"
)

// pruneMissingOriginals soft-deletes Photos whose Original is gone. Paths seen in this run's walk are known present; paths under a
// prefix whose walk failed are left alone because the Source may only be
// unreachable, not empty.
func (i *Indexer) pruneMissingOriginals(ctx context.Context, seen map[string]bool, unreadable []string) error {
	refs, err := i.DB.ListPhotoStorage(ctx)
	if err != nil {
		return err
	}
	for _, ref := range refs {
		if ref.Path == "" || seen[ref.Path] || underAny(ref.Path, unreadable) {
			continue
		}
		if _, err := i.Store.Stat(ctx, ref.Path); err == nil {
			continue
		} else if !storage.IsNotFound(err) {
			i.Log.Warn("stat original", "key", ref.Key, "path", ref.Path, "err", err)
			continue
		}
		if err := i.DB.SoftDeletePhoto(ctx, ref.Key); err != nil {
			return err
		}
		i.Log.Info("prune missing original", "key", ref.Key, "path", ref.Path)
	}
	return nil
}

func underAny(p string, prefixes []string) bool {
	for _, prefix := range prefixes {
		prefix = strings.Trim(prefix, "/")
		if p == prefix || strings.HasPrefix(p, prefix+"/") {
			return true
		}
	}
	return false
}

func (i *Indexer) touchRelocatedPath(ctx context.Context, existing *db.Photo, key, hash string) error {
	ptr, moved := relocatedStorage(existing.Storage, key, i.Store.Backend())
	if !moved && existing.DeletedAt == nil {
		return nil
	}
	existing.Storage = ptr
	existing.DeletedAt = nil
	if err := i.DB.UpsertPhoto(ctx, existing); err != nil {
		return err
	}
	if moved {
		i.Log.Info("update relocated path", "key", key, "hash", hash[:12])
	}
	return nil
}
