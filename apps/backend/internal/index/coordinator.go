package index

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/memries/memries/internal/db"
)

const (
	StatusNotStarted         = "not_started"
	StatusQueued             = "queued"
	StatusRunning            = "running"
	StatusComplete           = "complete"
	StatusCompleteWithErrors = "complete_with_errors"
	StatusFailed             = "failed"
	// StatusStopped is a run an admin ended on purpose. Not a failure: the
	// photos it got through are in the catalog and the library is browsable,
	// so the splash lets the reader past it (ADR 0004).
	StatusStopped = "stopped"

	interruptMessage = "interrupted by restart"
	stoppedMessage   = "stopped before it finished"
)

type Result struct {
	Discovered int `json:"discovered"`
	Processed  int `json:"processed"`
	Indexed    int `json:"indexed"`
	Skipped    int `json:"skipped"`
	Failed     int `json:"failed"`
}

type JobRunner interface {
	Run(ctx context.Context, opts Options) (Result, error)
}

type RunStore interface {
	GetIndexRun(ctx context.Context) (*db.IndexRun, error)
	UpsertIndexRun(ctx context.Context, run *db.IndexRun) error
	ListIndexRunsByStatus(ctx context.Context, status string) ([]db.IndexRun, error)
}

type OwnerPhotoCounter interface {
	CountPhotos(ctx context.Context) (int64, error)
}

type PrefixMediaCounter interface {
	CountMediaPrefix(ctx context.Context, prefix string) (int, error)
}

type OriginalsProber interface {
	RecentOriginalsMissing(ctx context.Context) (bool, error)
}

// Scope is one storage prefix an Index run walks — one per Source.
type Scope struct {
	Prefix string
	// Remote Sources are not re-counted on every status read (a full
	// listing over the network); they rescan when an admin edits them.
	Remote bool
}

// ScopeResolver lists the storage prefixes that make up the library.
type ScopeResolver interface {
	Scopes(ctx context.Context) ([]Scope, error)
}

type Status struct {
	Status     string `json:"status"`
	Prefix     string `json:"prefix"`
	Sources    int    `json:"sources"`
	Discovered int    `json:"discovered"`
	Processed  int    `json:"processed"`
	Indexed    int    `json:"indexed"`
	Skipped    int    `json:"skipped"`
	Failed     int    `json:"failed"`
	Error      string `json:"error,omitempty"`
}

type Coordinator struct {
	ctx     context.Context
	runner  JobRunner
	store   RunStore
	counter OwnerPhotoCounter
	media   PrefixMediaCounter
	library OriginalsProber
	scopes  ScopeResolver
	log     *slog.Logger

	mu   sync.Mutex
	jobs map[string]*job
	slot chan struct{}
}

type job struct {
	prefix  string
	sources int
	status  string
	result  Result
	errMsg  string
	rerun   bool // Sources changed mid-run: go again when this run ends
	stopped bool // An admin asked for this run to end
	cancel  context.CancelFunc
}

func NewCoordinator(ctx context.Context, runner JobRunner, store RunStore, counter OwnerPhotoCounter, media PrefixMediaCounter, library OriginalsProber, log *slog.Logger) *Coordinator {
	if log == nil {
		log = slog.Default()
	}
	return &Coordinator{
		ctx:     ctx,
		runner:  runner,
		store:   store,
		counter: counter,
		media:   media,
		library: library,
		log:     log,
		jobs:    make(map[string]*job),
		slot:    make(chan struct{}, 1),
	}
}

// resolveScopes asks where the library's media lives.
//
// There is no default resolver: the Sources registry is the only answer, and
// a Coordinator built without one should say so rather than panic on the
// first run.
func (c *Coordinator) resolveScopes(ctx context.Context) ([]Scope, error) {
	if c.scopes == nil {
		return nil, errors.New("no source resolver configured; call WithScopes")
	}
	return c.scopes.Scopes(ctx)
}

// WithScopes sets where the library's media lives (the Sources registry).
func (c *Coordinator) WithScopes(r ScopeResolver) *Coordinator {
	c.scopes = r
	return c
}

func joinPrefixes(scopes []Scope) string {
	parts := make([]string, len(scopes))
	for i, s := range scopes {
		parts[i] = s.Prefix
	}
	return strings.Join(parts, ",")
}

