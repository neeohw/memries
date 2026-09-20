# Memries — Agent Guide

## This workspace

This repository is Memries only. Work inside this folder. Do not open, edit, or depend on parent directories, sibling apps, or paths outside this repo (including external phased-plan notes). Human onboarding lives in [README.md](README.md); this file is for agents.

## Before changing code

1. Read this file and [CONTEXT-MAP.md](CONTEXT-MAP.md).
2. Run the `context-map` workflow for the task and wait for review.
3. Then implement.

Do not invent a parallel workflow when a listed skill already owns it.

## Product / Phase 1

Lightweight photo manager: date-scroll timeline with year / month / week / day granularity.

In scope:

- Timeline browse (virtual scroll, lightbox)
- OIDC cookie session (Dex in local Compose)
- Indexer CLI (EXIF, sha256 dedup, 256 / 512 / 1024 thumbs)
- Local filesystem storage
- Per-owner ACL (`session user key` vs `photo.owner_id`)

Out of scope unless the user asks: video, S3 storage, WebSockets, sharing graph, Piwigo import.

## Stack

- pnpm + Turborepo workspace under `apps/` (`@memries/frontend`, `@memries/backend`, `@memries/e2e`, `@memries/scripts`)
- Go 1.23 module `github.com/memries/memries` — chi, Arango driver, OIDC, gorilla sessions, imaging
- React 18 + Vite + Tailwind + TanStack Query + virtua
- ArangoDB, Dex, Caddy, Docker Compose

## Non-negotiables

- Do not leave this repository.
- Do not deploy infrastructure or mutate remote environments. Do not run Compose against a remote host.
- Do not commit `.env` or `data/`. Do not put secrets in docs.
- Commit only when the user asks.
- Ignore README pointers that leave this folder.

## How to run

Follow the README quick start (Compose + `.env`). Host Turbo builds need `make install-requirements` then `pnpm install`. Initial index:

```bash
docker compose exec backend indexer -owner admin@example.com -prefix admin@example.com
```

Dev login is documented in [deploy/dex/config.yaml](deploy/dex/config.yaml). Troubleshooting and host ports are in the README.

## Seams

Public seams for new behavior and tests:

- HTTP: [apps/backend/internal/api](apps/backend/internal/api/api.go) and [apps/backend/internal/auth](apps/backend/internal/auth/auth.go)
- Storage: [apps/backend/internal/storage](apps/backend/internal/storage/storage.go)
- Schema and queries: [apps/backend/internal/db](apps/backend/internal/db/arango.go)

New tests belong next to those seams (`*_test.go` / frontend tests), not inside UI widgets.

## Skills

- `context-map` — before any feature or bug work
- `tdd` — when adding tests
- `responsive-frontend` — any visual change under `apps/frontend/`
- `page-accessibility` — WCAG work on one Memories / Albums / Search / viewer surface
- `frontend-page-accessibility` / `frontend-lint` / `frontend-format` — React + Vite + Tailwind tree under `apps/frontend/`
- `backend-lint` / `backend-format` — Go (`gofmt` / `go vet`) under `apps/backend/`
- `platform-lint` / `platform-format` — `apps/e2e/` and `apps/scripts/`
- `e2e-docker` — plan + `make e2e` + record one suite (`memries`) on `memries-e2e`. `--force` reruns the suite and refreshes last-runs. Shelf: [`.cursor/skills/e2e-docker/`](.cursor/skills/e2e-docker/)
- `platform-quality` — user-invoked only: page-accessibility → e2e-docker (one suite run) → lint → format. Max 4 agents per lint/format/a11y wave. No scripts-to-node wave

## Scripts

New or edited scripts live in `apps/scripts/<name>/` as a unit-tested Node `.mjs` plus Unix and PowerShell wrappers. See [`.cursor/rules/dual-shell-scripts.mdc`](.cursor/rules/dual-shell-scripts.mdc).
