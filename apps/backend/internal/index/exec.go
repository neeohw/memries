package index

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// IndexerBinary is the filename the server looks for beside itself.
//
// The same name the package installs, which is why the build emits it under
// that name rather than cmd/'s (ADR 0004).
const IndexerBinary = "memries-indexer"

// stderrTail is how much of a failed run's stderr is kept for the error
// message. The run row holds one string and the splash shows it, so this is
// the last few lines, not a log.
const stderrTail = 4 << 10

// killGrace is how long a cancelled run has to exit after SIGTERM before it
// is killed outright. ffmpeg and libvips both hold file handles, and a scan
// interrupted mid-thumbnail should get the chance to drop them.
const killGrace = 10 * time.Second

// ExecRunner runs an index in a child process rather than in this one.
//
// It satisfies JobRunner, so the coordinator, the run row, the status endpoint
// and the splash are unchanged: only where the work happens moves (ADR 0004).
//
// Why a child at all. The server renders thumbnails when it indexes in
// process, which on this hardware means four concurrent 12MP decodes inside
// the API process on 1.9GB of RAM with no swap — so a scan could take the
// server out, and a crash in cgo or libvips took it with it. As a child, the
// scan is the thing that dies and the library stays browsable. It also means
// the server itself no longer has to be the libvips build.
type ExecRunner struct {
	// Config is the configuration file to pass through, so the child reads
	// exactly what the server read rather than searching for its own.
	Config string
	Log    *slog.Logger
	// Grace overrides how long a cancelled run has to exit before it is
	// killed. Zero means killGrace; tests shorten it.
	Grace time.Duration

	// lookup finds the binary. Nil means beside this executable, which is the
	// only thing production uses; tests replace it.
	lookup func() (string, error)
}

func (e *ExecRunner) logger() *slog.Logger {
	if e.Log != nil {
		return e.Log
	}
	return slog.Default()
}

// indexerPath is the indexer binary beside the running executable.
//
// Deliberately not a PATH lookup. exec.Command with a bare name searches
// PATH, so a binary called memries-indexer earlier in it would run as the
// server's user; resolving from os.Executable pins the child to the directory
// the server was installed in. Symlinks are followed first, because systemd
// starts /usr/bin/memries-server and a packaged path may be one.
func indexerPath() (string, error) {
	self, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("locate this executable: %w", err)
	}
	if resolved, err := filepath.EvalSymlinks(self); err == nil {
		self = resolved
	}
	path := filepath.Join(filepath.Dir(self), IndexerBinary)
	info, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("%s is not beside the server: %w", IndexerBinary, err)
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("%s is not a file", path)
	}
	return path, nil
}

// indexerArgs is the command line for one run.
//
// --source is repeated rather than joined, so the child walks exactly the
// Sources the coordinator resolved and wrote onto the run row.
func indexerArgs(opts Options, config string) []string {
	args := []string{"--progress", "json"}
	if config != "" {
		args = append(args, "--config", config)
	}
	if opts.Concurrency > 0 {
		args = append(args, "--concurrency", strconv.Itoa(opts.Concurrency))
	}
	if opts.Force {
		args = append(args, "--force")
	}
	for _, p := range opts.Prefixes {
		args = append(args, "--source", p)
	}
	return args
}

func (e *ExecRunner) Run(ctx context.Context, opts Options) (Result, error) {
	find := e.lookup
	if find == nil {
		find = indexerPath
	}
	bin, err := find()
	if err != nil {
		return Result{}, err
	}

	args := indexerArgs(opts, e.Config)
	cmd := exec.CommandContext(ctx, bin, args...)
	// SIGTERM first: the child installs a signal handler and unwinds, where
	// the default SIGKILL would leave a half-written thumbnail behind.
	cmd.Cancel = func() error { return terminate(cmd) }
	grace := e.Grace
	if grace <= 0 {
		grace = killGrace
	}
	cmd.WaitDelay = grace
	setProcessGroup(cmd)

	tail := &tailWriter{limit: stderrTail}
	cmd.Stderr = tail
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return Result{}, fmt.Errorf("indexer stdout: %w", err)
	}

	e.logger().Info("index run starts", "binary", bin, "sources", len(opts.Prefixes))
	if err := cmd.Start(); err != nil {
		return Result{}, fmt.Errorf("start %s: %w", bin, err)
	}

	last := readProgress(stdout, opts.OnProgress)
	waitErr := cmd.Wait()
	if waitErr != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return last, ctxErr
		}
		if msg := tail.String(); msg != "" {
			return last, fmt.Errorf("%w: %s", waitErr, msg)
		}
		return last, waitErr
	}
	return last, nil
}

// readProgress forwards every progress object and returns the last one.
//
// Lines that are not progress are skipped rather than failing the run: the
// contract is that the child's own output goes to stderr, and a stray line on
// stdout is not worth abandoning a scan over.
func readProgress(r io.Reader, onProgress func(Result)) Result {
	var last Result
	sc := bufio.NewScanner(r)
	// One object per line, each a handful of integers.
	sc.Buffer(make([]byte, 0, 4096), 64<<10)
	for sc.Scan() {
		line := sc.Bytes()
		if len(line) == 0 || line[0] != '{' {
			continue
		}
		var p Result
		if err := json.Unmarshal(line, &p); err != nil {
			continue
		}
		last = p
		if onProgress != nil {
			onProgress(p)
		}
	}
	return last
}

// tailWriter keeps the last `limit` bytes written to it.
type tailWriter struct {
	mu    sync.Mutex
	limit int
	buf   []byte
}

func (t *tailWriter) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.buf = append(t.buf, p...)
	if over := len(t.buf) - t.limit; over > 0 {
		t.buf = append(t.buf[:0], t.buf[over:]...)
	}
	return len(p), nil
}

func (t *tailWriter) String() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return strings.TrimSpace(string(t.buf))
}

var errNoProcess = errors.New("indexer has no process to signal")
