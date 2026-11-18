# 0014 — Pluggable SQL store: SQLite default, PostgreSQL optional

- Status: accepted
- Date: 2026-11-17
- Supersedes: [0006](0006-truncate-arango-for-resync.md)

## Context

Memries targets an OrangePi 3 LTS: Allwinner H6, 4x Cortex-A53, arm64, 2GB
LPDDR3, 8GB eMMC. ArangoDB is ~70% of the stack's resident memory (400MB-1GB of
RocksDB write buffers and block cache) and wants more RAM than the whole board
has to spare.

It also earns nothing. The catalog uses 23 AQL queries and every one is plain
relational: `FILTER` / `SORT` / `COLLECT` / `LIMIT`. There is no graph
traversal anywhere in the codebase — no `OUTBOUND`, no `INBOUND`. The one edge
collection, `in_album`, is used as a join table. The share edges (`owns`,
`shared_with`, `album_shared`) are schema only and have no queries at all.

A graph database with no graph, costing two thirds of the memory budget.

## Decision

Replace ArangoDB with `database/sql` over two pure-Go drivers:

- **SQLite** (`modernc.org/sqlite`) — the default and the real target.
- **PostgreSQL** (`jackc/pgx/v5/stdlib`) — opt-in, for setups larger than one
  household.

Both drivers are pure Go. `CGO_ENABLED=0` holds, so the server
cross-compiles from any dev machine with `GOOS=linux GOARCH=arm64` and no
toolchain.

Package `internal/db` keeps the model types (`Photo`, `User`, `Source`,
`Album`, `AlbumView`, `AlbumDetail`, `Bucket`, `PhotoFilter`, `IndexRun`,
`PhotoStorageRef`) because all seven consumer interfaces name them. The Arango
implementation files are replaced by SQL ones in the same package.
`db.Connect(ctx, cfg)` keeps its signature and dispatches on
`MEMRIES_DB_DRIVER`.

Queries are written once with `?` placeholders and rebound to `$1..$n` for
PostgreSQL. Only two expressions are dialect-specific: ISO year-week
bucketing, and upsert syntax.

### Why this is a small change

The backend is already interface-segregated. Consumers depend on narrow
interfaces, not on the concrete client:

| Interface | Where | Methods |
|-----------|-------|---------|
| `api.Library` | [api/library.go](../../apps/backend/internal/api/library.go) | 10 |
| `index.PhotoRepository` | [index/indexer.go](../../apps/backend/internal/index/indexer.go) | 7 |
| `sources.Repo` | [sources/registry.go](../../apps/backend/internal/sources/registry.go) | 9 |
| `index.RunStore` | [index/coordinator.go](../../apps/backend/internal/index/coordinator.go) | 3 |
| `index.OwnerPhotoCounter` | [index/coordinator.go](../../apps/backend/internal/index/coordinator.go) | 1 |
| `index.PhotoLister` | [index/library.go](../../apps/backend/internal/index/library.go) | 1 |

`*db.Client` merely happened to satisfy them. The new `*db.Store` satisfies the
same set, so `internal/api`, `internal/index` and `internal/sources` are
untouched. Only `internal/auth` and the two `cmd/` wiring sites name the
concrete type.

## Schema notes

- `in_album` edge collection becomes `album_photos(album_key, photo_key)`.
- Embedded documents (`Dims`, `EXIF`, `Thumbs`, `StoragePtr`) flatten to
  columns. EXIF columns land in this migration, not a later one, because the
  lightbox info panel ([0018](0018-google-photos-browsing.md)) reads them and
  they are already indexed today.
- `taken_at` is stored as **unix microseconds** (`BIGINT`) in both dialects.
  SQLite has no timestamp type, and an integer sorts correctly, keeps the
  composite cursor comparison exact, and leaves no timezone ambiguity.
  `taken_at_local` stays TEXT (`YYYY-MM-DDTHH:MM:SS`) because the date filters
  substring it.
- Photo dedup becomes `UNIQUE(owner_id, hash)` instead of a globally unique
  hash, which closes [p1-owner-scoped-dedup](../todos/p1-owner-scoped-dedup.md).
- Key index is `(owner_id, taken_at DESC, key DESC)`, serving the composite
  cursor as a single index scan — a better fit than the Arango index layout.

## Migrations

Embedded `.sql` files applied in order inside a transaction, tracked in
`schema_migrations`. Hand-rolled, ~40 lines, no migration library: the schema
is greenfield and fully under our control, and a dependency tree is the thing
this ADR exists to reduce.

## Consequences

- ~500MB-1GB of resident memory reclaimed; one container gone.
- The catalog is a single file, so backup is `cp`.
- 32-bit ARM becomes possible. ArangoDB publishes no armv7 image.
- `make db-clear` and `apps/scripts/clear-arango.*` are replaced. ADR 0006 no
  longer applies: resync deletes the SQLite file or truncates the tables.
- `db/cursor_test.go` and `db/photos_filter_test.go` assert on generated AQL
  strings and are replaced by behavior tests against a temp SQLite file.
- Index runs batch their writes in transactions rather than committing per
  photo, because the catalog lives on eMMC.
- PostgreSQL gets a conformance suite; SQLite gets the thorough tests. On a 2GB
  board PostgreSQL is an escape hatch, not a co-equal path.
