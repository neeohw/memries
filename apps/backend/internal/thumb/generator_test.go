package thumb

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io/fs"
	"math"
	"math/rand"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// photoJPEG builds a w x h JPEG whose content compresses like a photograph:
// smooth gradients with sparse local detail. Uniform noise would be JPEG's
// worst case and would overstate decode cost in the benchmarks below.
func photoJPEG(tb testing.TB, w, h int) []byte {
	tb.Helper()
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, photoImage(w, h), &jpeg.Options{Quality: 90}); err != nil {
		tb.Fatal(err)
	}
	return buf.Bytes()
}

// photoImage is the same content unencoded, for tests that compare resampling
// rather than decoding.
func photoImage(w, h int) image.Image {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	rng := rand.New(rand.NewSource(1))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			n := 0
			if (x/37+y/53)%11 == 0 {
				n = rng.Intn(40)
			}
			img.Set(x, y, color.RGBA{
				R: uint8((x*255/w + n) & 0xff),
				G: uint8((y*255/h + n) & 0xff),
				B: uint8(((x+y)*255/(w+h) + n) & 0xff),
				A: 255,
			})
		}
	}
	return img
}

const testKey = "abcdef0123456789"

func newGen(tb testing.TB) (*Generator, string) {
	tb.Helper()
	root := tb.TempDir()
	g, err := NewGenerator(root)
	if err != nil {
		tb.Fatal(err)
	}
	return g, root
}

// thumbBounds decodes a written thumb and returns its pixel size.
func thumbBounds(t *testing.T, root, rel string) (int, int) {
	t.Helper()
	f, err := os.Open(filepath.Join(root, rel))
	if err != nil {
		t.Fatalf("open %s: %v", rel, err)
	}
	defer f.Close()
	img, format, err := image.Decode(f)
	if err != nil {
		t.Fatalf("decode %s: %v", rel, err)
	}
	if format != "jpeg" {
		t.Fatalf("%s: format %q, want jpeg", rel, format)
	}
	b := img.Bounds()
	return b.Dx(), b.Dy()
}

func TestGenerateWritesLadderAtShardedPaths(t *testing.T) {
	g, root := newGen(t)

	res, err := g.Generate(testKey, photoJPEG(t, 1600, 1200), 1)
	if err != nil {
		t.Fatal(err)
	}

	if res.Width != 1600 || res.Height != 1200 {
		t.Errorf("dims = %dx%d, want 1600x1200", res.Width, res.Height)
	}
	want := map[int]string{
		256:  filepath.Join("ab", testKey, "s.jpg"),
		512:  filepath.Join("ab", testKey, "m.jpg"),
		1024: filepath.Join("ab", testKey, "l.jpg"),
	}
	for size, rel := range want {
		if res.Paths[size] != rel {
			t.Errorf("Paths[%d] = %q, want %q", size, res.Paths[size], rel)
		}
	}
	if len(res.Paths) != len(want) {
		t.Errorf("wrote %d thumbs, want %d", len(res.Paths), len(want))
	}

	// 4:3 source: every rung keeps the aspect ratio and fits inside its bound.
	for size, wantDims := range map[int][2]int{
		1024: {1024, 768},
		512:  {512, 384},
		256:  {256, 192},
	} {
		w, h := thumbBounds(t, root, res.Paths[size])
		if w != wantDims[0] || h != wantDims[1] {
			t.Errorf("thumb %d = %dx%d, want %dx%d", size, w, h, wantDims[0], wantDims[1])
		}
	}
}

func TestGenerateReportsOrientedDimensions(t *testing.T) {
	g, root := newGen(t)

	// Orientation 6 is a quarter turn, so the stored frame is portrait even
	// though the JPEG's own raster is landscape.
	res, err := g.Generate(testKey, photoJPEG(t, 1600, 1200), 6)
	if err != nil {
		t.Fatal(err)
	}
	if res.Width != 1200 || res.Height != 1600 {
		t.Fatalf("dims = %dx%d, want 1200x1600", res.Width, res.Height)
	}
	if w, h := thumbBounds(t, root, res.Paths[1024]); w != 768 || h != 1024 {
		t.Errorf("1024 thumb = %dx%d, want 768x1024", w, h)
	}
}

