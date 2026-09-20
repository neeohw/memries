# 0011. Turborepo and pnpm own the Memries build graph

- Status: Accepted
- Date: 2026-08-26
- Source type: Internal decision (build graph)

## Key thesis

Memries is a pnpm + Turborepo workspace under `apps/`. Turbo owns `build` / `test` / `lint` / `format` / `dev`. Compose still runs the modular monolith. Docker images `turbo prune` their package, then copy lockfile and root config files prune may drop.

## Context

The repo was four isolated trees: npm `frontend/` and `e2e/`, a Go module in `backend/`, and Node planners in `scripts/`. Compose built from package-local Docker contexts. Quality skills already fan out by tree path. We needed one graph so Go is a first-class Turbo package and images install only the pruned subgraph.

## Decision

1. Workspace packages: `@memries/frontend`, `@memries/backend`, `@memries/e2e`, `@memries/scripts` under `apps/*`. Root `packageManager` is `pnpm@9.15.9`. Turbo cache is local only.
2. Go keeps module path `github.com/memries/memries`. `@memries/backend` `build` writes `bin/server` and `bin/indexer` with `CGO_ENABLED=0` via Node scripts so Windows and Unix match.
3. Images use repo-root [Dockerfile.frontend](../../Dockerfile.frontend) and [Dockerfile.backend](../../Dockerfile.backend). Each runs `turbo prune --docker`, then [docker/fill-prune-output.mjs](../../docker/fill-prune-output.mjs) copies `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `package.json`, `turbo.json`, `.npmrc` (and `go.mod` / `go.sum` for backend) into `out/json` and `out/full`. The backend builder has Node 22 and Go 1.23 and runs `turbo run build --filter=@memries/backend`.
4. Host toolchain install is [apps/scripts/install-requirements/](../../apps/scripts/install-requirements/) (Node 22, Go 1.23, corepack pnpm). It does not install Docker or workspace deps. `make up` remains Compose. `turbo dev` is the Vite SPA only.
5. The quality shelf is unchanged: worktrees and last-runs stay. Planner paths are `apps/scripts/app-fanout/…` and tree paths are `apps/frontend`, `apps/backend`, `apps/e2e`, `apps/scripts`. Do not collapse `/platform-quality` into `turbo run`.

## Consequences

- Compose build context is the repo root. `.dockerignore` must exclude `data/`, `.worktrees`, and `node_modules`.
- `deploy/` and `data/` stay at the repo root.
- ADR 0003 still describes process shape (one Go module, two binaries, Caddy, Dex). This ADR only changes how those binaries and the SPA are built.

## Limitations

- No remote Turbo cache and no CI workflow in this change.
- Host install covers Windows, Linux, and macOS (official tarballs on Unix; winget on Windows).
