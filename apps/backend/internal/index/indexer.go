package index

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/memries/memries/internal/db"
	"github.com/memries/memries/internal/exif"
	"github.com/memries/memries/internal/storage"
	"github.com/memries/memries/internal/thumb"
)

type PhotoRepository interface {
	GetPhoto(ctx context.Context, key string) (*db.Photo, error)
	GetPhotoByHash(ctx context.Context, hash string) (*db.Photo, error)
	GetPhotoByOwnerPath(ctx context.Context, ownerID, path string) (*db.Photo, error)
	UpsertPhoto(ctx context.Context, p *db.Photo) error
	UpdateIndexedPhoto(ctx context.Context, p *db.Photo) error
	ListOwnerPhotoStorage(ctx context.Context, ownerID string) ([]db.PhotoStorageRef, error)
	SoftDeletePhoto(ctx context.Context, key string) error
}

type Indexer struct {
	Store storage.Storage
	DB    PhotoRepository
	Thumb *thumb.Generator
	Log   *slog.Logger
}

type Options struct {
	OwnerID     string
	Prefix      string // restrict walk; "" = whole storage
	Concurrency int
	Force       bool // reindex even if hash already present
	OnProgress  func(Result)
}

func (i *Indexer) Run(ctx context.Context, opts Options) (Result, error) {
	var res Result
	var mu sync.Mutex
	report := func() {
		if opts.OnProgress == nil {
			return
		}
		mu.Lock()
		snapshot := res
		mu.Unlock()
		opts.OnProgress(snapshot)
	}

	if opts.Concurrency <= 0 {
		opts.Concurrency = 4
	}
	if opts.OwnerID == "" {
		return res, fmt.Errorf("OwnerID required")
	}

	var keys []string
	if err := i.Store.Walk(ctx, opts.Prefix, func(o storage.ObjectInfo) error {
		if !isMedia(o.Key) {
			return nil
		}
		keys = append(keys, o.Key)
		mu.Lock()
		res.Discovered++
		mu.Unlock()
		report()
		return nil
	}); err != nil {
		return res, err
	}

	jobs := make(chan string, opts.Concurrency*2)
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() error {
		defer close(jobs)
		for _, key := range keys {
			select {
			case jobs <- key:
			case <-gctx.Done():
				return gctx.Err()
			}
		}
		return nil
	})
	for w := 0; w < opts.Concurrency; w++ {
		g.Go(func() error {
			for key := range jobs {
				skipped, err := i.indexOne(gctx, key, opts.OwnerID, opts.Force)
				mu.Lock()
				res.Processed++
				if err != nil {
					res.Failed++
				} else if skipped {
					res.Skipped++
				} else {
					res.Indexed++
				}
				mu.Unlock()
				if err != nil {
					i.Log.Error("index", "key", key, "err", err)
				}
				report()
			}
			return nil
		})
	}
	if err := g.Wait(); err != nil {
		return res, err
	}
	// After relocating paths for rediscovered content, soft-delete rows whose
	// original file is still missing so /api/original stops 500ing on ghosts.
	if err := i.pruneMissingOriginals(ctx, opts.OwnerID); err != nil {
		i.Log.Error("prune missing", "owner", opts.OwnerID, "err", err)
	}
	return res, nil
}

