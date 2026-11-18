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

	interruptMessage = "interrupted by restart"
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
	GetIndexRun(ctx context.Context, ownerID string) (*db.IndexRun, error)
	UpsertIndexRun(ctx context.Context, run *db.IndexRun) error
	ListIndexRunsByStatus(ctx context.Context, status string) ([]db.IndexRun, error)
}

type OwnerPhotoCounter interface {
	CountOwnerPhotos(ctx context.Context, ownerID string) (int64, error)
}

type PrefixMediaCounter interface {
	CountMediaPrefix(ctx context.Context, prefix string) (int, error)
}

type OriginalsProber interface {
	RecentOriginalsMissing(ctx context.Context, ownerID string) (bool, error)
}

// Scope is one storage prefix an Index run walks — one per Source.
type Scope struct {
	Prefix string
	// Remote Sources are not re-counted on every status read (a full
	// listing over the network); they rescan when an admin edits them.
	Remote bool
}

// ScopeResolver lists the storage prefixes that make up an Owner's library.
type ScopeResolver interface {
	Scopes(ctx context.Context, ownerID, email string) ([]Scope, error)
}

// EmailScopes is the pre-Source layout: one folder named after the email.
type EmailScopes struct{}

func (EmailScopes) Scopes(_ context.Context, _, email string) ([]Scope, error) {
	prefix, err := PrefixFromEmail(email)
	if err != nil {
		return nil, err
	}
	return []Scope{{Prefix: prefix}}, nil
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
	ownerID string
	email   string
	prefix  string
	sources int
	status  string
	result  Result
	errMsg  string
	rerun   bool // Sources changed mid-run: go again when this run ends
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
		scopes:  EmailScopes{},
		log:     log,
		jobs:    make(map[string]*job),
		slot:    make(chan struct{}, 1),
	}
}

// WithScopes replaces the email-folder layout with another resolver (Sources).
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

func (c *Coordinator) Status(ctx context.Context, ownerID, email string) (Status, error) {
	c.mu.Lock()
	if j, ok := c.jobs[ownerID]; ok {
		s := j.snapshot()
		c.mu.Unlock()
		return s, nil
	}
	c.mu.Unlock()

	scopes, err := c.scopes.Scopes(ctx, ownerID, email)
	if err != nil {
		return Status{}, err
	}
	prefix := joinPrefixes(scopes)
	idle := Status{Status: StatusNotStarted, Prefix: prefix, Sources: len(scopes)}

	run, err := c.store.GetIndexRun(ctx, ownerID)
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
		if run.Prefix != prefix || c.shouldRescan(ctx, ownerID, scopes) {
			return idle, nil
		}
		s := statusFromRun(run, prefix)
		s.Sources = len(scopes)
		return s, nil
	}

	n, err := c.counter.CountOwnerPhotos(ctx, ownerID)
	if err != nil {
		return Status{}, err
	}
	if n > 0 && !c.shouldRescan(ctx, ownerID, scopes) {
		return Status{Status: StatusComplete, Prefix: prefix, Sources: len(scopes)}, nil
	}
	return idle, nil
}

func (c *Coordinator) shouldRescan(ctx context.Context, ownerID string, scopes []Scope) bool {
	n, err := c.counter.CountOwnerPhotos(ctx, ownerID)
	if err != nil {
		return false
	}
	if c.library != nil && n > 0 {
		missing, err := c.library.RecentOriginalsMissing(ctx, ownerID)
		if err == nil && missing {
			return true
		}
	}
	if c.media != nil {
		disk := 0
		for _, s := range scopes {
			if s.Remote {
				continue
			}
			k, err := c.media.CountMediaPrefix(ctx, s.Prefix)
			if err != nil {
				return false
			}
			disk += k
		}
		if int64(disk) > n {
			return true
		}
	}
	return false
}

func (c *Coordinator) Start(ctx context.Context, ownerID, email string) (Status, error) {
	return c.start(ctx, ownerID, email, false)
}

// Rescan is Start for callers that just changed the Owner's Sources: a run
// already in flight walked the old set, so another run is queued behind it.
func (c *Coordinator) Rescan(ctx context.Context, ownerID, email string) (Status, error) {
	return c.start(ctx, ownerID, email, true)
}

func (c *Coordinator) start(ctx context.Context, ownerID, email string, rerun bool) (Status, error) {
	if _, err := PrefixFromEmail(email); err != nil {
		return Status{}, err
	}
	if ownerID == "" {
		return Status{}, errors.New("owner required")
	}

	c.mu.Lock()
	if j, ok := c.jobs[ownerID]; ok && (j.status == StatusQueued || j.status == StatusRunning) {
		if rerun && j.status == StatusRunning {
			j.rerun = true
		}
		s := j.snapshot()
		c.mu.Unlock()
		return s, nil
	}
	j := &job{ownerID: ownerID, email: email, status: StatusQueued}
	c.jobs[ownerID] = j
	c.mu.Unlock()

	now := time.Now().UTC()
	if err := c.store.UpsertIndexRun(ctx, &db.IndexRun{
		Key:       ownerID,
		OwnerID:   ownerID,
		Status:    StatusQueued,
		UpdatedAt: now,
	}); err != nil {
		c.mu.Lock()
		delete(c.jobs, ownerID)
		c.mu.Unlock()
		return Status{}, err
	}

	go c.execute(ownerID, email)
	return j.snapshot(), nil
}

func (c *Coordinator) execute(ownerID, email string) {
	select {
	case c.slot <- struct{}{}:
	case <-c.ctx.Done():
		c.finish(ownerID, "", StatusFailed, Result{}, interruptMessage)
		return
	}
	defer func() { <-c.slot }()

	for {
		if !c.runOnce(ownerID, email) {
			return
		}
	}
}

// runOnce performs one Index run and reports whether a rerun was requested.
func (c *Coordinator) runOnce(ownerID, email string) bool {
	if c.ctx.Err() != nil {
		c.finish(ownerID, "", StatusFailed, Result{}, interruptMessage)
		return false
	}
	scopes, err := c.scopes.Scopes(c.ctx, ownerID, email)
	if err != nil {
		c.finish(ownerID, "", StatusFailed, Result{}, err.Error())
		return c.takeRerun(ownerID)
	}
	prefix := joinPrefixes(scopes)
	prefixes := make([]string, len(scopes))
	for i, s := range scopes {
		prefixes[i] = s.Prefix
	}

	c.setRunning(ownerID, prefix, len(scopes))
	started := time.Now().UTC()
	_ = c.store.UpsertIndexRun(c.ctx, &db.IndexRun{
		Key:       ownerID,
		OwnerID:   ownerID,
		Prefix:    prefix,
		Status:    StatusRunning,
		StartedAt: &started,
		UpdatedAt: started,
	})

	res, err := c.runner.Run(c.ctx, Options{
		OwnerID:     ownerID,
		Prefixes:    prefixes,
		Concurrency: 4,
		OnProgress: func(p Result) {
			c.updateProgress(ownerID, p)
		},
	})
	if err != nil {
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
		OwnerID:    ownerID,
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
		c.log.Error("persist index run", "owner", ownerID, "err", err)
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
