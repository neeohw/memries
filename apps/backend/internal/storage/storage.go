package storage

import (
	"context"
	"io"
	"strings"
	"time"
)

type ObjectInfo struct {
	Key       string
	Size      int64
	ModTime   time.Time
	CreatedAt time.Time
}

type Storage interface {
	Backend() string
	Put(ctx context.Context, key string, r io.Reader) error
	Get(ctx context.Context, key string) (io.ReadCloser, error)
	Stat(ctx context.Context, key string) (ObjectInfo, error)
	URL(ctx context.Context, key string, ttl time.Duration) (string, error)
	Delete(ctx context.Context, key string) error
	Walk(ctx context.Context, prefix string, fn func(ObjectInfo) error) error
}

// SkipDirFunc reports whether a directory should be left unread.
//
// It takes the path relative to the backend's root, with no leading or
// trailing slash, and is consulted before the directory is opened, so an
// excluded tree costs nothing to read.
type SkipDirFunc func(dir string) bool

// hidden reports whether key sits inside a directory SkipDir excludes.
//
// An excluded tree has to be invisible to Stat and Get, not only to Walk.
// The prune pass asks whether an unseen path still exists before removing
// its Photo (ADR 0020): a Stat that answered from the filesystem would say
// yes, and an exclude added to a folder already indexed would take nothing
// out of the library — which is what it promises to do.
//
// Every ancestor is tried, because the pattern names a folder and the key
// names a file inside it, perhaps several levels down.
func hidden(skip SkipDirFunc, key string) bool {
	if skip == nil {
		return false
	}
	key = strings.Trim(strings.ReplaceAll(key, "\\", "/"), "/")
	for i, r := range key {
		if r == '/' && skip(key[:i]) {
			return true
		}
	}
	return false
}