func TestGenerateDoesNotUpscaleSmallOriginals(t *testing.T) {
	g, root := newGen(t)

	res, err := g.Generate(testKey, photoJPEG(t, 300, 200), 1)
	if err != nil {
		t.Fatal(err)
	}
	// The two largest bounds exceed the original, so both stay at 300x200.
	for _, size := range []int{512, 1024} {
		if w, h := thumbBounds(t, root, res.Paths[size]); w != 300 || h != 200 {
			t.Errorf("thumb %d = %dx%d, want 300x200 (no upscale)", size, w, h)
		}
	}
	// 300x200 fitted to 256 is 170.67 high. imaging truncates and libvips
	// rounds, so the rendered height differs by a pixel between backends.
	// Result.Width/Height, which is what reaches the catalog, is the
	// original's exact size in both and is asserted elsewhere.
	if w, h := thumbBounds(t, root, res.Paths[256]); w != 256 || h < 170 || h > 171 {
		t.Errorf("thumb 256 = %dx%d, want 256x170 or 256x171", w, h)
	}
}

func TestGenerateAcceptsPNG(t *testing.T) {
	g, root := newGen(t)
	src := image.NewRGBA(image.Rect(0, 0, 640, 480))
	for y := 0; y < 480; y++ {
		for x := 0; x < 640; x++ {
			src.Set(x, y, color.RGBA{R: uint8(x % 256), G: uint8(y % 256), B: 90, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, src); err != nil {
		t.Fatal(err)
	}
	res, err := g.Generate(testKey, buf.Bytes(), 1)
	if err != nil {
		t.Fatalf("png: %v", err)
	}
	if res.Width != 640 || res.Height != 480 {
		t.Errorf("png dims = %dx%d, want 640x480", res.Width, res.Height)
	}
	// Thumbs are always JPEG regardless of the source format.
	if w, h := thumbBounds(t, root, res.Paths[512]); w != 512 || h != 384 {
		t.Errorf("png 512 thumb = %dx%d, want 512x384", w, h)
	}
}

func TestGenerateIsIdempotent(t *testing.T) {
	g, root := newGen(t)
	data := photoJPEG(t, 800, 600)

	first, err := g.Generate(testKey, data, 1)
	if err != nil {
		t.Fatal(err)
	}
	second, err := g.Generate(testKey, data, 1)
	if err != nil {
		t.Fatalf("second pass: %v", err)
	}
	if first.Paths[1024] != second.Paths[1024] {
		t.Errorf("paths moved between runs: %q then %q", first.Paths[1024], second.Paths[1024])
	}
	if !g.HasAll(second.Paths[256], second.Paths[512], second.Paths[1024]) {
		t.Error("HasAll false after a successful regenerate")
	}
	assertNoTempFiles(t, root)
}

// Thumbs are written through a rename, so an interrupted index can never leave
// a truncated file that HasAll would accept. A leftover .tmp- file would mean
// the rename path was bypassed.
func assertNoTempFiles(t *testing.T, root string) {
	t.Helper()
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() && strings.HasPrefix(d.Name(), ".tmp-") {
			t.Errorf("temp file left behind: %s", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestGenerateRejectsBadInput(t *testing.T) {
	g, _ := newGen(t)
	data := photoJPEG(t, 64, 64)

	cases := []struct {
		name        string
		key         string
		data        []byte
		wantInError string
	}{
		// photoKey[:2] shards the cache path; a one-character key used to panic.
		{"key too short", "a", data, "too short"},
		{"empty key", "", data, "too short"},
		{"empty data", testKey, nil, "empty image data"},
		// Both backends reject undecodable bytes, but their wording differs,
		// so only the wrapper's own prefix is asserted here.
		{"not an image", testKey, []byte("this is not an image"), "render"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := g.Generate(tc.key, tc.data, 1)
			if err == nil {
				t.Fatal("want error, got nil")
			}
			if !strings.Contains(err.Error(), tc.wantInError) {
				t.Errorf("error %q does not mention %q", err, tc.wantInError)
			}
		})
	}
}

func TestOpenAndHasAll(t *testing.T) {
	g, _ := newGen(t)
	res, err := g.Generate(testKey, photoJPEG(t, 400, 300), 1)
	if err != nil {
		t.Fatal(err)
	}

	f, err := g.Open(res.Paths[256])
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	f.Close()

	if _, err := g.Open(""); err == nil {
		t.Error("Open(\"\") should fail")
	}
	if g.HasAll(res.Paths[256], "") {
		t.Error("HasAll should reject an empty path")
	}
	if g.HasAll(res.Paths[256], filepath.Join("zz", "missing", "l.jpg")) {
		t.Error("HasAll should reject a missing file")
	}
	if !g.HasAll(res.Paths[256], res.Paths[512], res.Paths[1024]) {
		t.Error("HasAll should accept the written set")
	}
}

// BenchmarkGenerateParallel is the one that matters for sizing the indexer:
// run it under GOMAXPROCS=1,2,4 to see both the throughput curve and, with
// /usr/bin/time, the peak RSS that GOMEMLIMIT has to sit above.
func BenchmarkGenerateParallel(b *testing.B) {
	g, _ := newGen(b)
	data := photoJPEG(b, 4000, 3000)
	b.SetParallelism(1)
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			if _, err := g.Generate(testKey, data, 1); err != nil {
				b.Fatal(err)
			}
		}
	})
}

func BenchmarkGenerate12MP(b *testing.B) {
	g, _ := newGen(b)
	data := photoJPEG(b, 4000, 3000)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := g.Generate(testKey, data, 1); err != nil {
			b.Fatal(err)
		}
	}
}

// quadrantImage paints four distinctly coloured quadrants. Every EXIF
// orientation permutes them differently, so the four corners of a thumb
// identify exactly which transform ran.
func quadrantImage(size int) image.Image {
	img := image.NewRGBA(image.Rect(0, 0, size, size))
	half := size / 2
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			var c color.RGBA
			switch {
			case x < half && y < half:
				c = color.RGBA{255, 0, 0, 255} // top-left: red
			case x >= half && y < half:
				c = color.RGBA{0, 255, 0, 255} // top-right: green
			case x < half && y >= half:
				c = color.RGBA{0, 0, 255, 255} // bottom-left: blue
			default:
				c = color.RGBA{255, 255, 255, 255} // bottom-right: white
			}
			img.Set(x, y, c)
		}
	}
	return img
}

