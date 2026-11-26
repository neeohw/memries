package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/memries/memries/internal/config"
	"github.com/memries/memries/internal/db"
	"github.com/memries/memries/internal/index"
	"github.com/memries/memries/internal/sources"
	"github.com/memries/memries/internal/thumb"
	"github.com/memries/memries/internal/video"
)

func main() {
	// No owner flag: the library is server-wide, so there is one thing to
	// index and nobody to index it for (ADR 0020).
	// Repeatable: the server passes one per Source so the child walks exactly
	// the set the parent recorded on the run row (ADR 0004).
	var sourceIDs sourceList
	flag.Var(&sourceIDs, "source", "index only this source id; repeat for several (default: every source)")
	conc := flag.Int("concurrency", 4, "worker count")
	force := flag.Bool("force", false, "reindex + regenerate thumbs even if files look unchanged")
	configPath := flag.String("config", "", "path to memries.yaml (default: $MEMRIES_CONFIG, ./memries.yaml, /etc/memries/config.yaml)")
	progress := flag.String("progress", "", `report progress as it goes: "json" writes one object per update to stdout`)
	flag.Parse()

	log := slog.New(slog.NewTextHandler(os.Stderr, nil))

	cfg, err := config.Load(config.Find(*configPath))
	if err != nil {
		log.Error("config", "err", err)
		os.Exit(1)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	dbc, err := db.Connect(ctx, cfg)
	if err != nil {
		log.Error("db", "err", err)
		os.Exit(1)
	}
	tg, err := thumb.NewGenerator(cfg.Library.Cache)
	if err != nil {
		log.Error("thumb gen", "err", err)
		os.Exit(1)
	}
	// Said once, at startup, rather than once per clip during a scan: a
	// library with no video runs fine without ffmpeg, so this is a warning
	// and not a refusal (ADR 0029).
	if err := video.Available(); err != nil {
		log.Warn("video will be skipped", "err", err)
	}
	sealer, err := sources.NewSealer(cfg.Server.SessionKey)
	if err != nil {
		log.Error("sources", "err", err)
		os.Exit(1)
	}
	reg := &sources.Registry{Repo: dbc, Sealer: sealer, Roots: cfg.Library.Roots, Log: log}
	scopes, err := reg.Scopes(ctx)
	if err != nil {
		log.Error("sources", "err", err)
		os.Exit(1)
	}
	var prefixes []string
	for _, s := range scopes {
		if len(sourceIDs) == 0 || sourceIDs.has(s.Prefix) {
			prefixes = append(prefixes, s.Prefix)
		}
	}
	if len(sourceIDs) > 0 && len(prefixes) == 0 {
		log.Error("source not found", "source", strings.Join(sourceIDs, ","))
		os.Exit(2)
	}
	idx := &index.Indexer{Store: reg, DB: dbc, Thumb: tg, Log: log}
	log.Info("indexer start", "thumb_backend", thumb.Backend, "concurrency", *conc)

	// Progress goes to stdout and everything else to stderr, so a parent
	// process can read one without the other (ADR 0004). Encode/Write errors
	// are dropped on purpose: a parent that stopped listening is not a reason
	// to abandon a scan that is otherwise fine.
	var onProgress func(index.Result)
	if *progress == "json" {
		enc := json.NewEncoder(os.Stdout)
		onProgress = func(p index.Result) { _ = enc.Encode(p) }
	}

	res, err := idx.Run(ctx, index.Options{
		Prefixes:    prefixes,
		Concurrency: *conc,
		Force:       *force,
		OnProgress:  onProgress,
	})
	if err != nil {
		log.Error("index", "err", err)
		os.Exit(1)
	}
	// The last word on the counts, whether or not a progress tick happened to
	// land on the final file.
	if onProgress != nil {
		onProgress(res)
	}
}

// sourceList collects a repeated -source flag.
type sourceList []string

func (l *sourceList) String() string { return strings.Join(*l, ",") }

func (l *sourceList) Set(v string) error {
	v = strings.TrimSpace(v)
	if v == "" {
		return errors.New("empty source id")
	}
	*l = append(*l, v)
	return nil
}

func (l sourceList) has(id string) bool {
	for _, v := range l {
		if v == id {
			return true
		}
	}
	return false
}