func (c *Coordinator) Reconcile(ctx context.Context) error {
	for _, st := range []string{StatusQueued, StatusRunning} {
		runs, err := c.store.ListIndexRunsByStatus(ctx, st)
		if err != nil {
			return err
		}
		now := time.Now().UTC()
		for i := range runs {
			run := runs[i]
			run.Status = StatusFailed
			run.Error = interruptMessage
			run.FinishedAt = &now
			run.UpdatedAt = now
			if err := c.store.UpsertIndexRun(ctx, &run); err != nil {
				return err
			}
		}
	}
	return nil
}

func (c *Coordinator) Status(ctx context.Context) (Status, error) {
	c.mu.Lock()
	if j, ok := c.jobs[db.IndexRunKey]; ok {
		s := j.snapshot()
		c.mu.Unlock()
		return s, nil
	}
	c.mu.Unlock()

	scopes, err := c.resolveScopes(ctx)
	if err != nil {
		return Status{}, err
	}
	prefix := joinPrefixes(scopes)
	idle := Status{Status: StatusNotStarted, Prefix: prefix, Sources: len(scopes)}

	run, err := c.store.GetIndexRun(ctx)
	if err != nil {
		return Status{}, err
	}
	if run != nil {
		if run.Status == StatusQueued || run.Status == StatusRunning {
			now := time.Now().UTC()
			run.Status = StatusFailed
			run.Error = interruptMessage
			run.FinishedAt = &now
			run.UpdatedAt = now
			if err := c.store.UpsertIndexRun(ctx, run); err != nil {
				return Status{}, err
			}
		}
		// "The library grew since the last run" is a claim about a run that
		// *finished*. A stopped or failed one has to report itself instead, or
		// stopping a scan would read as a library that was never indexed —
		// and `discovered` from a half-run always looks like growth.
		settled := run.Status == StatusComplete || run.Status == StatusCompleteWithErrors
		if run.Prefix != prefix || (settled && c.shouldRescan(ctx, scopes, run)) {
			return idle, nil
		}
		s := statusFromRun(run, prefix)
		s.Sources = len(scopes)
		return s, nil
	}

	n, err := c.counter.CountPhotos(ctx)
	if err != nil {
		return Status{}, err
	}
	// No run row: nothing says how many files the library was built from, so
	// the growth probe has no baseline and is skipped (see shouldRescan).
	if n > 0 && !c.shouldRescan(ctx, scopes, nil) {
		return Status{Status: StatusComplete, Prefix: prefix, Sources: len(scopes)}, nil
	}
	return idle, nil
}

// shouldRescan reports whether the library on disk has moved out from under
// the last run, which is what turns a `complete` row back into `not_started`
// and makes the splash start a run by itself (ADR 0004).
//
// It asks two questions. Have recent originals gone? And has a folder grown?
//
// The second one used to compare the files on disk against the number of rows
// in `photos`, and those two counts are not supposed to be equal. Dedup is a
// unique index on `hash` alone (ADR 0020), so the same bytes in two folders
// are one row; a file that cannot be imported is no row at all; a soft-deleted
// row whose file is still there is another. Every one of those makes disk
// exceed rows *permanently*, so a library of 11,000 photos with any duplicates
// in it reported `not_started` on every single status read and reindexed
// itself on every page load.
//
// The baseline is now the file count the last run actually walked, which is
// the same thing being counted — duplicates, failures and all. A run that
// walked 11,008 files is not out of date because the catalog holds 11,000
// rows; it is out of date when the 11,008 becomes 11,009.
//
// `run` is the last recorded run, or nil when there is none. Without one there
// is no baseline and the growth probe is skipped rather than guessed at: a
// library indexed by the CLI reports what it is, instead of rescanning forever
// because of its own duplicates.
func (c *Coordinator) shouldRescan(ctx context.Context, scopes []Scope, run *db.IndexRun) bool {
	n, err := c.counter.CountPhotos(ctx)
	if err != nil {
		return false
	}
	if c.library != nil && n > 0 {
		missing, err := c.library.RecentOriginalsMissing(ctx)
		if err == nil && missing {
			return true
		}
	}
	return c.libraryGrew(ctx, scopes, run)
}

