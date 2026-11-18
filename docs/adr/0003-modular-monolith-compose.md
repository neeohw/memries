# 0003. Modular monolith on Docker Compose

- Status: Accepted
- Date: 2026-08-26
- Source type: Internal technical report ([Project_Architecture_Blueprint.md](../Project_Architecture_Blueprint.md), generated 2026-08-25 from this tree)

## Key thesis

Memries is a self-hosted **modular monolith** on Docker Compose (Go chi API, ArangoDB, Dex, Caddy, React SPA). It is not a mikepattyn platform Application, not Clean Architecture, and not a set of microservices.

## Context

The product is an owner-scoped photo library: date-scroll Memories, named Albums, thumbs from disk cache. The umbrella CDK and Authress stacks serve `mikepattyn.nl` apps. This repo needs a recorded answer to “what shape is the system?” so later work does not absorb Memries into platform hosting, split the Go module into services, or grow a second photo catalog beside Arango.

The blueprint is the source for this ADR. It inspected `go.mod`, Compose, `internal/*`, and the SPA. Prefer later ADRs and the code when they disagree with the blueprint (see Limitations).

## Decision

- **Process shape.** One Go module, two binaries: `cmd/server` (HTTP) and `cmd/indexer` (CLI). The server also runs the indexer package in-process for `POST /api/index`. Manual wiring in `main`; chi; env `MEMRIES_*`; no DI container.
- **Persistence.** ArangoDB documents (`photos`, `users`, `albums`) with owner filters in AQL. Edge collections for sharing stay schema-only until a sharing ADR. Hexagonal only at `storage.Storage` (`local` now; `s3` is a factory error until Phase 3).
- **Edge and identity.** Caddy `:80` splits `/api` and `/oauth` to the API, `/` to the SPA. Dex listens on host `:5556` (not behind Caddy) so browser and backend share issuer `http://localhost:5556`; backend uses `extra_hosts: localhost:host-gateway`. Browser authz is the `memries` cookie session, not a SPA bearer token.
- **UI.** React composition, no router library; tabs are state. Photos load through authenticated `/api` (`credentials: "include"`; 401 → `/oauth/login`). Granularity grouping stays in `groupPhotos`.
- **Hosting.** Local Compose only. No CDK stack, no K8s. Do not add Memries to `infra/cdk/` unless a later ADR says so.

### Considered options

| Option | Why not |
| ------ | ------- |
| Absorb into platform CDK / Authress | Different remote, Compose ops, Dex already in-tree |
| Next.js (or similar) full-stack | API, indexer, and thumb pipeline are already Go |
| Stay on Piwigo | The point of the rewrite |
| Postgres instead of Arango | Timeline AQL and a reserved sharing graph were the bet; swapping storage is a new ADR |
| Microservices | One operator, one library; extra network hops buy nothing in Phase 1 |

## Key findings

1. **The only real port is Storage.** `db` and `auth` are concrete types. New object stores belong behind `storage.New`; do not teach `api` about S3.
2. **ACL is query-time `owner_id`.** List/timeline AQL filters the Owner; by-id routes must still compare `OwnerID` after `GetPhoto`. Sharing must replace that filter in `db`, not in handlers.
3. **Caddy and Dex are a deliberate cycle break.** Putting Dex behind Caddy without a new issuer/discovery story will fail backend boot (`depends_on` vs OIDC discovery). That constraint is operational, not visible in Go types.
4. **The SPA talks to `/api`, not a Vite disk catalog.** `frontend/src/lib/api.ts` maps `_key` → `id` and `/api/thumb` + `/api/original`. A leftover blueprint sentence that still says “frontend data lives inside Vite” is stale.

## Methodology

Architecture detection from project files (Compose, Dockerfiles, `go.mod`, `package.json`, chi routes, AQL, Vite proxy). No runtime profile, no load test. Inferred “ADR-M*” items in the blueprint are working notes, not numbered decisions — except the stack/shape call recorded here.

## Consequences

