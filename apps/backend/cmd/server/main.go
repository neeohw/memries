package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"github.com/memries/memries/internal/api"
	"github.com/memries/memries/internal/auth"
	"github.com/memries/memries/internal/config"
	"github.com/memries/memries/internal/db"
	"github.com/memries/memries/internal/index"
	"github.com/memries/memries/internal/sources"
	"github.com/memries/memries/internal/storage"
	"github.com/memries/memries/internal/thumb"
	"github.com/memries/memries/internal/video"
)

func main() {
	configPath := flag.String("config", "", "path to memries.yaml (default: $MEMRIES_CONFIG, ./memries.yaml, /etc/memries/config.yaml)")
	flag.Parse()

	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	path := config.Find(*configPath)
	cfg, err := config.Load(path)
	if err != nil {
		log.Error("config", "err", err)
		os.Exit(1)
	}
	log.Info("configuration", "file", cfg.Path)
	if config.WorldReadable(path) {
		// It holds the session key and the bootstrap password. A warning
		// rather than a refusal: a bind-mounted file is routinely 0644 and
		// the server still has to start.
		log.Warn("configuration file is readable by other users", "file", path, "want", "chmod 600")
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	store, err := storage.New(cfg)
	if err != nil {
		log.Error("storage", "err", err)
		os.Exit(1)
	}
	dbc, err := db.Connect(ctx, cfg)
	if err != nil {
		log.Error("db", "err", err)
		os.Exit(1)
	}
	tg, err := thumb.NewGenerator(cfg.Library.Cache)
	if err != nil {
		log.Error("thumb", "err", err)
		os.Exit(1)
	}
	a, err := auth.New(cfg, dbc, log)
	if err != nil {
		log.Error("auth", "err", err)
		os.Exit(1)
	}
	if err := a.Bootstrap(ctx); err != nil {
		log.Error("auth bootstrap", "err", err)
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
	idx := &index.Indexer{Store: reg, DB: dbc, Thumb: tg, Log: log}
	lib := index.Library{Photos: dbc, Store: reg}
	coord := index.NewCoordinator(ctx, idx, dbc, dbc, idx, lib, log).WithScopes(reg)
	if err := coord.Reconcile(ctx); err != nil {
		log.Error("index reconcile", "err", err)
		os.Exit(1)
	}
	apiH := &api.API{
		DB:          dbc,
		Store:       store,
		SourceStore: reg,
		Thumb:       tg,
		Index:       coord,
		Sources:     reg,
		Rescan:      coord,
		SourceRoots: cfg.Library.Roots,
		IsAdmin:     cfg.IsAdmin,
		E2E:         cfg.Server.E2E,
	}

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{cfg.Server.PublicURL, "http://localhost:5173"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: true,
	}))

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok")) })
	// Sign-in is deliberately outside /api, which the session middleware
	// guards: you cannot present a session to get one.
	r.Post("/auth/login", a.LoginHandler)
	r.Post("/auth/logout", a.LogoutHandler)

	r.Route("/api", func(r chi.Router) {
		r.Use(a.Middleware)
		r.Get("/me", a.MeHandler)
		r.Put("/me/locale", a.SetLocaleHandler)
		apiH.Routes(r)
	})

	srv := &http.Server{
		Addr:              cfg.Server.Addr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()
	log.Info("starting", "addr", cfg.Server.Addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Error("serve", "err", err)
		os.Exit(1)
	}
}
