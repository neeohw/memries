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
	GetPhoto(ctx context.Context, viewer, key string) (*db.Photo, error)
	GetPhotoByHash(ctx context.Context, hash string) (*db.Photo, error)
	GetPhotoByPath(ctx context.Context, path string) (*db.Photo, error)
	UpsertPhoto(ctx context.Context, p *db.Photo) error
	UpdateIndexedPhoto(ctx context.Context, p *db.Photo) error
	ListPhotoStorage(ctx context.Context) ([]db.PhotoStorageRef, error)
	SoftDeletePhoto(ctx context.Context, key string) error
}

type Indexer struct {
	Store storage.Storage
	DB    PhotoRepository
	Thumb *thumb.Generator
	Log   *slog.Logger
}

type Options struct {
	// Prefixes are the storage roots to walk (one per Source). Empty walks
	// nothing but still prunes the Owner's Photos whose files are gone.
	Prefixes    []string
	Concurrency int
	Force       bool // reindex even if size, mtime, and hash are unchanged
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

	var objects []storage.ObjectInfo
	seen := map[string]bool{}
	var unreadable []string
	var walkErrs []error
	for _, prefix := range opts.Prefixes {
		err := i.Store.Walk(ctx, prefix, func(o storage.ObjectInfo) error {
			if !isMedia(o.Key) {
				return nil
			}
			objects = append(objects, o)
			seen[o.Key] = true
			mu.Lock()
			res.Discovered++
			mu.Unlock()
			report()
			return nil
		})
		if err != nil {
			if ctx.Err() != nil {
				return res, ctx.Err()
			}
			// One unreachable Source (NAS asleep, bad password) must not
			// fail the others or prune what it holds.
			i.Log.Error("walk source", "prefix", prefix, "err", err)
			unreadable = append(unreadable, prefix)
			walkErrs = append(walkErrs, fmt.Errorf("%s: %w", prefix, err))
			mu.Lock()
			res.Failed++
			mu.Unlock()
			report()
		}
	}
	if len(opts.Prefixes) > 0 && len(unreadable) == len(opts.Prefixes) {
		return res, errors.Join(walkErrs...)
	}

	jobs := make(chan storage.ObjectInfo, opts.Concurrency*2)
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() error {
		defer close(jobs)
		for _, o := range objects {
			select {
			case jobs <- o:
			case <-gctx.Done():
				return gctx.Err()
			}
		}
		return nil
	})
	for w := 0; w < opts.Concurrency; w++ {
		g.Go(func() error {
			for o := range jobs {
				skipped, err := i.indexOne(gctx, o, opts.Force)
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
					i.Log.Error("index", "key", o.Key, "err", err)
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
	if err := i.pruneMissingOriginals(ctx, seen, unreadable); err != nil {
		i.Log.Error("prune missing", "err", err)
	}
	return res, nil
}

func (i *Indexer) indexOne(ctx context.Context, info storage.ObjectInfo, force bool) (bool, error) {
	key := info.Key
	byPath, err := lookupPhoto(i.DB.GetPhotoByPath(ctx, key))
	if err != nil {
		return false, err
	}
	// Remote Sources make every byte expensive: trust size + mtime like rsync.
	if !force && byPath != nil && byPath.DeletedAt == nil && unchangedOnDisk(byPath, info) &&
		i.Thumb.HasAll(expectedThumbs(key, byPath.Thumbs)...) {
		return true, nil
	}

	data, err := i.read(ctx, key)
	if err != nil {
		return false, err
	}
	sum := sha256.Sum256(data)
	hash := hex.EncodeToString(sum[:])
	size := int64(len(data))

	var exifRes exif.Result
	// ParseAny picks the reader by sniffing the bytes: a HEIC keeps its EXIF
	// in an item that can sit past the JPEG window, so it needs the whole
	// buffer (ADR 0026).
	if r, err := exif.ParseAny(data); err == nil {
		exifRes = r
	}
	cap := ResolveCaptureTime(exifRes, info)

	byHash, err := lookupPhoto(i.DB.GetPhotoByHash(ctx, hash))
	if err != nil {
		return false, err
	}
	// One library, so the content hash is the key outright: there is no other
	// owner's Photo it could collide with (ADR 0020).
	keepKey, action := ResolveIdentity(key, hash, byPath, byHash)

	mimeType := mediaMIME(key)

	existing := byPath
	if existing == nil {
		existing = byHash
	}
	ptr := i.storagePtr(info)

	if !force && existing != nil && existing.Hash == hash && i.Thumb.HasAll(expectedThumbs(key, existing.Thumbs)...) {
		changed := CaptureChanged(*existing, cap)
		if action == IdentityRelocate {
			if err := i.touchRelocatedPath(ctx, existing, key, hash); err != nil {
				return false, err
			}
		}
		if changed || existing.Storage.Path != key || existing.DeletedAt != nil || !unchangedOnDisk(existing, info) {
			applyCapture(existing, cap)
			existing.Storage = ptr
			existing.SizeBytes = size
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

	// A HEIC also needs the display rendition: the viewer cannot open the
	// original in Chrome or Firefox (ADR 0025).
	sizes := thumb.Sizes
	if !IsWebSafe(key) {
		sizes = thumb.SizesWithDisplay
	}
	thumbRes, err := i.Thumb.Generate(keepKey, data, exifRes.Orientation, sizes)
	if err != nil {
		return false, fmt.Errorf("thumb: %w", err)
	}

	p := &db.Photo{
		Key:         keepKey,
		Kind:        "photo",
		Storage:     ptr,
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
			S2048: thumbRes.Paths[thumb.DisplaySize],
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

// read pulls the whole Original once; hash, EXIF, and thumbs share the bytes
// so network Sources are not downloaded twice.
func (i *Indexer) read(ctx context.Context, key string) ([]byte, error) {
	rc, err := i.Store.Get(ctx, key)
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(rc)
}

func (i *Indexer) storagePtr(info storage.ObjectInfo) db.StoragePtr {
	ptr := db.StoragePtr{Backend: i.Store.Backend(), Path: info.Key}
	if !info.ModTime.IsZero() {
		mt := info.ModTime.UTC()
		ptr.ModTime = &mt
	}
	return ptr
}

func unchangedOnDisk(p *db.Photo, info storage.ObjectInfo) bool {
	return p.Storage.ModTime != nil && !info.ModTime.IsZero() &&
		p.Storage.ModTime.Equal(info.ModTime) && p.SizeBytes == info.Size
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

func isMedia(key string) bool { return IsMedia(key) }

// IsMedia reports whether a key is a file this indexer would take.
//
// Exported so the folder picker can say how many photos a directory holds
// using the one list of extensions the indexer actually honours, rather than
// a second copy that drifts (ADR 0020).
//
// HEIC needs a libvips built with the HEIF loader, which the -tags vips
// indexer has and the pure Go one does not (ADR 0025). The list is the same
// in both builds deliberately: a build that accepted a file it could not
// decode would fail per photo instead of once, loudly, at startup.
func IsMedia(key string) bool {
	switch strings.ToLower(path.Ext(key)) {
	case ".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif":
		return true
	}
	return false
}

// expectedThumbs lists the renditions this photo should have on disk.
//
// HasAll treats an empty path as missing, so the display rendition is only
// expected where one is written. Asking for it unconditionally would make
// every JPEG look incomplete and regenerate its whole ladder on each scan.
func expectedThumbs(key string, t db.Thumbs) []string {
	rels := []string{t.S256, t.S512, t.S1024}
	if !IsWebSafe(key) {
		rels = append(rels, t.S2048)
	}
	return rels
}

// IsWebSafe reports whether a browser can display the original bytes.
//
// HEIC cannot be shown by Chrome or Firefox, so those photos need a
// JPEG rendition for the viewer to open; /api/original serves that instead of
// the original (ADR 0025). Safari would manage the original, but the library
// is not browser-specific.
func IsWebSafe(key string) bool {
	switch strings.ToLower(path.Ext(key)) {
	case ".heic", ".heif":
		return false
	}
	return true
}

// mediaMIME names the stored content type. Go's table has no HEIC entry, so
// without the override these rows would say application/octet-stream and the
// viewer would offer a download rather than an image.
func mediaMIME(key string) string {
	switch strings.ToLower(path.Ext(key)) {
	case ".heic":
		return "image/heic"
	case ".heif":
		return "image/heif"
	}
	if t := mime.TypeByExtension(strings.ToLower(filepath.Ext(key))); t != "" {
		return t
	}
	return "application/octet-stream"
}