- New features stay in `internal/<concern>` and SPA `components` / `hooks` / `lib` / `models`. Do not add `internal/services`.
- Originals go through `Storage`; thumbs stay a filesystem cache (`MEMRIES_CACHE_ROOT`) until an explicit move.
- Cookie session remains the `/api` authz mechanism. Do not put access tokens in `localStorage`.
- Photo **identity** and **TakenAt** are not defined here — see [0005](0005-capture-time-stable-identity.md). Compact thumb sizes are [0007](0007-viewport-forced-compact-thumbs.md). Clearing Arango without wiping volumes is [0006](0006-truncate-arango-for-resync.md).

## Limitations

- The blueprint mixed a first snapshot (Vite `virtual:memries-photos` / `mockApi`) with a later API-wired SPA. This ADR follows the code and blueprint §1, not the stale “inside Vite” line in §2.
- Blueprint ADR-M3 (SHA-256 as `_key` forever) is **superseded** by 0005 (path-first identity; hash is a fingerprint).
- Blueprint ADR-M4 (two independent clocks) is **refined** by 0005 (`ResolveCaptureTime` + `taken_at_local` in the UI).
- No automated architecture tests. Import rules are social.
- Source has no external peer review; it is a generated map of this repo.

## Actionable takeaways

- When adding a backend, implement `storage.Storage`; do not add a second catalog (SQLite beside Arango, or a Vite JSON library beside `/api/photos`).
- When adding a JSON route, mount it under `/api` behind session middleware and keep owner checks in `db` or on the loaded document.
- When the blueprint and a numbered ADR disagree, trust the numbered ADR, then the code.

## Quality

| Dimension   | Rating | Note |
| ----------- | ------ | ---- |
| Credibility | Medium | First-party generated report, not a locked grill |
| Evidence    | High   | Matches Compose, `cmd/server`, `lib/api.ts` |
| Recency     | High   | Source 2026-08-25; accepted 2026-08-26 |
| Objectivity | Medium | Generator enumerates inferred ADRs; some sections drifted |

**Overall:** Adequate for **stack and process shape**. Do not cite it for Photo identity, capture time, or thumb density.

## Amendment (ADR 0014, ADR 0015, ADR 0016)

The process shape in this ADR still holds — a modular monolith, two binaries on
one Go module, Caddy at the edge, hexagonal only at storage. Three of its
specifics do not, and the text above is kept as the record of what was decided
at the time rather than rewritten:

- **ArangoDB is gone.** The catalog is relational over `database/sql`, SQLite by
  default and PostgreSQL optional ([0014](0014-pluggable-sql-store.md)).
- **Dex and OIDC are gone**, and with them the whole "deliberate cycle break"
  above: there is no issuer to agree on, no discovery at boot, no
  `extra_hosts: localhost:host-gateway`, and no `depends_on` from the API to an
  identity provider. Sign-in is a local password at `POST /auth/login`, Caddy
  splits `/api` and `/auth`, and a 401 renders a form in the SPA instead of
  redirecting to `/oauth/login` ([0016](0016-local-password-auth.md)).
- **Thumbnailing has two backends**, selected by build tag
  ([0015](0015-build-tagged-thumbnail-backend.md)).

The Compose stack is now three services — backend, frontend, Caddy — with no
database container and no identity provider.

## Notable quotes

> “Memries is a modular monolith split into two runtimes that share a Go module.” ([Project_Architecture_Blueprint.md](../Project_Architecture_Blueprint.md) §1)

> “Hexagonal only at storage.” (same, §2)

## References

- Source: [docs/Project_Architecture_Blueprint.md](../Project_Architecture_Blueprint.md)
- Seams: [backend/cmd/server/main.go](../../backend/cmd/server/main.go), [backend/internal/storage/storage.go](../../backend/internal/storage/storage.go), [frontend/src/lib/api.ts](../../frontend/src/lib/api.ts)
- Ops: [docker-compose.yml](../../docker-compose.yml), [deploy/caddy/Caddyfile](../../deploy/caddy/Caddyfile) (`deploy/dex/config.yaml` was deleted by [0016](0016-local-password-auth.md))
- Capture / identity / Albums: [0005-capture-time-stable-identity.md](0005-capture-time-stable-identity.md)
