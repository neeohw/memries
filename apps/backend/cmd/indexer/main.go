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
	owner := flag.String("owner", "", "owner email (required)")
	source := flag.String("source", "", "index only this source id (default: all of the owner's sources)")
	conc := flag.Int("concurrency", 4, "worker count")
	force := flag.Bool("force", false, "reindex + regenerate thumbs even if files look unchanged")
	flag.Parse()

	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	if *owner == "" {
		log.Error("owner email required")
		os.Exit(2)
	}

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
	user, err := dbc.UpsertUserByEmail(ctx, *owner, *owner)
	if err != nil {
		log.Error("user", "err", err)
		os.Exit(1)
	}
	tg, err := thumb.NewGenerator(cfg.CacheRoot)
	if err != nil {
		log.Error("thumb gen", "err", err)
		os.Exit(1)
	}
	sealer, err := sources.NewSealer(cfg.SessionKey)
	if err != nil {
		log.Error("sources", "err", err)
		os.Exit(1)
	}
	reg := &sources.Registry{Repo: dbc, Sealer: sealer, Roots: cfg.SourceRoots, LegacyRoot: cfg.LocalRoot, Log: log}
	scopes, err := reg.Scopes(ctx, user.Key, user.Email)
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
		log.Error("source not found for owner", "source", *source, "owner", user.Email)
		os.Exit(2)
	}
	idx := &index.Indexer{Store: reg, DB: dbc, Thumb: tg, Log: log}
	log.Info("indexer start", "thumb_backend", thumb.Backend, "concurrency", *conc)
	if _, err := idx.Run(ctx, index.Options{OwnerID: user.Key, Prefixes: prefixes, Concurrency: *conc, Force: *force}); err != nil {
		log.Error("index", "err", err)
		os.Exit(1)
	}
}
