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
	"github.com/memries/memries/internal/video"
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

	facts, err := i.gather(ctx, info)
	if err != nil {
		return false, err
	}
	return i.record(ctx, info, force, byPath, facts)
}

// facts is what one file says about itself, before the catalog has a say.
//
// Both kinds of media fill the same struct, so identity, dedup, the skip path
// and the row write are one piece of code: what differs between a photo and a
// clip is how these are read, not what is done with them (ADR 0029).
type facts struct {
	hash        string
	size        int64
	capture     Capture
	mime        string
	kind        string
	durationMS  int64
	orientation int
	exif        db.EXIF
	// thumbSource is the image the ladder is built from: the original bytes
	// for a photo, the poster frame for a clip. Nil when none could be made,
	// which is a row without thumbs rather than a failure.
	thumbSource []byte
	// sizes is the ladder to write.
	sizes []int
}

func (i *Indexer) gather(ctx context.Context, info storage.ObjectInfo) (facts, error) {
	if video.IsVideo(info.Key) {
		return i.gatherVideo(ctx, info)
	}
	return i.gatherPhoto(ctx, info)
}

func (i *Indexer) gatherPhoto(ctx context.Context, info storage.ObjectInfo) (facts, error) {
	data, err := i.read(ctx, info.Key)
	if err != nil {
		return facts{}, err
	}
	sum := sha256.Sum256(data)

	var exifRes exif.Result
	// ParseAny picks the reader by sniffing the bytes: a HEIC keeps its EXIF
	// in an item that can sit past the JPEG window, so it needs the whole
	// buffer (ADR 0026).
	if r, err := exif.ParseAny(data); err == nil {
		exifRes = r
	}
	// A HEIC also needs the display rendition: the viewer cannot open the
	// original in Chrome or Firefox (ADR 0025).
	sizes := thumb.Sizes
	if !IsWebSafe(info.Key) {
		sizes = thumb.SizesWithDisplay
	}
	return facts{
		hash:        hex.EncodeToString(sum[:]),
		size:        int64(len(data)),
		capture:     ResolveCaptureTime(exifRes, info),
		mime:        mediaMIME(info.Key),
		kind:        db.KindPhoto,
		orientation: exifRes.Orientation,
		exif:        exifRes.EXIF,
		thumbSource: data,
		sizes:       sizes,
	}, nil
}

// gatherVideo never holds the clip in memory. A phone shoots hundreds of
// megabytes a minute — one of this library's is 528MB — and four index
// workers reading those into RAM would take a 1.9GB box out (ADR 0029). The
// hash is streamed, and ffmpeg is handed the path.
func (i *Indexer) gatherVideo(ctx context.Context, info storage.ObjectInfo) (facts, error) {
	hash, size, err := i.hashStream(ctx, info.Key)
	if err != nil {
		return facts{}, err
	}
	f := facts{
		hash:        hash,
		size:        size,
		capture:     ResolveCaptureTime(exif.Result{}, info),
		mime:        mediaMIME(info.Key),
		kind:        db.KindVideo,
		orientation: 1,
		sizes:       thumb.Sizes,
	}

	path, ok := i.localPath(ctx, info.Key)
	if !ok {
		// A Source with no path on this machine — WebDAV today. The clip is
		// still worth a row: it plays, it sorts by file time, and it simply
		// has no poster until there is a reason to download one.
		i.Log.Warn("video indexed without a poster frame", "key", info.Key,
			"why", "this source has no local path")
		return f, nil
	}

	probe, err := video.Probe(ctx, path)
	if err != nil {
		return facts{}, fmt.Errorf("probe: %w", err)
	}
	f.capture = ResolveVideoCaptureTime(probe, info)
	f.durationMS = probe.DurationMS
	f.exif.Camera = probe.Camera

	poster, err := video.Poster(ctx, path, probe.DurationMS)
	if err != nil {
		return facts{}, fmt.Errorf("poster: %w", err)
	}
	f.thumbSource = poster
	return f, nil
}

// localPath asks the store for a path ffmpeg can open.
func (i *Indexer) localPath(ctx context.Context, key string) (string, bool) {
	pather, ok := i.Store.(interface {
		LocalPath(context.Context, string) (string, bool)
	})
	if !ok {
		return "", false
	}
	return pather.LocalPath(ctx, key)
}

// hashStream reads the file once without holding it, which is what makes a
// half-gigabyte clip indexable on the box.
func (i *Indexer) hashStream(ctx context.Context, key string) (string, int64, error) {
	rc, err := i.Store.Get(ctx, key)
	if err != nil {
		return "", 0, err
	}
	defer rc.Close()
	h := sha256.New()
	n, err := io.Copy(h, rc)
	if err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(h.Sum(nil)), n, nil
}

