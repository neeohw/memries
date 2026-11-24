package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Local struct {
	root string

	// SkipDir hides a directory tree from Walk. Set per Source from its
	// exclude patterns, so the indexer needs no knowledge of them: a tree it
	// never sees is a tree it never indexes, and the prune pass removes what
	// it indexed before (ADR 0020).
	SkipDir SkipDirFunc
}

func NewLocal(root string) (*Local, error) {
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	return &Local{root: abs}, nil
}

func (l *Local) Backend() string { return "local" }

func (l *Local) resolve(key string) (string, error) {
	key = strings.TrimPrefix(filepath.ToSlash(strings.TrimSpace(key)), "/")
	if key == "" || key == "." || key == ".." || strings.Contains(key, "..") {
		return "", fmt.Errorf("path escape: %s", key)
	}
	full := filepath.Join(l.root, key)
	absRoot, err := filepath.Abs(l.root)
	if err != nil {
		return "", err
	}
	absFull, err := filepath.Abs(full)
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(absRoot, absFull)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("path escape: %s", key)
	}
	return absFull, nil
}

func (l *Local) Put(ctx context.Context, key string, r io.Reader) error {
	p, err := l.resolve(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	tmp := p + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, r); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, p)
}

func (l *Local) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	if hidden(l.SkipDir, key) {
		return nil, fmt.Errorf("%w: %s is excluded", fs.ErrNotExist, key)
	}
	p, err := l.resolve(key)
	if err != nil {
		return nil, err
	}
	return os.Open(p)
}

func (l *Local) Stat(ctx context.Context, key string) (ObjectInfo, error) {
	// Excluded trees do not exist as far as this Source is concerned, so a
	// Photo left behind by an earlier scan is pruned rather than kept alive
	// by a Stat that looked straight past the exclude.
	if hidden(l.SkipDir, key) {
		return ObjectInfo{}, fmt.Errorf("%w: %s is excluded", fs.ErrNotExist, key)
	}
	p, err := l.resolve(key)
	if err != nil {
		return ObjectInfo{}, err
	}
	st, err := os.Stat(p)
	if err != nil {
		return ObjectInfo{}, err
	}
	return ObjectInfo{Key: key, Size: st.Size(), ModTime: st.ModTime(), CreatedAt: fileCreatedAt(st)}, nil
}

func (l *Local) URL(ctx context.Context, key string, ttl time.Duration) (string, error) {
	return "file://" + url.PathEscape(key), nil
}

func (l *Local) Delete(ctx context.Context, key string) error {
	p, err := l.resolve(key)
	if err != nil {
		return err
	}
	err = os.Remove(p)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	return err
}

// OpenLocal opens an existing directory without creating it. A missing root is
// an error so an unmounted share never looks like an empty library.
func OpenLocal(root string) (*Local, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	st, err := os.Stat(abs)
	if err != nil {
		return nil, err
	}
	if !st.IsDir() {
		return nil, fmt.Errorf("not a directory: %s", abs)
	}
	return &Local{root: abs}, nil
}

func (l *Local) Walk(ctx context.Context, prefix string, fn func(ObjectInfo) error) error {
	base := l.root
	if strings.Trim(prefix, "/") != "" {
		var err error
		if base, err = l.resolve(prefix); err != nil {
			return err
		}
	} else if _, err := os.Stat(base); err != nil {
		return err
	}
	return filepath.WalkDir(base, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				return nil
			}
			return err
		}
		if d.IsDir() {
			// Checked before descending, so an excluded tree is never read.
			// The walk's own base is never skipped: a Source that excluded
			// itself would silently index nothing.
			if l.SkipDir != nil && p != base {
				if rel, rerr := filepath.Rel(l.root, p); rerr == nil && l.SkipDir(filepath.ToSlash(rel)) {
					return fs.SkipDir
				}
			}
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(l.root, p)
		if err != nil {
			return err
		}
		key := filepath.ToSlash(rel)
		return fn(ObjectInfo{Key: key, Size: info.Size(), ModTime: info.ModTime(), CreatedAt: fileCreatedAt(info)})
	})
}

// AbsPath returns absolute filesystem path for a key.
// Used by API layer to serve originals via Caddy X-Accel/sendfile.
func (l *Local) AbsPath(key string) (string, error) {
	return l.resolve(key)
}
