package index

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/memries/memries/internal/db"
	"github.com/memries/memries/internal/video"
)

// writeClip makes a small video with ffmpeg, so no personal file and no
// binary fixture is needed. The creation tags are set the way a phone sets
// them, offset included.
func writeClip(t *testing.T, path string, extra ...string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	args := []string{
		"-v", "error",
		"-f", "lavfi", "-i", "testsrc=size=160x120:rate=10:duration=2",
		"-pix_fmt", "yuv420p",
		"-metadata", "creation_time=2024-05-06T10:00:00.000000Z",
	}
	args = append(args, extra...)
	args = append(args, path)
	if b, err := exec.Command("ffmpeg", args...).CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg: %v: %s", err, b)
	}
}

func needFFmpeg(t *testing.T) {
	t.Helper()
	if err := video.Available(); err != nil {
		t.Skipf("%v", err)
	}
}

// The whole point: a clip lands in the catalog beside the photos, with a
// poster frame the timeline can show and a duration the grid can label
// (ADR 0029).
func TestIndexAVideo(t *testing.T) {
	needFFmpeg(t)
	root := t.TempDir()
	writeClip(t, filepath.Join(root, "clips", "holiday.mp4"))
	repo := &memPhotos{}
	idx := newTestIndexer(t, root, repo)

	if _, err := idx.Run(context.Background(), Options{Prefixes: []string{"clips"}}); err != nil {
		t.Fatal(err)
	}
	if len(repo.byKey) != 1 {
		t.Fatalf("photos = %d", len(repo.byKey))
	}
	for _, p := range repo.byKey {
		if p.Kind != db.KindVideo {
			t.Errorf("Kind = %q", p.Kind)
		}
		if p.DurationMS < 1800 || p.DurationMS > 2200 {
			t.Errorf("DurationMS = %d, want about 2000", p.DurationMS)
		}
		if p.MIME != "video/mp4" {
			t.Errorf("MIME = %q", p.MIME)
		}
		// The container's own time, not the file's.
		if p.TakenAtSource != SourceContainer {
			t.Errorf("TakenAtSource = %q", p.TakenAtSource)
		}
		if p.TakenAtLocal != "2024-05-06T10:00:00" {
			t.Errorf("TakenAtLocal = %q", p.TakenAtLocal)
		}
		// The poster goes through the ordinary ladder, so the timeline needs
		// to know nothing about video.
		if !idx.Thumb.HasAll(p.Thumbs.S256, p.Thumbs.S512, p.Thumbs.S1024) {
			t.Errorf("thumbs missing: %+v", p.Thumbs)
		}
		// A clip is never given the HEIC-style display rendition.
		if p.Thumbs.S2048 != "" {
			t.Errorf("S2048 = %q, want none", p.Thumbs.S2048)
		}
		if p.Dims.W != 160 || p.Dims.H != 120 {
			t.Errorf("dims = %dx%d", p.Dims.W, p.Dims.H)
		}
	}
}

// A second run must not re-probe or re-poster an unchanged clip: on the box
// that is the difference between a scan of seconds and one of minutes.
func TestRescanSkipsAnUnchangedVideo(t *testing.T) {
	needFFmpeg(t)
	root := t.TempDir()
	writeClip(t, filepath.Join(root, "clips", "holiday.mp4"))
	repo := &memPhotos{}
	idx := newTestIndexer(t, root, repo)
	ctx := context.Background()

	if _, err := idx.Run(ctx, Options{Prefixes: []string{"clips"}}); err != nil {
		t.Fatal(err)
	}
	res, err := idx.Run(ctx, Options{Prefixes: []string{"clips"}})
	if err != nil {
		t.Fatal(err)
	}
	if res.Skipped != 1 || res.Indexed != 0 {
		t.Fatalf("second run = %+v, want one skip", res)
	}
}

// Photos and videos share one library and one sort.
func TestIndexMixesVideoAndPhotos(t *testing.T) {
	needFFmpeg(t)
	root := t.TempDir()
	writeJPEG(t, filepath.Join(root, "mix", "a.jpg"), 200, 10, 10)
	writeClip(t, filepath.Join(root, "mix", "b.mp4"))
	repo := &memPhotos{}
	idx := newTestIndexer(t, root, repo)

	res, err := idx.Run(context.Background(), Options{Prefixes: []string{"mix"}})
	if err != nil {
		t.Fatal(err)
	}
	if res.Indexed != 2 || res.Failed != 0 {
		t.Fatalf("result = %+v", res)
	}
	kinds := map[string]int{}
	for _, p := range repo.byKey {
		kinds[p.Kind]++
	}
	if kinds[db.KindPhoto] != 1 || kinds[db.KindVideo] != 1 {
		t.Fatalf("kinds = %v", kinds)
	}
}

// A file that is named like a video but is not one must fail on its own
// rather than taking the run down.
func TestAVideoThatCannotBeReadFailsAlone(t *testing.T) {
	needFFmpeg(t)
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "mix"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "mix", "broken.mp4"), []byte("not a video"), 0o644); err != nil {
		t.Fatal(err)
	}
	writeJPEG(t, filepath.Join(root, "mix", "good.jpg"), 200, 10, 10)
	repo := &memPhotos{}
	idx := newTestIndexer(t, root, repo)

	res, err := idx.Run(context.Background(), Options{Prefixes: []string{"mix"}})
	if err != nil {
		t.Fatal(err)
	}
	if res.Failed != 1 || res.Indexed != 1 {
		t.Fatalf("result = %+v, want one failure beside one success", res)
	}
}