func (i *Indexer) indexOne(ctx context.Context, key, ownerID string, force bool) (bool, error) {
	rc, err := i.Store.Get(ctx, key)
	if err != nil {
		return false, err
	}
	defer rc.Close()

	hasher := sha256.New()
	var exifBuf [1 << 16]byte
	exifRead := 0
	exifPeek := exifBuf[:0]
	buf := make([]byte, 32*1024)
	var size int64
	for {
		n, rerr := rc.Read(buf)
		if n > 0 {
			hasher.Write(buf[:n])
			size += int64(n)
			if exifRead < len(exifBuf) {
				take := len(exifBuf) - exifRead
				if take > n {
					take = n
				}
				exifPeek = append(exifPeek, buf[:take]...)
				exifRead += take
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			return false, rerr
		}
	}
	hash := hex.EncodeToString(hasher.Sum(nil))

	info, err := i.Store.Stat(ctx, key)
	if err != nil {
		info = storage.ObjectInfo{Key: key}
	}

	var exifRes exif.Result
	if r, err := exif.Parse(bytesReader(exifPeek)); err == nil {
		exifRes = r
	}
	cap := ResolveCaptureTime(exifRes, info)

	byPath, err := lookupPhoto(i.DB.GetPhotoByOwnerPath(ctx, ownerID, key))
	if err != nil {
		return false, err
	}
	byHash, err := lookupPhoto(i.DB.GetPhotoByHash(ctx, hash))
	if err != nil {
		return false, err
	}
	keepKey, action := ResolveIdentity(key, hash, byPath, byHash)

	mimeType := mime.TypeByExtension(strings.ToLower(filepath.Ext(key)))
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	existing := byPath
	if existing == nil {
		existing = byHash
	}

	if !force && existing != nil && existing.Hash == hash && i.Thumb.HasAll(existing.Thumbs.S256, existing.Thumbs.S512, existing.Thumbs.S1024) {
		changed := CaptureChanged(*existing, cap)
		if action == IdentityRelocate {
			if err := i.touchRelocatedPath(ctx, existing, key, hash); err != nil {
				return false, err
			}
		}
		if changed || existing.Storage.Path != key || existing.DeletedAt != nil {
			applyCapture(existing, cap)
			existing.Storage, _ = relocatedStorage(existing.Storage, key, i.Store.Backend())
			existing.DeletedAt = nil
			if err := i.DB.UpdateIndexedPhoto(ctx, existing); err != nil {
				return false, err
			}
			i.Log.Info("refresh capture", "key", key, "id", keepKey, "taken_at_local", cap.TakenAtLocal)
			return false, nil
		}
		i.Log.Info("skip existing", "key", key, "hash", hash[:12])
		return true, nil
	}

	rc2, err := i.Store.Get(ctx, key)
	if err != nil {
		return false, err
	}
	defer rc2.Close()
	thumbRes, err := i.Thumb.Generate(keepKey, rc2, exifRes.Orientation)
	if err != nil {
		return false, fmt.Errorf("thumb: %w", err)
	}

	p := &db.Photo{
		Key:         keepKey,
		Kind:        "photo",
		OwnerID:     ownerID,
		Storage:     db.StoragePtr{Backend: i.Store.Backend(), Path: key},
		Hash:        hash,
		SizeBytes:   size,
		MIME:        mimeType,
		Dims:        db.Dims{W: thumbRes.Width, H: thumbRes.Height},
		Orientation: exifRes.Orientation,
		EXIF:        exifRes.EXIF,
		Thumbs: db.Thumbs{
			S256:  thumbRes.Paths[256],
			S512:  thumbRes.Paths[512],
			S1024: thumbRes.Paths[1024],
		},
		ImportedAt: time.Now().UTC(),
	}
	if existing != nil {
		p.ImportedAt = existing.ImportedAt
		p.Favorite = existing.Favorite
	}
	applyCapture(p, cap)
	if existing != nil {
		if err := i.DB.UpdateIndexedPhoto(ctx, p); err != nil {
			return false, fmt.Errorf("update: %w", err)
		}
	} else if err := i.DB.UpsertPhoto(ctx, p); err != nil {
		return false, fmt.Errorf("upsert: %w", err)
	}
	i.Log.Info("indexed", "key", key, "id", keepKey, "hash", hash[:12], "taken_at_local", cap.TakenAtLocal, "source", cap.Source)
	return false, nil
}

func lookupPhoto(p *db.Photo, err error) (*db.Photo, error) {
	if err == nil {
		return p, nil
	}
	if errors.Is(err, db.ErrNotFound) || err.Error() == "not found" {
		return nil, nil
	}
	return nil, err
}

func (i *Indexer) CountMediaPrefix(ctx context.Context, prefix string) (int, error) {
	var n int
	err := i.Store.Walk(ctx, prefix, func(o storage.ObjectInfo) error {
		if isMedia(o.Key) {
			n++
		}
		return nil
	})
	return n, err
}

func isMedia(key string) bool {
	switch strings.ToLower(path.Ext(key)) {
	case ".jpg", ".jpeg", ".png", ".webp", ".gif":
		return true
	}
	return false
}

type bytesReadCloser struct {
	b []byte
	i int
}

func bytesReader(b []byte) io.Reader { return &bytesReadCloser{b: b} }

func (r *bytesReadCloser) Read(p []byte) (int, error) {
	if r.i >= len(r.b) {
		return 0, io.EOF
	}
	n := copy(p, r.b[r.i:])
	r.i += n
	return n, nil
}
