# ADR 0014 — Pluggable SQL store: SQLite default, PostgreSQL optional

- Status: accepted
- Date: 2026-11-17 (revised 2026-11-18)

## Context

Memries targets an OrangePi 3 LTS: Allwinner H6, 4× Cortex-A53, arm64, 2GB
LPDDR3, 8GB eMMC. The catalog has to fit a board where memory is the scarce
resource, and every query it runs is plainly relational — filter, sort,
group, limit. There is no graph traversal anywhere in the product.

## Decision

The catalog is `database/sql` over two pure-Go drivers:

- **SQLite** (`modernc.org/sqlite`) — the default and the real target.
- **PostgreSQL** (`jackc/pgx/v5/stdlib`) — opt-in, for setups larger than one
  household.

Both are pure Go, so `CGO_ENABLED=0` holds and the server cross-compiles to
`linux/arm64` and `linux/arm` from any dev machine with no toolchain. That
constraint is the reason for the driver choice, not an accident of it.

`internal/db` owns the model types and the SQL. `db.Connect(ctx, cfg)`
dispatches on `MEMRIES_DB_DRIVER`. Queries are written once with `?`
placeholders and rebound to `$1..$n` for PostgreSQL; only two expressions are
dialect-specific, ISO year-week bucketing and upsert syntax.

Consumers depend on narrow interfaces — `api.Library`,
`index.PhotoRepository`, `sources.Repo`, `index.RunStore` — not on the
concrete store, so the storage decision stays inside one package.

## Schema notes

- Embedded structs (`Dims`, `EXIF`, `Thumbs`, `StoragePtr`) flatten to
  columns.
- `taken_at` is **unix microseconds** in `BIGINT` in both dialects. SQLite has
  no timestamp type, and an integer sorts correctly, keeps the composite
  cursor comparison exact ([0004](0004-cursor-paginated-photos.md)) and leaves
  no timezone ambiguity. Negative values are ordinary — scanned film carries
  pre-epoch EXIF. `taken_at_local` stays TEXT because the date filters
  substring it.
- Album membership is a join table, `album_photos(album_key, photo_key)`.
- The hot index is `(taken_at DESC, key DESC)`, which serves the timeline
  cursor as one index scan.

## Migrations

Embedded `.sql` applied in order inside a transaction, tracked in
`schema_migrations`. Hand-rolled, no migration library: a dependency tree is
the thing this ADR exists to reduce.

While the product is pre-release the schema is edited in place rather than
migrated, and a changed schema means deleting the catalog and reindexing
([0020](0020-server-wide-library.md)).

## Consequences

- The catalog is a single file, so a backup is `cp`.
- 32-bit ARM is possible.
- Index runs batch their writes in transactions rather than committing per
  photo, because the catalog lives on eMMC.
- PostgreSQL gets a conformance suite; SQLite gets the thorough tests. On a 2GB
  board PostgreSQL is an escape hatch, not a co-equal path. **That suite does
  not exist yet, and the PostgreSQL path has never run.**
