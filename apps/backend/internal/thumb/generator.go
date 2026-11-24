// Package thumb writes the 256 / 512 / 1024 thumbnail set for a Photo.
//
// The rendering backend is chosen at build time. The default is pure Go, so
// the binary cross-compiles with CGO_ENABLED=0. Building with -tags vips swaps
// in libvips, which decodes JPEG at a reduced DCT scale and is several times
// faster on low-power ARM. Only cmd/indexer needs the accelerated build:
// Generate is called from the indexer, never from a request handler.
package thumb

import (
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// Sizes is the thumb ladder, ascending. Each entry becomes one JPEG per Photo.
var Sizes = []int{256, 512, 1024}

// DisplaySize is the rendition the viewer opens when a browser cannot show
// the original bytes — a HEIC, today (ADR 0025). It is not part of Sizes
// because most photos are JPEG and do not need it.
const DisplaySize = 2048

// SizesWithDisplay is the ladder for an original the browser cannot display.
// render works from the largest down, deriving each size from the previous
// one, so the extra rung costs one JPEG encode and makes the 1024 cheaper
// than it would have been from the full frame.
var SizesWithDisplay = []int{256, 512, 1024, DisplaySize}

const jpegQuality = 88

// Generator writes the thumb set under one fixed directory, named by
// library.cache in the configuration file (ADR 0028). Thumb paths on a Photo
// are relative to it, so moving the cache is a matter of moving the files and
// editing one line — nothing in the catalog refers to the root.
type Generator struct {
	cacheRoot string
}

func NewGenerator(cacheRoot string) (*Generator, error) {
	if err := os.MkdirAll(cacheRoot, 0o755); err != nil {
		return nil, err
	}
	return &Generator{cacheRoot: cacheRoot}, nil
}

// Root reports the directory thumbs are read from and written to.
func (g *Generator) Root() string { return g.cacheRoot }

func (g *Generator) path(rel string) string {
	return filepath.Join(g.cacheRoot, rel)
}

type Result struct {
	Width  int
	Height int
	Paths  map[int]string
}

// Generate renders and writes the thumb set for photoKey.
//
// data is the original file's bytes. The indexer already holds them to compute
// the sha256, so taking the slice rather than an io.Reader keeps one copy of a
// multi-megabyte frame in memory instead of two.
// sizes is the ladder to write; pass Sizes, or SizesWithDisplay for an
// original a browser cannot show.
func (g *Generator) Generate(photoKey string, data []byte, orientation int, sizes []int) (Result, error) {
	if len(photoKey) < 2 {
		return Result{}, fmt.Errorf("photo key %q too short to shard", photoKey)
	}
	if len(data) == 0 {
		return Result{}, errors.New("empty image data")
	}
	if len(sizes) == 0 {
		sizes = Sizes
	}
	res := Result{Paths: make(map[int]string, len(sizes))}
	w, h, err := render(data, orientation, sizes, func(size int, jpg []byte) error {
		rel := filepath.Join(photoKey[:2], photoKey, sizeName(size))
		if err := g.write(rel, jpg); err != nil {
			return err
		}
		res.Paths[size] = rel
		return nil
	})
	if err != nil {
		return Result{}, fmt.Errorf("render %s: %w", Backend, err)
	}
	res.Width, res.Height = w, h
	return res, nil
}

// write puts the thumb at rel atomically. A half-written file would still
// satisfy HasAll, so a power cut mid-index would leave a Photo permanently
// holding a truncated thumb; the rename makes the file either absent or whole.
func (g *Generator) write(rel string, jpg []byte) error {
	abs := g.path(rel)
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(abs), ".tmp-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(jpg); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), abs)
}

func (g *Generator) Open(rel string) (*os.File, error) {
	if rel == "" {
		return nil, errors.New("empty thumb path")
	}
	return os.Open(g.path(rel))
}

func (g *Generator) HasAll(rels ...string) bool {
	for _, rel := range rels {
		if rel == "" {
			return false
		}
		if _, err := os.Stat(g.path(rel)); err != nil {
			return false
		}
	}
	return true
}

func sizeName(s int) string {
	switch s {
	case 256:
		return "s.jpg"
	case 512:
		return "m.jpg"
	case 1024:
		return "l.jpg"
	case DisplaySize:
		// Named rather than left to the fallback below, which would give any
		// future rung the same filename and have the two overwrite each other.
		return "d.jpg"
	}
	return "x.jpg"
}

// isHEIF reports whether data is a HEIF container, by its ftyp brand.
//
// Duplicated from internal/exif rather than imported: that package is about
// reading metadata, and a renderer reaching into it for a four-byte sniff
// would tie the two together for no gain.
func isHEIF(data []byte) bool {
	if len(data) < 12 || string(data[4:8]) != "ftyp" {
		return false
	}
	size := int(binary.BigEndian.Uint32(data[:4]))
	if size < 12 || size > len(data) {
		size = len(data)
	}
	for off := 8; off+4 <= size; off += 4 {
		switch string(data[off : off+4]) {
		case "heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1", "avif":
			return true
		}
		if off == 8 {
			off += 4 // skip the minor version
		}
	}
	return false
}
