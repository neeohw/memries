//go:build vips

package thumb

// Accelerated renderer. libvips decodes JPEG straight from the DCT
// coefficients at a reduced scale (libjpeg-turbo's scale_denom, the same
// mechanism behind epeg), which removes the decode cost that pure Go cannot
// touch. Built only for cmd/indexer, and only on a host that has libvips:
//
//	go build -tags vips ./cmd/indexer
//
// On Homebrew, libarchive is keg-only, so pkg-config needs:
//
//	PKG_CONFIG_PATH="$(brew --prefix libarchive)/lib/pkgconfig"

/*
#cgo pkg-config: vips
#include <stdlib.h>
#include <vips/vips.h>

// cgo cannot call variadic C functions, so every libvips call that takes
// options goes through a wrapper here.

static int mem_header(const void *buf, size_t len, int *w, int *h) {
	VipsImage *img = vips_image_new_from_buffer(buf, len, "", NULL);
	if (img == NULL) return -1;
	*w = vips_image_get_width(img);
	*h = vips_image_get_height(img);
	g_object_unref(img);
	return 0;
}

// thumb_from_buffer shrinks on load: libvips picks a DCT scale factor from the
// requested size, so the full frame is never decoded. VIPS_SIZE_DOWN matches
// imaging.Fit's refusal to upscale, and no_rotate keeps libvips from applying
// the file's own EXIF orientation, which this package applies itself so both
// backends agree.
static int thumb_from_buffer(const void *buf, size_t len, int size, VipsImage **out) {
	return vips_thumbnail_buffer((void *)buf, len, out, size,
		"height", size,
		"size", VIPS_SIZE_DOWN,
		"no_rotate", TRUE,
		NULL);
}

static int thumb_from_image(VipsImage *in, int size, VipsImage **out) {
	return vips_thumbnail_image(in, out, size,
		"height", size,
		"size", VIPS_SIZE_DOWN,
		NULL);
}

static int save_jpeg(VipsImage *in, void **buf, size_t *len, int q) {
	return vips_jpegsave_buffer(in, buf, len,
		"Q", q,
		"strip", TRUE,
		NULL);
}

static int do_rot(VipsImage *in, int angle, VipsImage **out) {
	return vips_rot(in, out, (VipsAngle)angle, NULL);
}

static int do_flip(VipsImage *in, int horizontal, VipsImage **out) {
	return vips_flip(in, out,
		horizontal ? VIPS_DIRECTION_HORIZONTAL : VIPS_DIRECTION_VERTICAL,
		NULL);
}

static int do_sharpen(VipsImage *in, VipsImage **out) {
	// Mild unsharp mask, standing in for imaging.Sharpen(img, 0.5).
	return vips_sharpen(in, out, "sigma", 0.5, NULL);
}

static int copy_to_memory(VipsImage *in, VipsImage **out) {
	*out = vips_image_copy_memory(in);
	return *out == NULL ? -1 : 0;
}
*/
import "C"

import (
	"errors"
	"fmt"
	"runtime"
	"sort"
	"sync"
	"unsafe"
)

const Backend = "vips"

var initOnce sync.Once

func vipsInit() {
	initOnce.Do(func() {
		name := C.CString("memries")
		defer C.free(unsafe.Pointer(name))
		if C.vips_init(name) != 0 {
			panic("vips_init failed: " + vipsError())
		}
		// The indexer already runs one goroutine per core. Letting libvips
		// start its own threadpool per call would oversubscribe a 4-core board
		// several times over, so parallelism stays at the worker level.
		C.vips_concurrency_set(1)
		// Nothing is ever rendered twice, so the operation cache is pure
		// resident memory on a 2GB machine.
		C.vips_cache_set_max(0)
		C.vips_cache_set_max_mem(0)
	})
}

func vipsError() string {
	msg := C.GoString(C.vips_error_buffer())
	C.vips_error_clear()
	return msg
}

func fail(op string) error {
	if msg := vipsError(); msg != "" {
		return fmt.Errorf("vips %s: %s", op, msg)
	}
	return fmt.Errorf("vips %s failed", op)
}

// vipsImage wraps a VipsImage so every exit path can drop its reference.
type vipsImage struct{ p *C.VipsImage }

func (i *vipsImage) free() {
	if i.p != nil {
		C.g_object_unref(C.gpointer(unsafe.Pointer(i.p)))
		i.p = nil
	}
}

