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
	configPath := flag.String("config", "", "path to memries.yaml (default: $MEMRIES_CONFIG, ./memries.yaml, /etc/memries/config.yaml)")
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