// libraryGrew compares the media files on disk now against the number the last
// run walked.
//
// It compares like with like or not at all. A remote Source is deliberately
// not listed on every status read — that is a full network listing per page
// load — but the last run *did* walk it and counted it in `Discovered`, so
// with one in the library the two numbers are not comparable and the probe
// stands down. Growth in a remote Source was never detected here anyway; the
// Sync button is how a reader asks for that.
func (c *Coordinator) libraryGrew(ctx context.Context, scopes []Scope, run *db.IndexRun) bool {
	if c.media == nil || run == nil {
		return false
	}
	disk := 0
	for _, s := range scopes {
		if s.Remote {
			return false
		}
		k, err := c.media.CountMediaPrefix(ctx, s.Prefix)
		if err != nil {
			// An unreadable folder is not a grown one.
			return false
		}
		disk += k
	}
	return disk > run.Discovered
}

func (c *Coordinator) Start(ctx context.Context) (Status, error) {
	return c.start(ctx, false)
}

// Stop ends the run in flight.
//
// The child process gets a signal and unwinds, so this returns as soon as the
// request is in — the status still reads `running` until the process is gone,
// and the splash polls its way to `stopped`. Waiting here would hold an HTTP
// request open for however long libvips takes to put down the frame it is on.
//
// A queued follow-up run is dropped: an admin pressing stop does not mean
// "and then go again". Stopping when nothing is running is not an error, so
// the current status comes back unchanged and pressing it twice is harmless.
func (c *Coordinator) Stop(ctx context.Context) (Status, error) {
	ownerID := db.IndexRunKey

	c.mu.Lock()
	j, ok := c.jobs[ownerID]
	if !ok {
		c.mu.Unlock()
		return c.Status(ctx)
	}
	if j.status != StatusQueued && j.status != StatusRunning {
		s := j.snapshot()
		c.mu.Unlock()
		return s, nil
	}
	j.stopped = true
	j.rerun = false
	cancel := j.cancel
	s := j.snapshot()
	c.mu.Unlock()

	// Nil while the job is still queued behind another: runOnce reads the flag
	// before it starts anything, so the run ends without walking a file.
	if cancel != nil {
		cancel()
	}
	c.log.Info("index run stop requested")
	return s, nil
}

// takeStopped reports whether a stop was asked for, and clears the request.
func (c *Coordinator) takeStopped(ownerID string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	j, ok := c.jobs[ownerID]
	if !ok || !j.stopped {
		return false
	}
	j.stopped = false
	return true
}

// setRunCancel hands the job the handle Stop pulls.
func (c *Coordinator) setRunCancel(ownerID string, cancel context.CancelFunc) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if j, ok := c.jobs[ownerID]; ok {
		j.cancel = cancel
	}
}

// Rescan is Start for callers that just changed the Sources: a run already in
// flight walked the old set, so another run is queued behind it.
func (c *Coordinator) Rescan(ctx context.Context) (Status, error) {
	return c.start(ctx, true)
}

func (c *Coordinator) start(ctx context.Context, rerun bool) (Status, error) {
	// One library, one run: the key is a constant rather than an owner
	// (ADR 0020).
	ownerID := db.IndexRunKey

	c.mu.Lock()
	if j, ok := c.jobs[ownerID]; ok && (j.status == StatusQueued || j.status == StatusRunning) {
		if rerun && j.status == StatusRunning {
			j.rerun = true
		}
		s := j.snapshot()
		c.mu.Unlock()
		return s, nil
	}
	j := &job{status: StatusQueued}
	c.jobs[ownerID] = j
	c.mu.Unlock()

	now := time.Now().UTC()
	if err := c.store.UpsertIndexRun(ctx, &db.IndexRun{
		Key:       ownerID,
		Status:    StatusQueued,
		UpdatedAt: now,
	}); err != nil {
		c.mu.Lock()
		delete(c.jobs, ownerID)
		c.mu.Unlock()
		return Status{}, err
	}

	go c.execute()
	return j.snapshot(), nil
}

func (c *Coordinator) execute() {
	ownerID := db.IndexRunKey
	select {
	case c.slot <- struct{}{}:
	case <-c.ctx.Done():
		c.finish(ownerID, "", StatusFailed, Result{}, interruptMessage)
		return
	}
	defer func() { <-c.slot }()

	for {
		if !c.runOnce() {
			return
		}
	}
}

