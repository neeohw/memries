package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/memries/memries/internal/config"
	"github.com/memries/memries/internal/db"
	"github.com/memries/memries/internal/index"
	"github.com/memries/memries/internal/sources"
	"github.com/memries/memries/internal/thumb"
)

func main() {
	// No owner flag: the library is server-wide, so there is one thing to
	// index and nobody to index it for (ADR 0020).
	source := flag.String("source", "", "index only this source id (default: every source)")
	conc := flag.Int("concurrency", 4, "worker count")
	force := flag.Bool("force", false, "reindex + regenerate thumbs even if files look unchanged")
	flag.Parse()

	log := slog.New(slog.NewTextHandler(os.Stderr, nil))

	cfg, err := config.FromEnv()
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
	tg, err := thumb.NewGenerator(cfg.CacheRoot)
	if err != nil {
		log.Error("thumb gen", "err", err)
		os.Exit(1)
	}
	// A stored thumbnail location overrides MEMRIES_CACHE_ROOT, so a move an
	// admin made in the UI survives a restart and the indexer writes where
	// the server reads (ADR 0022).
	if stored, err := dbc.Setting(ctx, db.SettingThumbnailRoot); err != nil {
		log.Error("thumb setting", "err", err)
		os.Exit(1)
	} else if stored != "" && stored != cfg.CacheRoot {
		if err := tg.SetRoot(stored); err != nil {
			// Falling back to the env default would serve an empty cache and
			// look like data loss, so this stops instead.
			log.Error("stored thumbnail folder unusable", "path", stored, "err", err)
			os.Exit(1)
		}
		log.Info("thumbnail folder from settings", "path", stored)
	}
	sealer, err := sources.NewSealer(cfg.SessionKey)
	if err != nil {
		log.Error("sources", "err", err)
		os.Exit(1)
	}
	reg := &sources.Registry{Repo: dbc, Sealer: sealer, Roots: cfg.SourceRoots, Log: log}
	scopes, err := reg.Scopes(ctx)
	if err != nil {
		log.Error("sources", "err", err)
		os.Exit(1)
	}
	var prefixes []string
	for _, s := range scopes {
		if *source == "" || s.Prefix == *source {
			prefixes = append(prefixes, s.Prefix)
		}
	}
	if *source != "" && len(prefixes) == 0 {
		log.Error("source not found", "source", *source)
		os.Exit(2)
	}
	idx := &index.Indexer{Store: reg, DB: dbc, Thumb: tg, Log: log}
	log.Info("indexer start", "thumb_backend", thumb.Backend, "concurrency", *conc)
	if _, err := idx.Run(ctx, index.Options{Prefixes: prefixes, Concurrency: *conc, Force: *force}); err != nil {
		log.Error("index", "err", err)
		os.Exit(1)
	}
}
