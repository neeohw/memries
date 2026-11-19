# Memries — Agent Guide

## This workspace

This repository is Memries only. Work inside this folder. Do not open, edit, or depend on parent directories, sibling apps, or paths outside this repo (including external phased-plan notes). Human onboarding lives in [README.md](README.md); this file is for agents.

## Before changing code

1. Read this file and [CONTEXT-MAP.md](CONTEXT-MAP.md).
2. Find the decision that governs what you are about to change in
   [docs/adr/](docs/adr/). Its table of contents is the decisions table in
   CONTEXT-MAP.md. If your change contradicts one, revise that ADR in the same
   change — an ADR that no longer describes the product is rewritten or
   deleted, not annotated with its own history.
3. Then implement.

## Product / Phase 1

Lightweight photo manager: date-scroll timeline, zoomed by year / month / week ([0019](docs/adr/0019-pointer-driven-timeline-zoom.md)).

In scope:

- Timeline browse (virtual scroll, lightbox)
- Local password sign-in, cookie session ([0016](docs/adr/0016-local-password-auth.md))
- Indexer CLI (EXIF, sha256 dedup, 256 / 512 / 1024 thumbs)
- Admin-managed Sources, server-wide: a local path or WebDAV ([0013](docs/adr/0013-admin-managed-sources.md), [0020](docs/adr/0020-server-wide-library.md))
- One shared library; favorites and Albums stay per reader ([0020](docs/adr/0020-server-wide-library.md))

Out of scope unless the user asks: video, S3 storage, WebSockets, sharing graph, Piwigo import.

## Stack

- pnpm + Turborepo workspace under `apps/` (`@memries/frontend`, `@memries/backend`, `@memries/e2e`, `@memries/scripts`)
- Go 1.26 module `github.com/memries/memries` — chi, `database/sql` (SQLite default, PostgreSQL optional), gorilla sessions, argon2id, imaging
- React 18 + Vite + Tailwind + TanStack Query + virtua
- SQLite (or PostgreSQL), Caddy, Docker Compose

## Non-negotiables

- Do not leave this repository.
- Do not deploy infrastructure or mutate remote environments. Do not run Compose against a remote host.
- Do not commit `.env` or `data/`. Do not put secrets in docs.
- Commit only when the user asks.
- Ignore README pointers that leave this folder.

## How to run

Follow the README quick start (Compose + `.env`). Host Turbo builds need `make install-requirements` then `pnpm install`. Initial index:

```bash
docker compose exec backend indexer
```

Dev login is `admin@example.com` plus `BOOTSTRAP_PASSWORD` from `.env` ([0016](docs/adr/0016-local-password-auth.md)). Troubleshooting and host ports are in the README.

## Seams

Public seams for new behavior and tests:

- HTTP: [apps/backend/internal/api](apps/backend/internal/api/api.go) and [apps/backend/internal/auth](apps/backend/internal/auth/auth.go)
- Storage: [apps/backend/internal/storage](apps/backend/internal/storage/storage.go)
- Schema and queries: [apps/backend/internal/db](apps/backend/internal/db/store.go)

New tests belong next to those seams (`*_test.go` / frontend tests), not inside UI widgets.

## Checks

Run these directly. There is no skill to invoke for them.

```bash
# Go — from apps/backend
gofmt -l . && go vet ./... && go test ./...
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -o /dev/null ./cmd/...   # the Pi is the target

# Frontend — from apps/frontend
pnpm exec tsc --noEmit && pnpm exec vitest run
pnpm exec eslint src && pnpm exec prettier --check "src/**/*.{ts,tsx}"

# e2e package — from apps/e2e
pnpm exec eslint . && node --test scripts/*.test.mjs
```

`gofmt` is not on the default PATH here; prefix Go commands with
`export PATH="$HOME/.local/go/bin:$PATH"`.

Never run `npm` in this repo — an x64 pnpm with an arm64 node installs the
wrong rollup binary. Use `pnpm`.

### The Playwright suite

`make e2e` builds and runs the whole Compose stack, takes minutes, and is
**not** part of a normal change. Ask before running it. Both profiles are
headless ([0012](docs/adr/0012-e2e-one-suite-two-profiles.md)); do not run
`test:headed` unless asked for by name.

A schema change means wiping the catalog first: the schema is edited in place
rather than migrated while the product is pre-release
([0020](docs/adr/0020-server-wide-library.md)).

## Scripts

New or edited scripts live in `apps/scripts/<name>/` as a unit-tested Node
`.mjs` plus Unix and PowerShell wrappers.

## A note on `.cursor/`

`.cursor/skills/` and `.cursor/rules/` came from a colleague working in
Cursor. They are not visible to Claude Code and cannot be invoked from it —
the lint and format ones wrap exactly the commands above. Treat them as
another tool's configuration, not as instructions to follow.
