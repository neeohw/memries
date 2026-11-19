# ADR 0003 — Modular monolith on Docker Compose

- Status: accepted
- Date: 2026-08-26 (revised 2026-11-18)

## Context

The product is a self-hosted photo library for one machine. It needs a
recorded answer to "what shape is the system?" so later work does not split
the Go module into services or grow a second photo catalog beside the one in
`internal/db`.

## Decision

One Go module, two binaries: `cmd/server` (HTTP) and `cmd/indexer` (CLI). The
server also runs the indexer package in process for `POST /api/index`, so
there is one indexer, not two.

Wiring is by hand in `main`: chi for routing, `MEMRIES_*` for configuration,
no DI container and no framework.

Compose runs the backend, the frontend, and Caddy in front of both. Caddy
proxies `/api/*` and `/auth/*` to the backend and everything else to the
frontend.

Hexagonal only where it earns its place: `storage.Storage` abstracts where
originals live (a local path or a WebDAV collection, [0020](0020-server-wide-library.md)).
Everything else talks to concrete types.

## Consequences

- There is no service boundary to cross, so a change that spans the API and
  the indexer is one commit and one test run.
- The catalog is `database/sql` ([0014](0014-pluggable-sql-store.md)), reached
  only through `internal/db`. Nothing else opens a connection.
- Scaling past one process is not designed for. The index coordinator holds a
  single run slot in memory, which is correct for one machine and wrong for
  two.
