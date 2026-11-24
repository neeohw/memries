package video

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// The Apple tag is the one with the offset. creation_time is normalised to
// UTC, so trusting it alone files an evening clip earlier in the day — the
// mistake ADR 0026 fixed for stills.
func TestParseProbePrefersTheCreationDateWithAnOffset(t *testing.T) {
	info, err := parseProbe([]byte(`{
      "streams": [
        {"codec_type":"audio","codec_name":"aac"},
        {"codec_type":"video","codec_name":"hevc","width":1920,"height":1080,
         "duration":"2.533333",
         "side_data_list":[{"side_data_type":"Display Matrix","rotation":-90}]}
      ],
      "format": {"duration":"2.533333","tags":{
        "creation_time":"2026-06-18T17:09:27.000000Z",
        "com.apple.quicktime.creationdate":"2026-06-18T19:09:27+0200",
        "com.apple.quicktime.make":"Apple",
        "com.apple.quicktime.model":"iPhone XS"}}
    }`))
	if err != nil {
		t.Fatal(err)
	}
	if info.TakenAtLocal != "2026-06-18T19:09:27" {
		t.Errorf("TakenAtLocal = %q", info.TakenAtLocal)
	}
	if info.TZOffset != 7200 {
		t.Errorf("TZOffset = %d, want 7200", info.TZOffset)
	}
	if got := info.TakenAt.Format("2006-01-02T15:04:05Z"); got != "2026-06-18T17:09:27Z" {
		t.Errorf("TakenAt = %s", got)
	}
	if info.Codec != "hevc" || info.Width != 1920 || info.Height != 1080 {
		t.Errorf("stream = %+v", info)
	}
	if info.DurationMS != 2533 {
		t.Errorf("DurationMS = %d", info.DurationMS)
	}
	// -90 from ffprobe is a quarter turn; the catalog stores it positive.
	if info.Rotation != 270 {
		t.Errorf("Rotation = %d, want 270", info.Rotation)
	}
	if info.Camera != "Apple iPhone XS" {
		t.Errorf("Camera = %q", info.Camera)
	}
}

// A camera that is not Apple writes only creation_time, and a clip with no
// offset is still better placed at its UTC instant than at the file's mtime.
func TestParseProbeFallsBackToCreationTime(t *testing.T) {
	info, err := parseProbe([]byte(`{
      "streams":[{"codec_type":"video","codec_name":"h264","width":1280,"height":720}],
      "format":{"duration":"10.0","tags":{"creation_time":"2024-01-02T03:04:05.000000Z"}}
    }`))
	if err != nil {
		t.Fatal(err)
	}
	if info.TakenAtLocal != "2024-01-02T03:04:05" || info.TZOffset != 0 {
		t.Errorf("info = %+v", info)
	}
	if info.DurationMS != 10000 {
		t.Errorf("DurationMS = %d", info.DurationMS)
	}
}

// A file with no video stream is not a video, whatever it is named.
func TestParseProbeRejectsSomethingWithNoVideoStream(t *testing.T) {
	if _, err := parseProbe([]byte(`{"streams":[{"codec_type":"audio"}],"format":{}}`)); err == nil {
		t.Error("want an error")
	}
	if _, err := parseProbe([]byte(`not json`)); err == nil {
		t.Error("want an error for garbage")
	}
}

// Durations arrive as strings and a container may not say at all.
func TestParseProbeSurvivesAMissingDuration(t *testing.T) {
	info, err := parseProbe([]byte(`{"streams":[{"codec_type":"video","width":4,"height":4}],"format":{}}`))
	if err != nil {
		t.Fatal(err)
	}
	if info.DurationMS != 0 {
		t.Errorf("DurationMS = %d, want 0", info.DurationMS)
	}
}

