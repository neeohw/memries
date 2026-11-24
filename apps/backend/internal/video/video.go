// Package video reads what the catalog needs from a video file, and grabs the
// frame the timeline shows in its place.
//
// Both are done by running ffmpeg, which is a dependency of the indexer the
// way libvips is (ADR 0029). Nothing here decodes anything in Go: there is no
// usable pure-Go H.264 or HEVC decoder, and a phone library is mostly HEVC.
package video

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"path"
	"strconv"
	"strings"
	"time"
)

// ErrNoFFmpeg says the tools are missing, so a caller can report the one
// thing that fixes it rather than a failure per file.
var ErrNoFFmpeg = errors.New("ffmpeg and ffprobe are required to index video: apt install ffmpeg")

// probeTimeout bounds one ffprobe. It reads headers, not the whole file, so
// this is generous; a truncated or lying file is what it protects against.
const probeTimeout = 30 * time.Second

// posterTimeout bounds one frame grab. Seeking into a long clip on a slow
// disk is the expensive case.
const posterTimeout = 2 * time.Minute

// posterAt is how far in the poster frame is taken from. The first frame of a
// phone video is often the lens still adjusting, or black; a second in, the
// shot is what the person pointed the camera at. Clips shorter than this use
// their midpoint instead.
const posterAt = 1.0

// Info is what a video contributes to the catalog.
type Info struct {
	Width, Height int
	// DurationMS is the container's duration, 0 when it does not say.
	DurationMS int64
	Codec      string
	// Rotation is the display matrix in degrees, already applied by ffmpeg
	// when it writes the poster, and by browsers when they play the file.
	Rotation int
	// TakenAtLocal is the wall clock where it was shot ("2006-01-02T15:04:05"),
	// TZOffset its UTC offset in seconds, TakenAt the instant.
	TakenAtLocal string
	TZOffset     int
	TakenAt      time.Time
	// Camera is make + model where the file says.
	Camera string
}

// IsVideo reports whether key names a video this indexer handles.
//
// The list is deliberately short: these are what phones and cameras write,
// plus the one web-native container. Anything else ffmpeg could open would be
// indexed and then not play in a browser, which is a worse answer than
// leaving it out (ADR 0029).
func IsVideo(key string) bool {
	switch strings.ToLower(path.Ext(key)) {
	case ".mov", ".mp4", ".m4v", ".webm":
		return true
	}
	return false
}

// MIME names the content type for a video key, for the Content-Type the
// player is handed.
func MIME(key string) string {
	switch strings.ToLower(path.Ext(key)) {
	case ".mov":
		return "video/quicktime"
	case ".mp4", ".m4v":
		return "video/mp4"
	case ".webm":
		return "video/webm"
	}
	return "application/octet-stream"
}

// Available reports whether both tools are on PATH.
func Available() error {
	for _, bin := range []string{"ffprobe", "ffmpeg"} {
		if _, err := exec.LookPath(bin); err != nil {
			return fmt.Errorf("%w (%s not found)", ErrNoFFmpeg, bin)
		}
	}
	return nil
}

// ---- ffprobe ----

type probeOutput struct {
	Streams []struct {
		CodecType    string            `json:"codec_type"`
		CodecName    string            `json:"codec_name"`
		Width        int               `json:"width"`
		Height       int               `json:"height"`
		Duration     string            `json:"duration"`
		Tags         map[string]string `json:"tags"`
		SideDataList []struct {
			Rotation *float64 `json:"rotation"`
		} `json:"side_data_list"`
	} `json:"streams"`
	Format struct {
		Duration string            `json:"duration"`
		Tags     map[string]string `json:"tags"`
	} `json:"format"`
}

// Probe reads the container's headers.
func Probe(ctx context.Context, path string) (Info, error) {
	ctx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "ffprobe",
		"-v", "error",
		"-print_format", "json",
		"-show_format",
		"-show_streams",
		path,
	)
	var out, errOut bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errOut
	if err := cmd.Run(); err != nil {
		return Info{}, fmt.Errorf("ffprobe %s: %w: %s", path, err, strings.TrimSpace(errOut.String()))
	}
	return parseProbe(out.Bytes())
}