// nearestName classifies a sampled pixel as one of the four quadrant colours.
func nearestName(c color.Color) string {
	r, g, b, _ := c.RGBA()
	type ref struct {
		name    string
		r, g, b float64
	}
	best, bestD := "", math.MaxFloat64
	for _, cand := range []ref{
		{"red", 255, 0, 0},
		{"green", 0, 255, 0},
		{"blue", 0, 0, 255},
		{"white", 255, 255, 255},
	} {
		d := math.Pow(float64(r>>8)-cand.r, 2) +
			math.Pow(float64(g>>8)-cand.g, 2) +
			math.Pow(float64(b>>8)-cand.b, 2)
		if d < bestD {
			best, bestD = cand.name, d
		}
	}
	return best
}

// Orientation is applied by this package, not by the decoder, so both
// rendering backends have to agree on all eight EXIF cases. Running this test
// under `-tags vips` is what proves the accelerated backend turns photos the
// same way up as the pure one; a wrong rotation direction here would silently
// mis-orient an entire library.
func TestGenerateAppliesEveryEXIFOrientation(t *testing.T) {
	var src bytes.Buffer
	if err := png.Encode(&src, quadrantImage(512)); err != nil {
		t.Fatal(err)
	}

	// corners[o] is the expected top-left, top-right, bottom-left and
	// bottom-right of the rendered thumb, for source quadrants
	// red/green/blue/white laid out clockwise from the top left.
	corners := map[int][4]string{
		1: {"red", "green", "blue", "white"}, // identity
		2: {"green", "red", "white", "blue"}, // mirror horizontally
		3: {"white", "blue", "green", "red"}, // rotate 180
		4: {"blue", "white", "red", "green"}, // mirror vertically
		5: {"red", "blue", "green", "white"}, // transpose
		6: {"blue", "red", "white", "green"}, // rotate 90 clockwise
		7: {"white", "green", "blue", "red"}, // transverse
		8: {"green", "white", "red", "blue"}, // rotate 90 counter-clockwise
	}

	for o := 1; o <= 8; o++ {
		t.Run(fmt.Sprintf("orientation_%d", o), func(t *testing.T) {
			g, root := newGen(t)
			res, err := g.Generate(testKey, src.Bytes(), o)
			if err != nil {
				t.Fatal(err)
			}
			f, err := os.Open(filepath.Join(root, res.Paths[256]))
			if err != nil {
				t.Fatal(err)
			}
			defer f.Close()
			img, _, err := image.Decode(f)
			if err != nil {
				t.Fatal(err)
			}
			b := img.Bounds()
			qx, qy := b.Dx()/4, b.Dy()/4
			got := [4]string{
				nearestName(img.At(b.Min.X+qx, b.Min.Y+qy)),
				nearestName(img.At(b.Min.X+3*qx, b.Min.Y+qy)),
				nearestName(img.At(b.Min.X+qx, b.Min.Y+3*qy)),
				nearestName(img.At(b.Min.X+3*qx, b.Min.Y+3*qy)),
			}
			if got != corners[o] {
				t.Errorf("orientation %d, backend %q:\n  got  TL=%s TR=%s BL=%s BR=%s\n  want TL=%s TR=%s BL=%s BR=%s",
					o, Backend, got[0], got[1], got[2], got[3],
					corners[o][0], corners[o][1], corners[o][2], corners[o][3])
			}
		})
	}
}
