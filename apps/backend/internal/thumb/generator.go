// Package thumb writes the 256 / 512 / 1024 thumbnail set for a Photo.
//
// The rendering backend is chosen at build time. The default is pure Go, so
// the binary cross-compiles with CGO_ENABLED=0. Building with -tags vips swaps
// in libvips, which decodes JPEG at a reduced DCT scale and is several times
// faster on low-power ARM. Only cmd/indexer needs the accelerated build:
// Generate is called from the indexer, never from a request handler.
package thumb

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// Sizes is the thumb ladder, ascending. Each entry becomes one JPEG per Photo.
var Sizes = []int{256, 512, 1024}

const jpegQuality = 88

type Generator struct {
	cacheRoot string
}

func NewGenerator(cacheRoot string) (*Generator, error) {
	if err := os.MkdirAll(cacheRoot, 0o755); err != nil {
		return nil, err
	}
	return &Generator{cacheRoot: cacheRoot}, nil
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
func (g *Generator) Generate(photoKey string, data []byte, orientation int) (Result, error) {
	if len(photoKey) < 2 {
		return Result{}, fmt.Errorf("photo key %q too short to shard", photoKey)
	}
	if len(data) == 0 {
		return Result{}, errors.New("empty image data")
	}
	res := Result{Paths: make(map[int]string, len(Sizes))}
	w, h, err := render(data, orientation, Sizes, func(size int, jpg []byte) error {
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
	abs := filepath.Join(g.cacheRoot, rel)
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
	return os.Open(filepath.Join(g.cacheRoot, rel))
}

func (g *Generator) HasAll(rels ...string) bool {
	for _, rel := range rels {
		if rel == "" {
			return false
		}
		if _, err := os.Stat(filepath.Join(g.cacheRoot, rel)); err != nil {
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
	}
	return "x.jpg"
}
