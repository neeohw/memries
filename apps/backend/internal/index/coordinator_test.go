package index

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/memries/memries/internal/db"
)

type fakeRunner struct {
	mu      sync.Mutex
	calls   []Options
	block   chan struct{}
	started chan struct{}
	err     error
	result  Result
}

func (f *fakeRunner) Run(ctx context.Context, opts Options) (Result, error) {
	f.mu.Lock()
	f.calls = append(f.calls, opts)
	f.mu.Unlock()
	if opts.OnProgress != nil && (f.result != Result{}) {
		opts.OnProgress(f.result)
	}
	if f.started != nil {
		select {
		case <-f.started:
		default:
			close(f.started)
		}
	}
	if f.block != nil {
		select {
		case <-f.block:
		case <-ctx.Done():
			return f.result, ctx.Err()
		}
	}
	return f.result, f.err
}

func (f *fakeRunner) nCalls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.calls)
}

func (f *fakeRunner) last() Options {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls[len(f.calls)-1]
}

type memStore struct {
	mu   sync.Mutex
	runs map[string]*db.IndexRun
}

func newMemStore() *memStore {
	return &memStore{runs: map[string]*db.IndexRun{}}
}

func (m *memStore) GetIndexRun(_ context.Context) (*db.IndexRun, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r := m.runs[db.IndexRunKey]
	if r == nil {
		return nil, nil
	}
	cp := *r
	return &cp, nil
}

func (m *memStore) UpsertIndexRun(_ context.Context, run *db.IndexRun) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := *run
	m.runs[run.Key] = &cp
	return nil
}

func (m *memStore) ListIndexRunsByStatus(_ context.Context, status string) ([]db.IndexRun, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []db.IndexRun
	for _, r := range m.runs {
		if r.Status == status {
			out = append(out, *r)
		}
	}
	return out, nil
}

type memCounter struct {
	n int64
}

func (m memCounter) CountPhotos(context.Context) (int64, error) {
	return m.n, nil
}

type memMediaCounter struct {
	n int
}

func (m memMediaCounter) CountMediaPrefix(context.Context, string) (int, error) {
	return m.n, nil
}

