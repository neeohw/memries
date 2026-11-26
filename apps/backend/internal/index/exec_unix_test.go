//go:build unix

package index

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// fakeIndexer writes a shell script standing in for the real binary and
// returns an ExecRunner pointed at it. A script rather than a compiled helper
// because what is under test is the plumbing — arguments in, progress out,
// exit status — and none of that needs an indexer behind it.
func fakeIndexer(t *testing.T, body string) *ExecRunner {
	t.Helper()
	path := filepath.Join(t.TempDir(), IndexerBinary)
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"+body), 0o700); err != nil {
		t.Fatal(err)
	}
	// A short grace so the cancellation test does not sit through the real
	// one; what it checks is the escalation, not its duration.
	return &ExecRunner{Grace: 200 * time.Millisecond, lookup: func() (string, error) { return path, nil }}
}

func TestExecRunnerReportsProgressFromTheChild(t *testing.T) {
	r := fakeIndexer(t, `
echo '{"discovered":3,"processed":1}'
echo '{"discovered":3,"processed":3,"indexed":2,"skipped":1}'
echo "a log line that belongs on stderr" >&2
exit 0
`)
	var seen []int
	res, err := r.Run(context.Background(), Options{
		Prefixes:   []string{"src-1"},
		OnProgress: func(p Result) { seen = append(seen, p.Processed) },
	})
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if len(seen) != 2 || seen[1] != 3 {
		t.Errorf("progress %v, want two updates ending at 3", seen)
	}
	if res.Indexed != 2 || res.Skipped != 1 {
		t.Errorf("result %+v, want the last update", res)
	}
}

// A failed run has one string to explain itself: the run row's error, which
// the splash shows. Without the child's stderr it would read "exit status 1".
func TestExecRunnerExplainsAFailureWithTheChildsStderr(t *testing.T) {
	r := fakeIndexer(t, `
echo '{"discovered":1}'
echo "config: no such file" >&2
exit 1
`)
	res, err := r.Run(context.Background(), Options{})
	if err == nil {
		t.Fatal("want an error from a child that exited 1")
	}
	if !strings.Contains(err.Error(), "config: no such file") {
		t.Errorf("error %q, want the child's stderr in it", err)
	}
	// Whatever it managed to report before dying still counts.
	if res.Discovered != 1 {
		t.Errorf("result %+v, want the progress seen before the failure", res)
	}
}

func TestExecRunnerPassesTheArgumentsOn(t *testing.T) {
	r := fakeIndexer(t, `printf '{"discovered":%s}\n' "$#"; echo "$@" >&2`)
	res, err := r.Run(context.Background(), Options{
		Prefixes:    []string{"src-1", "src-2"},
		Concurrency: 4,
	})
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	// --progress json --concurrency 4 --source src-1 --source src-2
	if want := len(indexerArgs(Options{Prefixes: []string{"src-1", "src-2"}, Concurrency: 4}, "")); res.Discovered != want {
		t.Errorf("child saw %d arguments, want %d", res.Discovered, want)
	}
}

// Cancelling a run must end it. The child ignores SIGTERM here, so this also
// covers the escalation to a kill after the grace period.
func TestExecRunnerStopsACancelledRun(t *testing.T) {
	r := fakeIndexer(t, `
trap '' TERM
echo '{"discovered":1}'
sleep 30
`)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := r.Run(ctx, Options{OnProgress: func(Result) { cancel() }})
		done <- err
	}()

	select {
	case err := <-done:
		if err == nil {
			t.Fatal("want an error from a cancelled run")
		}
	case <-time.After(10 * time.Second):
		t.Fatal("a cancelled run did not end")
	}
}

func TestExecRunnerSaysWhenTheBinaryIsMissing(t *testing.T) {
	r := &ExecRunner{}
	// os.Executable in a test is the test binary, which has no indexer beside
	// it — the same failure as a half-installed package.
	if _, err := r.Run(context.Background(), Options{}); err == nil {
		t.Fatal("want an error when the binary is not beside this one")
	} else if !strings.Contains(err.Error(), IndexerBinary) {
		t.Errorf("error %q, want it to name %s", err, IndexerBinary)
	}
}
