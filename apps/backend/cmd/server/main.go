package main

import (
	"context"
	"errors"
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
)

func main() {
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	cfg, err := config.FromEnv()
	if err != nil {
		log.Error("config", "err", err)
		os.Exit(1)
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
	tg, err := thumb.NewGenerator(cfg.CacheRoot)
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
	sealer, err := sources.NewSealer(cfg.SessionKey)
	if err != nil {
		log.Error("sources", "err", err)
		os.Exit(1)
	}
	reg := &sources.Registry{Repo: dbc, Sealer: sealer, Roots: cfg.SourceRoots, Log: log}
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
		IsAdmin:     cfg.IsAdmin,
		E2E:         os.Getenv("MEMRIES_E2E") == "1",
	}

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{cfg.PublicURL, "http://localhost:5173"},
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
		apiH.Routes(r)
	})

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()
	log.Info("starting", "addr", cfg.Addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Error("serve", "err", err)
		os.Exit(1)
	}
}
