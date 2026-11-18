//go:build !vips

package thumb

import (
	"bytes"
	"image"
	"image/jpeg"
	"sort"

	"github.com/disintegration/imaging"

	_ "golang.org/x/image/webp"
	_ "image/gif"
	_ "image/png"
)

// Backend names the compiled-in renderer. The indexer logs it so a -tags vips
// build can be told apart from this one at runtime.
const Backend = "pure"

// render decodes data once, then writes one JPEG per size through emit,
// largest first. It returns the oriented dimensions of the original.
//
// Each thumb after the largest is derived from the previous thumb rather than
// from the full frame. The ladder halves at every step, so quality holds, and
// the full-resolution image is resampled exactly once instead of once per
// size. Measured on a 4000x3000 frame that is 76ms -> 35ms of resampling.
//
// Go's image/jpeg has no scaled-decode entry point, so decoding still costs
// full resolution (~82ms for the same frame). That is the half of the work
// this backend cannot remove; the vips build is what removes it.
func render(data []byte, orientation int, sizes []int, emit func(size int, jpg []byte) error) (int, int, error) {
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return 0, 0, err
	}
	img = applyOrientation(img, orientation)
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()

	desc := append([]int(nil), sizes...)
	sort.Sort(sort.Reverse(sort.IntSlice(desc)))

	// Chain the ladder only when the top rung is at most half the original.
	// A 12MP phone frame always qualifies, and that is where the saving lives:
	// the full frame is resampled once instead of once per rung.
	//
	// When the original is only slightly larger than the top rung, a near-unity
	// first step would apply the Lanczos kernel twice and drift on fine detail
	// while saving almost nothing. Such frames are small by definition, so they
	// resample every rung straight from the original instead. Measured on a
	// hard-edged synthetic pattern, chaining a 1600x1200 source drifted up to
	// 4/255 from a direct resize; chaining a 4000x3000 one drifts under 0.4.
	chained := max(w, h) >= 2*desc[0]

	src := img
	// Hold exactly one reference to the full frame, so reassigning src below
	// makes it collectable. On a 12MP photo imaging's NRGBA copy is ~48MB, and
	// the indexer runs several of these at once.
	img = nil

	for _, size := range desc {
		fitted := imaging.Fit(src, size, size, imaging.Lanczos)
		if chained {
			src = fitted
		}
		jpg, err := encodeJPEG(imaging.Sharpen(fitted, 0.5))
		if err != nil {
			return 0, 0, err
		}
		if err := emit(size, jpg); err != nil {
			return 0, 0, err
		}
	}
	return w, h, nil
}

func encodeJPEG(img image.Image) ([]byte, error) {
	var buf bytes.Buffer
	buf.Grow(128 << 10)
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: jpegQuality}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func applyOrientation(img image.Image, o int) image.Image {
	switch o {
	case 2:
		return imaging.FlipH(img)
	case 3:
		return imaging.Rotate180(img)
	case 4:
		return imaging.FlipV(img)
	case 5:
		return imaging.Transpose(img)
	case 6:
		return imaging.Rotate270(img)
	case 7:
		return imaging.Transverse(img)
	case 8:
		return imaging.Rotate90(img)
	}
	return img
}
