# Memries

<!-- e2e-last-runs-tag:start -->
[**E2E last-runs:** ❌ suite not recorded](#end-to-end-tests)
<!-- e2e-last-runs-tag:end -->

Lightweight photo manager. Replaces Piwigo. Modern UI focused on date-scroll browsing with switchable granularity (year / month / week / day).

**Stack:** pnpm + Turborepo · Go backend · ArangoDB · React + Vite · OIDC (Dex) · Caddy reverse proxy · Docker Compose.

## Status

Phase 1 (MVP) running:

- [x] Repo + Docker Compose (Arango, Dex, Caddy, backend, frontend)
- [x] Pluggable storage interface (local FS impl; S3 in Phase 3)
- [x] Arango schema bootstrap (photos, users, albums + edges)
- [x] Photo indexer CLI (EXIF, sha256 dedup, 3-tier thumbs)
- [x] OIDC auth (Dex provider, cookie session)
- [x] Timeline + photos API with per-owner ACL
- [x] React timeline UI: virtual scroll, granularity toggle, lightbox
- [x] Browser-started owner-scoped indexing job + splash progress
- [x] Cursor-paginated photos API consumed by infinite scroll
- [x] Persisted favorites and albums (owner-scoped)
- [x] Capture time from EXIF DateTimeOriginal, then file birth time, then mtime — kept on folder sync
- [x] Playwright BDD suite against an isolated Compose stack (`make e2e`)

Not in Phase 1: video, S3 backend, WebSocket live updates, sharing graph, Piwigo importer.

## Quick start

Prereqs: Docker Desktop (Compose v2), `openssl`.

```bash
# Write .env with strong random secrets
cat > .env <<EOF
ARANGO_PASSWORD=$(openssl rand -hex 16)
OIDC_CLIENT_SECRET=memries-dev-secret
SESSION_KEY=$(openssl rand -base64 32)
EOF

# Drop photos into ./data/photos/<owner-email>/...
mkdir -p data/photos/admin@example.com

docker compose build
docker compose up -d
```

Open http://localhost — login with `admin@example.com` / `password` (dev only — change `deploy/dex/config.yaml`). After login the splash starts an owner-scoped index of `data/photos/<signed-in-email>` and then loads photos from `/api/photos`.

The CLI remains an idempotent fallback (hash skip unless `-force`):

```bash
docker compose exec backend indexer -owner admin@example.com -prefix admin@example.com
```

Libraries already populated by the CLI are treated as a completed initial import and are not re-scanned automatically.

To empty Arango (photos, albums, index runs, users) and re-test folder **Sync** — including capture time from EXIF, file created, or last modified — without deleting `./data/photos` or Docker volumes:

```bash
make db-clear
```

That truncates the `memries` collections and restarts the API so the in-memory index job is dropped. Refresh the app; the splash re-indexes. Session cookie usually still works; log in again if it does not.

`make down-wipe` is the heavier reset: it deletes Compose volumes (needed if you change `ARANGO_PASSWORD` after first init).

> **Note:** ArangoDB sets the root password on **first init only**. Change `ARANGO_PASSWORD` after that and the DB will reject auth. To reset:
> `make down-wipe && make up`

## pnpm

Host `pnpm install`, e2e, and Turbo builds need [pnpm](https://pnpm.io/installation). This workspace pins **9.15.9** (`packageManager` in `package.json`). Compose (`make up`) does not.

macOS / Linux:

```bash
curl -fsSL https://get.pnpm.io/install.sh | env PNPM_VERSION=9.15.9 sh -
```

Open a new shell so `pnpm` is on PATH.

Windows: Defender can block the standalone installer, so use npm ([Using npm](https://pnpm.io/installation#using-npm)):

```powershell
npx get-pnpm
corepack prepare pnpm@9.15.9 --activate
```

If Node 22 is already on PATH, Corepack is enough on any OS:

```bash
corepack enable
corepack prepare pnpm@9.15.9 --activate
```

`make install-requirements` enables that Corepack pin on Windows, Linux, and macOS (plus Node 22 and Go 1.23). It does not install Docker or workspace dependencies.

## End-to-end tests

Playwright BDD against a real Compose stack — not the one on `:80`. All feature files run in one `make e2e` process. Last-runs are the recorded result of the last `/e2e-docker` suite pass (id `memries`). Catalog marks follow that one finding. Host commands below need [pnpm](#pnpm).

<!-- e2e-last-runs-catalog:start -->
- ❌ **Albums** — Create, add a Photo, count survives reload. Opening an Album shows its Photos. Long-press on the Album page unmembers; the Photo stays in the library.
- ❌ **Capture time** — Newest first. EXIF DateTimeOriginal wins; no EXIF uses file time. Sync keeps favorites and album membership.
- ❌ **Empty library states** — Favorites, Search, and a new Album explain themselves when they have nothing to show.
- ❌ **Index run splash** — Folder Sync shows the Index run, then Memories. A missing Original is pruned; a relocated Photo keeps its identity.
- ❌ **Sign in** — Dex login puts the owner on Memories.
- ❌ **Long-press photo actions** — Long-press offers album rows (name left, count right). Tapping a row adds the Photo once.
- ❌ **Motion** — Open, close, granularity, and scroll move by default. Reduced motion makes them instant.
- ❌ **Library navigation** — Side nav on wide viewports, bottom bar on narrow. Re-opening Albums leaves an Album page. Today jumps to the newest Timeline Group.
- ❌ **Search** — Filter on Memories opens Search. Smart dates (`yesterday`, `last winter`, `a day in june`) plus year and favorites facets. Library clock is frozen at 26 August 2026.
- ❌ **Light and dark theme** — First visit follows the system. Toggle persists.
- ❌ **Timeline periods** — Year / month / week / day headings follow capture time. The pinned label follows the first visible Timeline Group.
- ❌ **Photo viewer gestures** — Swipe past a threshold for next/previous. A short drag snaps back. Drag down dismisses.
- ❌ **Photo viewer keyboard** — The viewer is a dialog: Escape closes, arrows move, F favorites, Tab stays inside. Close returns focus to the Photo.
- ❌ **Photo viewer** — Opens from Memories and Search. Favorite, album, next/previous, close.
<!-- e2e-last-runs-catalog:end -->

```bash
pnpm install
pnpm --filter @memries/e2e exec playwright install chromium
make e2e          # first compose build can take several minutes
make e2e-down     # stop; keep e2e volumes
make e2e-docker-force  # plan a fresh suite run
```

See [apps/e2e/README.md](apps/e2e/README.md) for reuse of a running stack, wipe, and cleanup of `.work/`. `make e2e-last-runs` fails unless the suite last-run passed.

## Layout

```
apps/backend/        Go server + indexer CLI (@memries/backend)
  cmd/server         HTTP API
  cmd/indexer        bulk import CLI
  internal/
    config           env loader
    storage          Storage interface + local impl
    db               Arango client, models, queries
    exif             EXIF extraction
    thumb            thumbnail generation (256/512/1024)
    index            walker/indexer pipeline + HTTP job coordinator
    auth             OIDC + cookie session middleware
    api              chi routes (timeline, photos, index, thumb, original)
apps/frontend/       React + Vite + Tailwind (@memries/frontend)
  src/
    components       Timeline, IndexingScreen, lightbox
    hooks            photos infinite query, index status
    lib              authenticated API client, date helpers
apps/e2e/            isolated Playwright BDD + Compose project memries-e2e
apps/scripts/        quality-shelf planners + install-requirements
deploy/
  caddy/Caddyfile    routes /api, /oauth
  dex/config.yaml    OIDC provider for dev
data/
  photos/            originals (mounted into backend)
  cache/             thumbnails (mounted into backend)
Dockerfile.frontend  turbo prune + Vite image
Dockerfile.backend   turbo prune + Go image
```

## Service topology

| Service   | Listens on (host)       | Notes                                              |
|-----------|-------------------------|----------------------------------------------------|
| caddy     | `:80`                   | Reverse proxy: `/api/*` + `/oauth/*` → backend; `/` → frontend |
| backend   | `127.0.0.1:8080`        | Go API. `extra_hosts: localhost:host-gateway` so it can reach dex at `localhost:5556` |
| frontend  | `127.0.0.1:5173`        | Nginx serving built React. Behind caddy at `/`     |
| arangodb  | `127.0.0.1:8529`        | UI/REST                                            |
| dex       | `127.0.0.1:5556`        | OIDC issuer `http://localhost:5556` (browser + backend both hit this URL) |

### URL routes via Caddy `:80`

- `/`             → frontend (built React + Tailwind)
- `/api/*`        → backend (auth required)
- `/api/index/status` → current/persisted index job for the signed-in owner
- `/api/index`    → `POST` starts (or dedupes) that owner's folder scan
- `/api/photos`   → cursor page (`limit`, opaque `cursor` → `next_cursor`; optional `year`, `favorite`, `q`)
- `/api/photos/{id}/favorite` → `PUT` `{ "favorite": true }`
- `/api/albums`   → list/create albums
- `/api/albums/{id}` → one album plus its photos
- `/api/albums/{id}/photos` → `POST` adds a photo; `DELETE /api/albums/{id}/photos/{photoId}` unmembers (does not delete the photo)
- `/oauth/login`  → backend → 302 to dex
- `/oauth/callback` → backend (cookie session set)
- `/oauth/logout` → backend

### Why dex isn't behind caddy

`docker compose` can't fully resolve the cycle (backend needs OIDC discovery at boot, caddy reverse-proxies backend → caddy depends on backend → caddy not up when backend starts). Simpler: expose dex on `:5556`, set issuer = `http://localhost:5556`, add `extra_hosts: "localhost:host-gateway"` to backend so it reaches dex via the host port mapping.

## Data model (Arango)

- `photos` — keyed by sha256, fields: `kind`, `taken_at`, `owner_id`, `storage{}`, `dims{}`, `exif{}`, `thumbs{}`
- `users` — keyed by sha1(email)
- `index_runs` — one document per owner; terminal status survives restarts
- `albums`
- Edge collections: `in_album` (album membership); schema only: `owns`, `shared_with`, `album_shared`

Indexes: persistent `taken_at`, `(owner_id, taken_at)`, unique `hash`, unique `email`, `index_runs.status`.

`GET /api/photos` sorts `(taken_at DESC, _key DESC)` and uses an opaque composite cursor so photos that share a capture time are not skipped. The handler fetches `limit + 1` (default 200, max 500) and only emits `next_cursor` when another page exists.

## Photo layout convention

The HTTP job always walks `data/photos/<signed-in-email>` — the client cannot submit a path. The CLI still accepts any prefix. Recommended layout:

```
data/photos/<owner-email>/<yyyy>/<mm>/<file>.jpg
```

Indexer accepts any prefix — pass `-prefix admin@example.com` to limit to one user.

## Local Turbo (host Node + Go)

Docker Desktop is enough for `make up`. Host `pnpm build` / `pnpm test` / `pnpm lint` need [pnpm](#pnpm) first:

```bash
pnpm install
pnpm build
pnpm test   # frontend, backend, scripts — not Playwright
```

`make e2e` still runs the isolated Playwright suite (`@memries/e2e`).

## Dev mode (without Docker)

```bash
# Start dependencies via compose
docker compose up -d arangodb dex caddy frontend

# Backend
cd apps/backend
export $(grep -v '^#' ../../.env | xargs)
export MEMRIES_ARANGO_URL=http://localhost:8529
export MEMRIES_OIDC_ISSUER=http://localhost:5556
export MEMRIES_LOCAL_ROOT=../../data/photos
export MEMRIES_CACHE_ROOT=../../data/cache
go mod tidy
go run ./cmd/server

# Frontend (in another shell)
cd apps/frontend
pnpm --filter @memries/frontend dev
```

## Troubleshooting

- **`backend ... level=ERROR msg=auth err="..."`** — OIDC discovery failed. Verify dex container running (`docker compose ps`) and `MEMRIES_OIDC_ISSUER` matches dex's `issuer:` in `deploy/dex/config.yaml`. After editing dex config: `docker compose up -d --force-recreate dex`.
- **`db password is wrong` / `not authorized to execute this request`** — `.env` was missing/changed after Arango first init. Reset: `make down-wipe && make up`.
- **`container memries-arangodb-1 is unhealthy`** — Healthcheck targets `http://127.0.0.1:8529/_admin/server/availability` (auth-free). If broken, exec into the container and run that wget yourself to see what's happening.
- **`unknown flag --build`** — Two-step instead: `docker compose build && docker compose up -d`.
- **Splash jumps to Dex** — `/api/*` is session-only. An unauthenticated first load is sent to `/oauth/login`.
- **Empty album after login** — the job only walks `data/photos/<signed-in-email>`. Drop files there, or run the CLI with `-prefix` for a one-off import.
- **Broken featured photos / `/api/original/...` errors** — the timeline uses thumbs; the viewer falls back to a thumb if the original file is gone. Replacing or renaming the folder after a first import triggers another scan on refresh. CLI fallback: `docker compose exec backend indexer -prefix <signed-in-email>`.

## Next phases

See `~/.claude/projects/-Users-mvergouwe-Projects-Memries/memory/project_photo_manager.md` for the full phased plan. Phase 2 = video; Phase 3 = S3 + WebSocket live updates; Phase 4 = sharing graph + Piwigo importer.

- [x] Wire the frontend indexing splash to the real Go indexer / photos API.
- [x] Persist albums and favorites for the signed-in owner.

## Capture time

The indexer writes a UTC instant, the original local wall clock (`taken_at_local`), and a source:

1. EXIF `DateTimeOriginal` (then digitized / `DateTime`)
2. Filesystem creation / birth time when the OS exposes it
3. File modification time

Folder **Sync** reconciles by owner + path before content hash. A file that changes in place keeps the same photo id, so favorites and album membership survive. Timeline grouping and search use `taken_at_local` (year / month / ISO Monday–Sunday week / day). The label above the list is the first visible period.