// record resolves identity against the catalog and writes the row.
func (i *Indexer) record(ctx context.Context, info storage.ObjectInfo, force bool, byPath *db.Photo, f facts) (bool, error) {
	key := info.Key
	byHash, err := lookupPhoto(i.DB.GetPhotoByHash(ctx, f.hash))
	if err != nil {
		return false, err
	}
	// One library, so the content hash is the key outright: there is no other
	// owner's Photo it could collide with (ADR 0020).
	keepKey, action := ResolveIdentity(key, f.hash, byPath, byHash)

	existing := byPath
	if existing == nil {
		existing = byHash
	}
	ptr := i.storagePtr(info)

	if !force && existing != nil && existing.Hash == f.hash && i.Thumb.HasAll(expectedThumbs(key, existing.Thumbs)...) {
		changed := CaptureChanged(*existing, f.capture)
		if action == IdentityRelocate {
			if err := i.touchRelocatedPath(ctx, existing, key, f.hash); err != nil {
				return false, err
			}
		}
		if changed || existing.Storage.Path != key || existing.DeletedAt != nil || !unchangedOnDisk(existing, info) {
			applyCapture(existing, f.capture)
			existing.Storage = ptr
			existing.SizeBytes = f.size
			existing.Kind = f.kind
			existing.DurationMS = f.durationMS
			existing.DeletedAt = nil
			if err := i.DB.UpdateIndexedPhoto(ctx, existing); err != nil {
				return false, err
			}
			i.Log.Info("refresh capture", "key", key, "id", keepKey, "taken_at_local", f.capture.TakenAtLocal)
			return false, nil
		}
		i.Log.Info("skip existing", "key", key, "hash", f.hash[:12])
		return true, nil
	}

	p := &db.Photo{
		Key:         keepKey,
		Kind:        f.kind,
		DurationMS:  f.durationMS,
		Storage:     ptr,
		Hash:        f.hash,
		SizeBytes:   f.size,
		MIME:        f.mime,
		Orientation: f.orientation,
		EXIF:        f.exif,
		ImportedAt:  time.Now().UTC(),
	}
	if len(f.thumbSource) > 0 {
		thumbRes, err := i.Thumb.Generate(keepKey, f.thumbSource, f.orientation, f.sizes)
		if err != nil {
			return false, fmt.Errorf("thumb: %w", err)
		}
		p.Dims = db.Dims{W: thumbRes.Width, H: thumbRes.Height}
		p.Thumbs = db.Thumbs{
			S256:  thumbRes.Paths[256],
			S512:  thumbRes.Paths[512],
			S1024: thumbRes.Paths[1024],
			S2048: thumbRes.Paths[thumb.DisplaySize],
		}
	}
	if existing != nil {
		p.ImportedAt = existing.ImportedAt
		p.Favorite = existing.Favorite
	}
	applyCapture(p, f.capture)
	if existing != nil {
		if err := i.DB.UpdateIndexedPhoto(ctx, p); err != nil {
			return false, fmt.Errorf("update: %w", err)
		}
	} else if err := i.DB.UpsertPhoto(ctx, p); err != nil {
		return false, fmt.Errorf("upsert: %w", err)
	}
	i.Log.Info("indexed", "key", key, "id", keepKey, "hash", f.hash[:12], "kind", f.kind,
		"taken_at_local", f.capture.TakenAtLocal, "source", f.capture.Source)
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
	// Video needs ffmpeg, which is the indexer's dependency the way libvips
	// is, and for the same reason: no pure-Go decoder exists (ADR 0029).
	return video.IsVideo(key)
}

// expectedThumbs lists the renditions this photo should have on disk.
//
// HasAll treats an empty path as missing, so the display rendition is only
// expected where one is written. Asking for it unconditionally would make
// every JPEG look incomplete and regenerate its whole ladder on each scan.
func expectedThumbs(key string, t db.Thumbs) []string {
	// A video whose poster frame could not be made — a Source with no local
	// path, or an unreadable clip — is still a row worth keeping. Expecting
	// thumbs it never had would make every scan try again and call the file
	// changed, so what it has is what is expected of it.
	if video.IsVideo(key) {
		if t.S256 == "" {
			return nil
		}
		return []string{t.S256, t.S512, t.S1024}
	}
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
	// A video is never given a JPEG stand-in: the viewer plays the original,
	// and the display rendition exists for stills a browser cannot show.
	return !video.IsVideo(key)
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
	if video.IsVideo(key) {
		// Go's table calls .mov video/quicktime but has no .m4v, and the
		// player is handed this verbatim.
		return video.MIME(key)
	}
	if t := mime.TypeByExtension(strings.ToLower(filepath.Ext(key))); t != "" {
		return t
	}
	return "application/octet-stream"
}
