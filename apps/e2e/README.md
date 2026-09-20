# Isolated Playwright BDD

Real-stack browser tests against a **separate** Compose project (default `memries-e2e` on `18080`). They do not share ports or volumes with `make up`. All feature files run in one Playwright process.

Locally (no `CI`) Playwright is headed and uses at most four workers. In a pipeline (`CI=true`) it is headless, one worker, four retries.

## First run

1. Docker Desktop (Compose v2) running.
2. App `.env` present (same secrets as local dev: `ARANGO_PASSWORD`, `OIDC_CLIENT_SECRET`, `SESSION_KEY`).
3. Chromium for Playwright, once per machine:

```bash
pnpm install
pnpm --filter @memries/e2e exec playwright install chromium
```

4. The first `docker compose` build of backend + frontend is slow (often several minutes). Playwright waits up to 3 minutes for http://localhost:18080. If that is tight on a cold machine, start the stack yourself, then re-run tests (non-CI reuses an already-listening server):

```bash
pnpm --filter @memries/e2e run stack:up
pnpm --filter @memries/e2e test
```

`make e2e` from the app root is the same as `pnpm --filter @memries/e2e test`.
`make e2e-docker` plans the suite; `make e2e-docker-force` marks it `needs-run` so `/e2e-docker --force` can refresh last-runs.
What the suite proves — and whether its last-run passed — is on the [main README](../../README.md#end-to-end-tests). `make e2e-last-runs` fails unless that last-run is green.

Login is Dex `admin@example.com` / `password`. Fixture JPEGs live in `apps/e2e/.work/photos/admin@example.com/` and are regenerated before every `stack:up`.

## Cleanup

```bash
make e2e-down
# or: pnpm --filter @memries/e2e run stack:down
```

That stops containers and keeps named volumes (`arango_e2e_data`, and so on). To wipe volumes:

```bash
pnpm --filter @memries/e2e run stack:wipe
```

`.work/` photos/cache/generated Dex, `.features-gen/`, and `node_modules/` are gitignored. This does not touch `./data/photos` from the developer stack.

## Optional: one feature file

```bash
MEMRIES_E2E_FEATURE=timeline.feature pnpm --filter @memries/e2e test
```

That still uses the `memries-e2e` stack. It does not start a second Compose project.