// runOnce performs one Index run and reports whether a rerun was requested.
func (c *Coordinator) runOnce() bool {
	ownerID := db.IndexRunKey
	if c.ctx.Err() != nil {
		c.finish(ownerID, "", StatusFailed, Result{}, interruptMessage)
		return false
	}
	scopes, err := c.resolveScopes(c.ctx)
	if err != nil {
		c.finish(ownerID, "", StatusFailed, Result{}, err.Error())
		return c.takeRerun(ownerID)
	}
	prefix := joinPrefixes(scopes)
	prefixes := make([]string, len(scopes))
	for i, s := range scopes {
		prefixes[i] = s.Prefix
	}

	if c.takeStopped(ownerID) {
		// Stopped while queued behind another run: end without walking a file.
		c.finish(ownerID, prefix, StatusStopped, Result{}, stoppedMessage)
		return false
	}

	c.setRunning(ownerID, prefix, len(scopes))
	started := time.Now().UTC()
	_ = c.store.UpsertIndexRun(c.ctx, &db.IndexRun{
		Key:       ownerID,
		Prefix:    prefix,
		Status:    StatusRunning,
		StartedAt: &started,
		UpdatedAt: started,
	})

	// A context of this run's own, so Stop can end one run without taking the
	// server's down with it.
	runCtx, cancel := context.WithCancel(c.ctx)
	defer cancel()
	c.setRunCancel(ownerID, cancel)

	res, err := c.runner.Run(runCtx, Options{
		Prefixes:    prefixes,
		Concurrency: 4,
		OnProgress: func(p Result) {
			c.updateProgress(ownerID, p)
		},
	})
	if err != nil {
		// Asked for, so not a failure: the counts it reached are kept and the
		// library stays browsable.
		if c.takeStopped(ownerID) {
			c.finish(ownerID, prefix, StatusStopped, res, stoppedMessage)
			return false
		}
		msg := err.Error()
		if c.ctx.Err() != nil {
			msg = interruptMessage
		}
		c.finish(ownerID, prefix, StatusFailed, res, msg)
		return c.ctx.Err() == nil && c.takeRerun(ownerID)
	}
	status := StatusComplete
	if res.Failed > 0 {
		status = StatusCompleteWithErrors
	}
	if c.takeRerun(ownerID) {
		// Stay "running" so the splash keeps polling into the follow-up run.
		c.updateProgress(ownerID, res)
		return true
	}
	c.finish(ownerID, prefix, status, res, "")
	return false
}

func (c *Coordinator) takeRerun(ownerID string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	j, ok := c.jobs[ownerID]
	if !ok || !j.rerun {
		return false
	}
	j.rerun = false
	j.status = StatusRunning
	return true
}

func (c *Coordinator) setRunning(ownerID, prefix string, sources int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if j, ok := c.jobs[ownerID]; ok {
		j.status = StatusRunning
		j.prefix = prefix
		j.sources = sources
	}
}

func (c *Coordinator) updateProgress(ownerID string, res Result) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if j, ok := c.jobs[ownerID]; ok {
		j.result = res
	}
}

func (c *Coordinator) finish(ownerID, prefix, status string, res Result, errMsg string) {
	c.mu.Lock()
	if j, ok := c.jobs[ownerID]; ok {
		j.status = status
		j.result = res
		j.errMsg = errMsg
	}
	c.mu.Unlock()

	now := time.Now().UTC()
	run := &db.IndexRun{
		Key:        ownerID,
		Prefix:     prefix,
		Status:     status,
		Discovered: res.Discovered,
		Processed:  res.Processed,
		Indexed:    res.Indexed,
		Skipped:    res.Skipped,
		Failed:     res.Failed,
		Error:      errMsg,
		FinishedAt: &now,
		UpdatedAt:  now,
	}
	if err := c.store.UpsertIndexRun(c.ctx, run); err != nil {
		c.log.Error("persist index run", "err", err)
	}
}

func (j *job) snapshot() Status {
	return Status{
		Status:     j.status,
		Prefix:     j.prefix,
		Sources:    j.sources,
		Discovered: j.result.Discovered,
		Processed:  j.result.Processed,
		Indexed:    j.result.Indexed,
		Skipped:    j.result.Skipped,
		Failed:     j.result.Failed,
		Error:      j.errMsg,
	}
}

func statusFromRun(run *db.IndexRun, fallbackPrefix string) Status {
	prefix := run.Prefix
	if prefix == "" {
		prefix = fallbackPrefix
	}
	return Status{
		Status:     run.Status,
		Prefix:     prefix,
		Discovered: run.Discovered,
		Processed:  run.Processed,
		Indexed:    run.Indexed,
		Skipped:    run.Skipped,
		Failed:     run.Failed,
		Error:      run.Error,
	}
}