func parseProbe(raw []byte) (Info, error) {
	var p probeOutput
	if err := json.Unmarshal(raw, &p); err != nil {
		return Info{}, fmt.Errorf("ffprobe output: %w", err)
	}
	var info Info
	for _, s := range p.Streams {
		if s.CodecType != "video" {
			continue
		}
		info.Width, info.Height = s.Width, s.Height
		info.Codec = s.CodecName
		for _, sd := range s.SideDataList {
			if sd.Rotation != nil {
				// ffprobe reports -90 for a quarter turn clockwise; the
				// catalog only ever reads this to explain the poster's shape.
				info.Rotation = ((int(*sd.Rotation) % 360) + 360) % 360
			}
		}
		if info.DurationMS == 0 {
			info.DurationMS = millis(s.Duration)
		}
		break
	}
	if info.DurationMS == 0 {
		info.DurationMS = millis(p.Format.Duration)
	}
	if info.Width == 0 && info.Height == 0 {
		return Info{}, errors.New("no video stream")
	}
	applyCreation(&info, p.Format.Tags)
	info.Camera = camera(p.Format.Tags)
	return info, nil
}

func millis(s string) int64 {
	f, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil || f <= 0 {
		return 0
	}
	return int64(f * 1000)
}

// applyCreation prefers Apple's creationdate, which carries the offset the
// clip was shot at. `creation_time` is normalised to UTC, so on its own it
// puts an evening in Belgium an hour or two earlier in the day — the same
// mistake the offset-time tags fixed for stills (ADR 0026).
func applyCreation(info *Info, tags map[string]string) {
	if raw := strings.TrimSpace(tags["com.apple.quicktime.creationdate"]); raw != "" {
		for _, layout := range []string{"2006-01-02T15:04:05-0700", time.RFC3339} {
			if t, err := time.Parse(layout, raw); err == nil {
				_, offset := t.Zone()
				info.TakenAt = t.UTC()
				info.TakenAtLocal = t.Format("2006-01-02T15:04:05")
				info.TZOffset = offset
				return
			}
		}
	}
	if raw := strings.TrimSpace(tags["creation_time"]); raw != "" {
		if t, err := time.Parse(time.RFC3339, raw); err == nil {
			info.TakenAt = t.UTC()
			// No offset to go on: the wall clock is the UTC one, and saying
			// so is better than inventing a local time.
			info.TakenAtLocal = t.UTC().Format("2006-01-02T15:04:05")
			info.TZOffset = 0
		}
	}
}

func camera(tags map[string]string) string {
	make := strings.TrimSpace(tags["com.apple.quicktime.make"])
	model := strings.TrimSpace(tags["com.apple.quicktime.model"])
	switch {
	case make != "" && model != "":
		if strings.HasPrefix(strings.ToLower(model), strings.ToLower(make)) {
			return model
		}
		return make + " " + model
	case model != "":
		return model
	default:
		return make
	}
}

// ---- poster frame ----

// Poster returns one JPEG frame, already rotated the way the clip plays.
//
// The bytes go straight into the existing thumbnail ladder, so a video ends
// up with the same 256/512/1024 set as a photo and the timeline needs to know
// nothing about video at all. It also means the pure-Go build can make video
// thumbnails: ffmpeg does the decoding, not libvips.
func Poster(ctx context.Context, path string, durationMS int64) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, posterTimeout)
	defer cancel()

	at := posterAt
	if durationMS > 0 && float64(durationMS)/1000 <= posterAt {
		at = float64(durationMS) / 2000
	}

	// -ss before -i seeks by index rather than decoding up to the mark.
	// -frames:v 1 with mjpeg writes one JPEG to stdout; no temporary file,
	// and nothing touches the disk the cache lives on.
	cmd := exec.CommandContext(ctx, "ffmpeg",
		"-v", "error",
		"-ss", strconv.FormatFloat(at, 'f', 3, 64),
		"-i", path,
		"-frames:v", "1",
		"-f", "image2",
		"-vcodec", "mjpeg",
		"-q:v", "3",
		"pipe:1",
	)
	var out, errOut bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errOut
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("ffmpeg poster %s: %w: %s", path, err, strings.TrimSpace(errOut.String()))
	}
	if out.Len() == 0 {
		return nil, fmt.Errorf("ffmpeg poster %s: no frame at %.3fs", path, at)
	}
	return out.Bytes(), nil
}