func render(data []byte, orientation int, sizes []int, emit func(size int, jpg []byte) error) (int, int, error) {
	if len(data) == 0 {
		return 0, 0, errors.New("empty image data")
	}
	vipsInit()

	// HEIF carries its rotation twice: in the container's irot box and in the
	// EXIF orientation tag, saying the same thing. libheif applies irot while
	// decoding, so libvips hands over an image that is already upright — and
	// applying the EXIF tag on top of that turns every portrait photo on its
	// side. Measured on an iPhone HEIC: decoded 3024x4032, then rotated to
	// 4032x3024 (ADR 0026).
	//
	// no_rotate below only suppresses libvips' own EXIF autorotation, not
	// irot, so the fix is to stop applying the tag ourselves for HEIF. JPEG
	// is untouched: it has no irot, and both backends still rotate it here.
	if isHEIF(data) {
		orientation = 1
	}

	// data is Go memory handed to C for the duration of each call below. The
	// calls are synchronous and libvips copies what it keeps, but the slice
	// still has to outlive them, so it is pinned rather than trusted to the
	// optimiser.
	var pin runtime.Pinner
	pin.Pin(&data[0])
	defer pin.Unpin()
	buf := unsafe.Pointer(&data[0])
	blen := C.size_t(len(data))

	var cw, ch C.int
	if C.mem_header(buf, blen, &cw, &ch) != 0 {
		return 0, 0, fail("header")
	}
	w, h := int(cw), int(ch)
	if swapsAxes(orientation) {
		w, h = h, w
	}

	desc := append([]int(nil), sizes...)
	sort.Sort(sort.Reverse(sort.IntSlice(desc)))

	// Same rung policy as the pure backend, for the same reason: see pure.go.
	chained := max(w, h) >= 2*desc[0]

	var prev *vipsImage
	defer func() {
		if prev != nil {
			prev.free()
		}
	}()

	for _, size := range desc {
		base, err := rung(buf, blen, size, orientation, prev, chained)
		if err != nil {
			return 0, 0, err
		}

		var sharp vipsImage
		if C.do_sharpen(base.p, &sharp.p) != 0 {
			base.free()
			return 0, 0, fail("sharpen")
		}
		jpg, saveErr := saveJPEG(&sharp)
		sharp.free()
		if saveErr != nil {
			base.free()
			return 0, 0, saveErr
		}
		if err := emit(size, jpg); err != nil {
			base.free()
			return 0, 0, err
		}

		if prev != nil {
			prev.free()
			prev = nil
		}
		if chained {
			prev = base
		} else {
			base.free()
		}
	}
	return w, h, nil
}

// rung renders one step of the ladder as an upright, in-memory image. It comes
// from the rung above when chaining, and otherwise straight from the file,
// where shrink-on-load does its work.
func rung(buf unsafe.Pointer, blen C.size_t, size, orientation int, prev *vipsImage, chained bool) (*vipsImage, error) {
	var raw vipsImage
	if prev != nil && chained {
		if C.thumb_from_image(prev.p, C.int(size), &raw.p) != 0 {
			return nil, fail("thumbnail_image")
		}
		defer raw.free()
		// Rungs below the first are already upright.
		var mem vipsImage
		if C.copy_to_memory(raw.p, &mem.p) != 0 {
			return nil, fail("copy_memory")
		}
		return &mem, nil
	}
	if C.thumb_from_buffer(buf, blen, C.int(size), &raw.p) != 0 {
		return nil, fail("thumbnail_buffer")
	}
	defer raw.free()
	return upright(&raw, orientation)
}

// upright materialises a thumbnail and applies the file's EXIF orientation.
//
// The copy has to happen before any rotation. libvips' JPEG loader is a
// sequential-access source, and rotating one forces a random read that fails
// the whole pipeline with "out of order read at line N". The thumbnail is at
// most 1024px by the time it gets here, so materialising it is cheap.
func upright(raw *vipsImage, orientation int) (*vipsImage, error) {
	var flat vipsImage
	if C.copy_to_memory(raw.p, &flat.p) != 0 {
		return nil, fail("copy_memory")
	}
	rotated, err := orientTransform(&flat, orientation)
	if err != nil {
		flat.free()
		return nil, err
	}
	if rotated == nil {
		return &flat, nil // orientation 1, or absent: already upright
	}
	defer flat.free()
	defer rotated.free()
	var out vipsImage
	if C.copy_to_memory(rotated.p, &out.p) != 0 {
		return nil, fail("copy_memory")
	}
	return &out, nil
}

func saveJPEG(img *vipsImage) ([]byte, error) {
	var out unsafe.Pointer
	var olen C.size_t
	if C.save_jpeg(img.p, &out, &olen, C.int(jpegQuality)) != 0 {
		return nil, fail("jpegsave")
	}
	defer C.g_free(C.gpointer(out))
	return C.GoBytes(out, C.int(olen)), nil
}

// swapsAxes reports whether an EXIF orientation exchanges width and height.
func swapsAxes(o int) bool { return o >= 5 && o <= 8 }

// orientTransform mirrors pure.go's imaging-based transform case for case, so
// a Photo indexed by either backend lands the same way up. It returns nil when
// the image is already upright, so the caller skips a pointless copy.
func orientTransform(in *vipsImage, o int) (*vipsImage, error) {
	flip := func(src *vipsImage, horizontal bool) (*vipsImage, error) {
		h := C.int(0)
		if horizontal {
			h = 1
		}
		var out vipsImage
		if C.do_flip(src.p, h, &out.p) != 0 {
			return nil, fail("flip")
		}
		return &out, nil
	}
	rot := func(angle C.int) (*vipsImage, error) {
		var out vipsImage
		if C.do_rot(in.p, angle, &out.p) != 0 {
			return nil, fail("rot")
		}
		return &out, nil
	}

	switch o {
	case 2:
		return flip(in, true)
	case 3:
		return rot(C.VIPS_ANGLE_D180)
	case 4:
		return flip(in, false)
	case 5, 7:
		// Transpose and transverse: a quarter turn, then a mirror.
		angle := C.int(C.VIPS_ANGLE_D90)
		if o == 7 {
			angle = C.VIPS_ANGLE_D270
		}
		rotated, err := rot(angle)
		if err != nil {
			return nil, err
		}
		defer rotated.free()
		return flip(rotated, true)
	case 6:
		return rot(C.VIPS_ANGLE_D90)
	case 8:
		return rot(C.VIPS_ANGLE_D270)
	}
	return nil, nil
}