func TestIsVideoAndMIME(t *testing.T) {
	for _, name := range []string{"a.mov", "A.MOV", "b.mp4", "c.m4v", "d.webm"} {
		if !IsVideo(name) {
			t.Errorf("%s should be a video", name)
		}
	}
	for _, name := range []string{"a.jpg", "b.heic", "c.txt", "d.mkv", "noext"} {
		if IsVideo(name) {
			t.Errorf("%s should not be a video", name)
		}
	}
	if MIME("a.MOV") != "video/quicktime" || MIME("b.mp4") != "video/mp4" || MIME("c.webm") != "video/webm" {
		t.Error("wrong MIME")
	}
}

// ---- the tools themselves ----

func needFFmpeg(t *testing.T) {
	t.Helper()
	if err := Available(); err != nil {
		t.Skipf("%v", err)
	}
}

// sample writes a tiny clip with ffmpeg itself, so the test needs no fixture
// in the repository and no personal video.
func sample(t *testing.T, args ...string) string {
	t.Helper()
	out := filepath.Join(t.TempDir(), "clip.mp4")
	base := []string{
		"-v", "error",
		"-f", "lavfi", "-i", "testsrc=size=160x120:rate=10:duration=2",
		"-pix_fmt", "yuv420p",
	}
	cmd := exec.Command("ffmpeg", append(append(base, args...), out)...)
	if b, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("make sample: %v: %s", err, b)
	}
	return out
}

func TestProbeReadsARealFile(t *testing.T) {
	needFFmpeg(t)
	info, err := Probe(context.Background(), sample(t))
	if err != nil {
		t.Fatal(err)
	}
	if info.Width != 160 || info.Height != 120 {
		t.Errorf("size = %dx%d", info.Width, info.Height)
	}
	if info.DurationMS < 1800 || info.DurationMS > 2200 {
		t.Errorf("DurationMS = %d, want about 2000", info.DurationMS)
	}
}

func TestProbeReportsAFileItCannotRead(t *testing.T) {
	needFFmpeg(t)
	bad := filepath.Join(t.TempDir(), "notavideo.mp4")
	if err := os.WriteFile(bad, []byte("this is not a video"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Probe(context.Background(), bad); err == nil {
		t.Error("want an error")
	}
	if _, err := Probe(context.Background(), filepath.Join(t.TempDir(), "absent.mp4")); err == nil {
		t.Error("want an error for a missing file")
	}
}

// The poster is a JPEG so it can go straight into the existing thumbnail
// ladder, which is what keeps video out of the timeline's vocabulary.
func TestPosterReturnsAJPEGFrame(t *testing.T) {
	needFFmpeg(t)
	jpg, err := Poster(context.Background(), sample(t), 2000)
	if err != nil {
		t.Fatal(err)
	}
	if len(jpg) < 3 || jpg[0] != 0xFF || jpg[1] != 0xD8 || jpg[2] != 0xFF {
		t.Fatalf("not a JPEG: % x", jpg[:min(8, len(jpg))])
	}
}

// A clip shorter than the seek point must still yield a frame rather than
// seeking past its own end.
func TestPosterHandlesAClipShorterThanTheSeekPoint(t *testing.T) {
	needFFmpeg(t)
	short := filepath.Join(t.TempDir(), "short.mp4")
	cmd := exec.Command("ffmpeg", "-v", "error",
		"-f", "lavfi", "-i", "testsrc=size=64x64:rate=10:duration=0.4",
		"-pix_fmt", "yuv420p", short)
	if b, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("make sample: %v: %s", err, b)
	}
	jpg, err := Poster(context.Background(), short, 400)
	if err != nil {
		t.Fatal(err)
	}
	if len(jpg) == 0 {
		t.Error("no frame")
	}
}

func TestPosterReportsAFileItCannotRead(t *testing.T) {
	needFFmpeg(t)
	if _, err := Poster(context.Background(), filepath.Join(t.TempDir(), "absent.mp4"), 0); err == nil {
		t.Error("want an error")
	}
}
