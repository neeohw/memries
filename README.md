# Memries

<!-- e2e-last-runs-tag:start -->
[**E2E last-runs:** ❌ suite not recorded](#end-to-end-tests)
<!-- e2e-last-runs-tag:end -->

Lightweight photo manager. Replaces Piwigo. Modern UI focused on date-scroll browsing with switchable granularity (year / month / week / day).

**Stack:** pnpm + Turborepo · Go backend · SQLite (PostgreSQL optional) · React + Vite · local password auth · Caddy reverse proxy · Docker Compose.

## Status

Phase 1 (MVP) running:

- [x] Repo + Docker Compose (Caddy, backend, frontend)
- [x] Pluggable storage interface (local FS impl; S3 in Phase 3)
- [x] SQL schema with embedded migrations (photos, users, albums, sources, index runs)
- [x] Photo indexer CLI (EXIF, sha256 dedup, 3-tier thumbs)
- [x] Local password sign-in (argon2id) with a cookie session
- [x] Timeline + photos API
- [x] React timeline UI: virtual scroll, granularity toggle, lightbox
- [x] Browser-started indexing job + splash progress
- [x] Cursor-paginated photos API consumed by infinite scroll
- [x] Persisted favorites and albums, per reader
- [x] Capture time from EXIF DateTimeOriginal, then file birth time, then mtime — kept on folder sync
- [x] Playwright BDD suite against an isolated Compose stack (`make e2e`)

Not in Phase 1: video, S3 backend, WebSocket live updates, sharing graph, Piwigo importer.

## Quick start

Prereqs: Docker Desktop (Compose v2), `openssl`.

```bash
# Write .env with strong random secrets
cat > .env <<EOF
SESSION_KEY=$(openssl rand -base64 32)
BOOTSTRAP_PASSWORD=$(openssl rand -base64 12)
ADMIN_EMAILS=admin@example.com
EOF

# Drop photos into ./data/photos/... and add it as a folder
mkdir -p data/photos/admin@example.com

# Catalog directory. Create it yourself: Docker would create a missing
# bind-mount as root, and the backend image runs as uid 1000.
mkdir -p data/db data/cache

docker compose build
docker compose up -d
```

Open http://localhost and sign in as `admin@example.com` with the `BOOTSTRAP_PASSWORD` you just generated. That variable gives every `ADMIN_EMAILS` account a password on a fresh install, and only ever fills an *empty* one, so it is safe to leave in `.env` ([ADR 0016](docs/adr/0016-local-password-auth.md)). After login the splash indexes the configured **folders** and then loads photos from `/api/photos`.

Admins (`MEMRIES_ADMIN_EMAILS`) get a gear icon holding **Folders** and **Storage** ([0024](docs/adr/0024-admin-area.md)). Folders feed the one shared library:

| Kind | Location example | Notes |
|------|------------------|-------|
| On this server | `/data/photos/family` | Must sit under `MEMRIES_LOCAL_ROOT` or a `MEMRIES_SOURCE_ROOTS` entry; mount host dirs into the backend container. NFS: mount on the host, add as a server folder. |
| WebDAV | `https://cloud.example.com/remote.php/dav/files/me/Photos` | Nextcloud, ownCloud, Synology, … |

Originals stay where they are and are streamed through the backend; thumbs are always generated into the local thumbnail folder. The connection is checked before a folder is saved. Folder passwords are AES-GCM sealed in the catalog with a key derived from `MEMRIES_SESSION_KEY` (rotating it means re-entering folder passwords).

### Thumbnail folder

The gear → **Storage** moves the thumbnail cache without editing env or restarting
([0022](docs/adr/0022-admin-settings-thumbnail-location.md)) — the point of
it on a Pi, where 8GB of eMMC does not hold a 12k-photo ladder. The page shows
the free space on the holding filesystem.

Unset, the cache follows XDG: `$CACHE_DIRECTORY` when systemd provides it
(`/var/cache/memries` for a system unit), else `$XDG_CACHE_HOME/memries`, else
`~/.cache/memries`. The page names that default whenever something else is in
use.

A folder must be absolute, writable by the server, inside
`MEMRIES_CACHE_ROOTS` (the default root's parent is always allowed), and
neither inside nor containing a photo folder — a cache under a Source would be
indexed as photos by the next scan.

Moving does not carry the existing thumbnails: they stay in the old folder and
a scan regenerates them in the new one. Clearing the field restores
`MEMRIES_CACHE_ROOT`.

The CLI remains an idempotent fallback (hash skip unless `-force`):

```bash
docker compose exec backend indexer                       # every folder
docker compose exec backend indexer -source 123           # one folder id
```

Libraries already populated by the CLI are treated as a completed initial import and are not re-scanned automatically.

To empty the catalog (photos, albums, index runs, users) and re-test folder **Sync** — including capture time from EXIF, file created, or last modified — without deleting `./data/photos` or Docker volumes:

```bash
make db-clear
```

That deletes the SQLite catalog file (plus its `-wal` / `-shm` siblings) and restarts the API so the in-memory index job is dropped. Refresh the app; the splash re-indexes. It also removes the `users` rows, so the next start re-applies `BOOTSTRAP_PASSWORD` and you sign in again.

`make down-wipe` is the heavier reset: it deletes Compose volumes. Photos and thumbs are bind mounts, so neither command touches `./data/photos` or `./data/cache`.

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

`make install-requirements` enables that Corepack pin on Windows, Linux, and macOS (plus Node 22 and Go 1.26). It does not install Docker or workspace dependencies.

## End-to-end tests

Playwright BDD against a real Compose stack — not the one on `:80`. All feature files run in one `make e2e` process. Last-runs are the recorded result of the last `/e2e-docker` suite pass (id `memries`). Catalog marks follow that one finding. Host commands below need [pnpm](#pnpm).

<!-- e2e-last-runs-catalog:start -->
- ❌ **Albums** — Create, add a Photo, count survives reload. Opening an Album shows its Photos. Long-press on the Album page unmembers; the Photo stays in the library.
- ❌ **Capture time** — Newest first. EXIF DateTimeOriginal wins; no EXIF uses file time. Sync keeps favorites and album membership.
- ❌ **Empty library states** — Favorites and a new Album explain themselves when they have nothing to show.
- ❌ **Index run splash** — Folder Sync shows the Index run, then Memories. A missing Original is pruned; a relocated Photo keeps its identity.
- ❌ **Sign in** — The password form puts the reader on Memories.
- ❌ **Long-press photo actions** — Long-press offers album rows (name left, count right). Tapping a row adds the Photo once.
- ❌ **Motion** — Open, close, granularity, and scroll move by default. Reduced motion makes them instant.
- ❌ **Library navigation** — Side nav on wide viewports, bottom bar on narrow. Re-opening Albums leaves an Album page. Today jumps to the newest Timeline Group.
- ❌ **Light and dark theme** — First visit follows the system. Toggle persists.
- ❌ **Timeline periods** — Year / month / week / day headings follow capture time. The pinned label follows the first visible Timeline Group.
- ❌ **Photo viewer gestures** — Swipe past a threshold for next/previous. A short drag snaps back. Drag down dismisses.
- ❌ **Photo viewer keyboard** — The viewer is a dialog: Escape closes, arrows move, F favorites, Tab stays inside. Close returns focus to the Photo.
- ❌ **Photo viewer** — Opens from Memories. Favorite, album, next/previous, close.
- ❌ **HEIC** — Indexed and browsable, with capture time and orientation read from the container ([0025](docs/adr/0025-heic-and-the-cgo-indexer.md), [0026](docs/adr/0026-heic-capture-time-and-orientation.md)). The viewer opens a 2048px JPEG rendition, since Chrome and Firefox cannot display the original.
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
    db               SQL store, models, queries, embedded migrations
    exif             EXIF extraction
    thumb            thumbnail generation (256/512/1024)
    index            walker/indexer pipeline + HTTP job coordinator
    auth             password hashing, sign-in, rate limiting, cookie session
    api              chi routes (timeline, photos, index, thumb, original)
apps/frontend/       React + Vite + Tailwind (@memries/frontend)
  src/
    components       Timeline, IndexingScreen, lightbox
    hooks            photos infinite query, index status
    lib              authenticated API client, date helpers
apps/e2e/            isolated Playwright BDD + Compose project memries-e2e
apps/scripts/        quality-shelf planners + install-requirements
deploy/
  caddy/Caddyfile    routes /api, /auth
data/
  photos/            originals (mounted into backend)
  cache/             thumbnails (mounted into backend)
  db/                SQLite catalog (mounted into backend)
Dockerfile.frontend  turbo prune + Vite image
Dockerfile.backend   turbo prune + Go image
```

## Service topology

| Service   | Listens on (host)       | Notes                                              |
|-----------|-------------------------|----------------------------------------------------|
| caddy     | `:80`                   | Reverse proxy: `/api/*` + `/auth/*` → backend; `/` → frontend |
| backend   | `127.0.0.1:8080`        | Go API. Also owns the catalog file at `/data/db`    |
| frontend  | `127.0.0.1:5173`        | Nginx serving built React. Behind caddy at `/`     |

Three services, no database container and no identity provider: the catalog is a
file ([ADR 0014](docs/adr/0014-pluggable-sql-store.md)) and sign-in is local
([ADR 0016](docs/adr/0016-local-password-auth.md)).

### URL routes via Caddy `:80`

- `/`             → frontend (built React + Tailwind)
- `/api/*`        → backend (auth required)
- `/api/index/status` → the current or last index run
- `/api/index`    → `POST` starts (or dedupes) a folder scan
- `/api/photos`   → cursor page (`limit`, opaque `cursor` → `next_cursor`; optional `year`, `favorite`, `q`)
- `/api/photos/{id}/favorite` → `PUT` `{ "favorite": true }`
- `/api/albums`   → list/create albums
- `/api/albums/{id}` → one album plus its photos
- `/api/albums/{id}/photos` → `POST` adds a photo; `DELETE /api/albums/{id}/photos/{photoId}` unmembers (does not delete the photo)
- `POST /auth/login`  → backend, sets the cookie session. Takes `login` + `password` as JSON or as a form
- `POST /auth/logout` → backend, expires the cookie

Sign-in sits outside `/api` deliberately: the session middleware guards `/api`,
and you cannot be asked for a session in order to get one. Failed sign-ins are
rate limited per address *and* per account, and every failure answers with the
same message so the form cannot be used to discover which addresses exist.

## Data model

One SQLite file by default, or PostgreSQL via `DB_DRIVER=postgres`
([ADR 0014](docs/adr/0014-pluggable-sql-store.md)). Schema lives in
`apps/backend/internal/db/migrations/`, embedded in the binary and applied at
start-up.

- `photos` — `key` is normally the content sha256, plus `taken_at`, `taken_at_local`, `storage_*`, `dims_*`, EXIF columns, `thumb_*`. No owner: the library is server-wide
- `users` — `key` is sha1(email), plus `password_hash` (argon2id, never serialised)
- `favorites` — `(user_key, photo_key)`; a heart belongs to the reader who pressed it
- `albums` and `album_photos` — the membership join table
- `sources` — admin-managed folders, with sealed credentials
- `index_runs` — one row, keyed `library`; terminal status survives restarts

Timestamps are unix **microseconds** in `BIGINT`: SQLite has no timestamp type,
and integers sort correctly and keep the composite cursor exact.

Indexes: `(taken_at DESC, key DESC)` for the cursor, unique `hash` (one copy
of a file in the library), `storage_path`, `taken_at_local`,
`favorites(user_key)`, `albums(owner_id)`, unique `email`.

`GET /api/photos` sorts `(taken_at DESC, _key DESC)` and uses an opaque composite cursor so photos that share a capture time are not skipped. The handler fetches `limit + 1` (default 200, max 500) and only emits `next_cursor` when another page exists.

## Photo layout convention

An Index run walks every folder (Source) — the client never submits a path; only admins add folders, and they are server-wide. Photo storage paths are `<source id>/<path inside the folder>`. Unchanged files (same size + mtime) are skipped without re-reading, so re-scans of network folders are cheap. A folder that cannot be reached is reported as an error and its photos are kept, not pruned.

Accepted media extensions: `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`.

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
# Start the edge and the frontend via compose
docker compose up -d caddy frontend

# Backend
cd apps/backend
export $(grep -v '^#' ../../.env | xargs)
export MEMRIES_SESSION_KEY=$SESSION_KEY
export MEMRIES_BOOTSTRAP_PASSWORD=$BOOTSTRAP_PASSWORD
export MEMRIES_ADMIN_EMAILS=admin@example.com
export MEMRIES_DB_DSN=../../data/db/memries.db
export MEMRIES_LOCAL_ROOT=../../data/photos
# Optional. Unset, thumbnails follow XDG: $CACHE_DIRECTORY (set by systemd's
# CacheDirectory=), else $XDG_CACHE_HOME/memries, else ~/.cache/memries.
export MEMRIES_CACHE_ROOT=../../data/cache
# Optional: extra folders an admin may move the thumbnail cache to.
# export MEMRIES_CACHE_ROOTS=/media/sdhc
go mod tidy
go run ./cmd/server

# Frontend (in another shell)
cd apps/frontend
pnpm --filter @memries/frontend dev
```

## Building for the box

Compose is for development. The box runs the two binaries directly
([0025](docs/adr/0025-heic-and-the-cgo-indexer.md)):

```bash
make build-pi            # -> dist/pi/server, dist/pi/indexer
```

| binary | build | needs on the box |
| --- | --- | --- |
| `server` | pure Go, `CGO_ENABLED=0`, static | nothing |
| `indexer` | cgo, `-tags vips`, dynamic | `apt install libvips42t64` |

The indexer is cgo because HEIC needs native decode — pure Go measured
4.6–24.7s per 12MP frame on an A53 against ~0.8s native. It is built inside a
`debian:trixie` container so glibc and the libvips soname match the box by
construction; on an arm64 Mac that runs natively, with no emulation. **Use
the same Debian release as the box**: building on a newer one links a newer
glibc and fails there.

Docker is needed for the indexer only — `build-pi --server-only` skips it.
`build-pi --help` lists `--platform`, `--out`, `--go-version` and
`--keep-debug`. The same recipe builds from source on the box itself:
`apt install libvips-dev` and `go build -tags vips ./cmd/indexer`.

## Troubleshooting

- **`level=ERROR msg="auth bootstrap"`** — `MEMRIES_BOOTSTRAP_PASSWORD` is set but `MEMRIES_ADMIN_EMAILS` is empty, so there is no account to apply it to. Set `ADMIN_EMAILS` in `.env`.
- **`MEMRIES_SESSION_KEY must be base64-encoded, at least 32 bytes`** — regenerate with `openssl rand -base64 32`. Rotating it invalidates sessions and requires re-entering folder passwords.
- **Sign-in says the login and password did not match, and you are sure they do** — bootstrap only fills an *empty* password, so a password set earlier still applies. `make db-clear` clears the users and re-applies the variable.
- **`too many sign-in attempts`** — the per-address and per-account limiter allows eight attempts, then one more every 30 seconds. A successful sign-in clears it; so does restarting the backend, since the buckets are in memory.
- **`unknown flag --build`** — Two-step instead: `docker compose build && docker compose up -d`.
- **The app shows the sign-in form instead of photos** — `/api/*` is session-only, and a 401 from `/api/me` is what renders the form. If it says it could not reach the server instead, the backend is down rather than the session being missing.
- **Empty album after login** — the Owner has no folders yet. An admin adds one under the gear → **Folders** (or drop files into `data/photos/<signed-in-email>` before first login).
- **Broken featured photos / `/api/original/...` errors** — the timeline uses thumbs; the viewer falls back to a thumb if the original file is gone. Replacing or renaming the folder after a first import triggers another scan on refresh. Admins can also press **Scan now** on a folder. CLI fallback: `docker compose exec backend indexer`.

## Next phases

Phase 2 = video; Phase 3 = S3 + WebSocket live updates; Phase 4 = sharing graph + Piwigo importer. Decisions are recorded in [docs/adr/](docs/adr/).

- [x] Wire the frontend indexing splash to the real Go indexer / photos API.
- [x] Persist albums and favorites for the signed-in owner.

## Capture time

The indexer writes a UTC instant, the original local wall clock (`taken_at_local`), and a source:

1. EXIF `DateTimeOriginal` (then digitized / `DateTime`)
2. Filesystem creation / birth time when the OS exposes it
3. File modification time

Pressing **Scan now** shows live progress on the Folders page — file counts while it walks, then what was added, unchanged and unreadable ([0023](docs/adr/0023-scan-progress.md)).

Folder **Sync** reconciles by owner + path before content hash. A file that changes in place keeps the same photo id, so favorites and album membership survive. Timeline grouping uses `taken_at_local` (year / month / ISO Monday–Sunday week / day). The label above the list is the first visible period.