func waitStatus(t *testing.T, c *Coordinator, want string) Status {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	var last Status
	for time.Now().Before(deadline) {
		s, err := c.Status(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		last = s
		if s.Status == want {
			return s
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("status still %q, want %q", last.Status, want)
	return last
}

func TestCoordinatorDedupesDuplicateStart(t *testing.T) {
	runner := &fakeRunner{started: make(chan struct{}), block: make(chan struct{})}
	c := NewCoordinator(context.Background(), runner, newMemStore(), memCounter{}, memMediaCounter{}, nil, nil).WithScopes(fixedScopes{{Prefix: "src-1"}})
	if _, err := c.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	<-runner.started
	if _, err := c.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if runner.nCalls() != 1 {
		t.Fatalf("calls = %d", runner.nCalls())
	}
	close(runner.block)
	waitStatus(t, c, StatusComplete)
}

func TestCoordinatorRetriesAfterFailure(t *testing.T) {
	runner := &fakeRunner{err: errors.New("disk unreadable")}
	c := NewCoordinator(context.Background(), runner, newMemStore(), memCounter{}, memMediaCounter{}, nil, nil).WithScopes(fixedScopes{{Prefix: "src-1"}})
	if _, err := c.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	s := waitStatus(t, c, StatusFailed)
	if s.Error != "disk unreadable" {
		t.Fatalf("error = %q", s.Error)
	}
	runner.err = nil
	if _, err := c.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	waitStatus(t, c, StatusComplete)
	if runner.nCalls() != 2 {
		t.Fatalf("calls = %d", runner.nCalls())
	}
}

func TestCoordinatorReconcileInterruptedRun(t *testing.T) {
	store := newMemStore()
	_ = store.UpsertIndexRun(context.Background(), &db.IndexRun{
		Key:    db.IndexRunKey,
		Status: StatusRunning,
		Prefix: "src-1",
	})
	c := NewCoordinator(context.Background(), &fakeRunner{}, store, memCounter{}, memMediaCounter{}, nil, nil).WithScopes(fixedScopes{{Prefix: "src-1"}})
	if err := c.Reconcile(context.Background()); err != nil {
		t.Fatal(err)
	}
	s, err := c.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if s.Status != StatusFailed || s.Error != interruptMessage {
		t.Fatalf("got %+v", s)
	}
}

func TestCoordinatorStatusTrustsAnIndexedLibraryWithNoRunRow(t *testing.T) {
	// 4 rows against 3,165 files on disk, and no run to compare against. The
	// gap is not evidence of anything: dedup makes identical files one row
	// (ADR 0020), a file that cannot be imported is no row at all, and a
	// library indexed by the CLI has no run row to hold a baseline. Reading
	// the gap as "the folder grew" is what made an 11,000-photo library
	// reindex itself on every page load (ADR 0004).
	c := NewCoordinator(context.Background(), &fakeRunner{}, newMemStore(), memCounter{n: 4}, memMediaCounter{n: 3165}, nil, nil).WithScopes(fixedScopes{{Prefix: "src-1"}})
	s, err := c.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if s.Status != StatusComplete {
		t.Fatalf("got %q, want %q", s.Status, StatusComplete)
	}
}

// completeRun is a finished run over `prefix` that walked `discovered` files.
func completeRun(t *testing.T, prefix string, discovered int) RunStore {
	t.Helper()
	store := newMemStore()
	now := time.Now().UTC()
	if err := store.UpsertIndexRun(context.Background(), &db.IndexRun{
		Key:        db.IndexRunKey,
		Prefix:     prefix,
		Status:     StatusComplete,
		Discovered: discovered,
		Processed:  discovered,
		Indexed:    discovered,
		FinishedAt: &now,
		UpdatedAt:  now,
	}); err != nil {
		t.Fatal(err)
	}
	return store
}

func TestCoordinatorStatusIgnoresTheGapBetweenFilesAndRows(t *testing.T) {
	// The run walked all 3,165 files; 11 of them were duplicates or failures,
	// so the catalog holds 3,154 rows. Nothing has changed on disk, and the
	// baseline is the file count rather than the row count, so this is
	// complete — the regression this whole change exists for.
	c := NewCoordinator(context.Background(), &fakeRunner{}, completeRun(t, "src-1", 3165), memCounter{n: 3154}, memMediaCounter{n: 3165}, nil, nil).
		WithScopes(fixedScopes{{Prefix: "src-1"}})
	s, err := c.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if s.Status != StatusComplete {
		t.Fatalf("got %q, want %q", s.Status, StatusComplete)
	}
}

func TestCoordinatorStatusNotStartedWhenOneMoreFileAppears(t *testing.T) {
	// One file more than the last run walked is the signal that still works.
	c := NewCoordinator(context.Background(), &fakeRunner{}, completeRun(t, "src-1", 3165), memCounter{n: 3154}, memMediaCounter{n: 3166}, nil, nil).
		WithScopes(fixedScopes{{Prefix: "src-1"}})
	s, err := c.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if s.Status != StatusNotStarted {
		t.Fatalf("got %q, want %q", s.Status, StatusNotStarted)
	}
}

func TestCoordinatorStatusStandsDownOnARemoteSource(t *testing.T) {
	// A remote Source is not listed on every status read — that is a full
	// network listing per page load — but the last run did walk it and counted
	// it in Discovered. The two numbers are therefore not comparable, so the
	// growth probe says nothing rather than guessing.
	c := NewCoordinator(context.Background(), &fakeRunner{}, completeRun(t, "src-1,src-2", 5000), memCounter{n: 3154}, memMediaCounter{n: 3165}, nil, nil).
		WithScopes(fixedScopes{{Prefix: "src-1"}, {Prefix: "src-2", Remote: true}})
	s, err := c.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if s.Status != StatusComplete {
		t.Fatalf("got %q, want %q", s.Status, StatusComplete)
	}
}

func TestCoordinatorStatusNotStartedWhenCompleteRunButDiskHasMoreFiles(t *testing.T) {
	store := newMemStore()
	now := time.Now().UTC()
	_ = store.UpsertIndexRun(context.Background(), &db.IndexRun{
		Key:        db.IndexRunKey,
		Prefix:     "admin@example.com",
		Status:     StatusComplete,
		Discovered: 4,
		Processed:  4,
		Indexed:    4,
		FinishedAt: &now,
		UpdatedAt:  now,
	})
	c := NewCoordinator(context.Background(), &fakeRunner{}, store, memCounter{n: 4}, memMediaCounter{n: 3165}, nil, nil).WithScopes(fixedScopes{{Prefix: "src-1"}})
	s, err := c.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if s.Status != StatusNotStarted {
		t.Fatalf("got %q, want %q", s.Status, StatusNotStarted)
	}
}

func TestCoordinatorStatusNotStartedWhenOriginalsMissing(t *testing.T) {
	lib := Library{
		Photos: fakePhotoLister{photos: []db.Photo{
			{Storage: db.StoragePtr{Path: "admin@example.com/gone.jpg"}},
		}},
		Store: fakeStater{missing: map[string]bool{"admin@example.com/gone.jpg": true}},
	}
	c := NewCoordinator(context.Background(), &fakeRunner{}, newMemStore(), memCounter{n: 1}, memMediaCounter{n: 1}, lib, nil).WithScopes(fixedScopes{{Prefix: "src-1"}})
	s, err := c.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if s.Status != StatusNotStarted {
		t.Fatalf("got %q, want %q", s.Status, StatusNotStarted)
	}
}

func TestCoordinatorStatusInfersCompleteFromExistingPhotos(t *testing.T) {
	c := NewCoordinator(context.Background(), &fakeRunner{}, newMemStore(), memCounter{n: 4}, memMediaCounter{n: 4}, nil, nil).WithScopes(fixedScopes{{Prefix: "src-1"}})
	s, err := c.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if s.Status != StatusComplete {
		t.Fatalf("got %q", s.Status)
	}
	if s.Prefix != "src-1" {
		t.Fatalf("prefix = %q", s.Prefix)
	}
}

func TestCoordinatorPersistsEmptyComplete(t *testing.T) {
	store := newMemStore()
	c := NewCoordinator(context.Background(), &fakeRunner{}, store, memCounter{}, memMediaCounter{}, nil, nil).WithScopes(fixedScopes{{Prefix: "src-1"}})
	if _, err := c.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	waitStatus(t, c, StatusComplete)

	fresh := NewCoordinator(context.Background(), &fakeRunner{}, store, memCounter{}, memMediaCounter{}, nil, nil).WithScopes(fixedScopes{{Prefix: "src-1"}})
	s, err := fresh.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if s.Status != StatusComplete {
		t.Fatalf("restart status = %q", s.Status)
	}
}

func TestCoordinatorReportsProgress(t *testing.T) {
	runner := &fakeRunner{
		started: make(chan struct{}),
		block:   make(chan struct{}),
		result:  Result{Discovered: 12, Processed: 4, Indexed: 3, Skipped: 1},
	}
	c := NewCoordinator(context.Background(), runner, newMemStore(), memCounter{}, memMediaCounter{}, nil, nil).WithScopes(fixedScopes{{Prefix: "src-1"}})
	if _, err := c.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	<-runner.started
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		s, err := c.Status(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if s.Discovered == 12 && s.Processed == 4 && s.Indexed == 3 && s.Skipped == 1 {
			close(runner.block)
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("progress never appeared")
}

func TestCoordinatorCompleteWithErrors(t *testing.T) {
	runner := &fakeRunner{result: Result{Discovered: 2, Processed: 2, Indexed: 1, Failed: 1}}
	c := NewCoordinator(context.Background(), runner, newMemStore(), memCounter{}, memMediaCounter{}, nil, nil).WithScopes(fixedScopes{{Prefix: "src-1"}})
	if _, err := c.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	s := waitStatus(t, c, StatusCompleteWithErrors)
	if s.Failed != 1 {
		t.Fatalf("failed = %d", s.Failed)
	}
}

// fixedScopes stands in for the Sources registry. The Coordinator has no
// default resolver any more: Sources are the only place the library lives
// (ADR 0020).
type fixedScopes []Scope

func (f fixedScopes) Scopes(context.Context) ([]Scope, error) { return f, nil }

func TestCoordinatorWalksEverySourceScope(t *testing.T) {
	runner := &fakeRunner{}
	c := NewCoordinator(context.Background(), runner, newMemStore(), memCounter{}, memMediaCounter{}, nil, nil).WithScopes(fixedScopes{{Prefix: "101"}, {Prefix: "202", Remote: true}})
	if _, err := c.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	s := waitStatus(t, c, StatusComplete)
	if s.Sources != 2 {
		t.Fatalf("sources = %d", s.Sources)
	}
	if got := runner.last().Prefixes; len(got) != 2 || got[0] != "101" || got[1] != "202" {
		t.Fatalf("prefixes = %v", got)
	}
}

func TestCoordinatorRemoteScopesSkipDiskCount(t *testing.T) {
	c := NewCoordinator(context.Background(), &fakeRunner{}, newMemStore(), memCounter{n: 4}, memMediaCounter{n: 3165}, nil, nil).WithScopes(fixedScopes{{Prefix: "202", Remote: true}})
	s, err := c.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if s.Status != StatusComplete {
		t.Fatalf("got %q; remote sources must not be listed on every status read", s.Status)
	}
}

func TestCoordinatorRescanQueuesFollowUpRun(t *testing.T) {
	runner := &fakeRunner{started: make(chan struct{}), block: make(chan struct{})}
	c := NewCoordinator(context.Background(), runner, newMemStore(), memCounter{}, memMediaCounter{}, nil, nil).WithScopes(fixedScopes{{Prefix: "src-1"}})
	if _, err := c.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	<-runner.started
	if _, err := c.Rescan(context.Background()); err != nil {
		t.Fatal(err)
	}
	close(runner.block)
	waitStatus(t, c, StatusComplete)
	if runner.nCalls() != 2 {
		t.Fatalf("calls = %d, want follow-up run after Rescan", runner.nCalls())
	}
}
