# Isolated Playwright BDD

Real-stack browser tests against a **separate** Compose project (default `memries-e2e` on `18080`). They do not share ports or volumes with `make up`. All feature files run in one Playwright process.

Locally (no `CI`) Playwright uses at most four workers. In a pipeline (`CI=true`) it is one worker with four retries. Both are headless; `pnpm test:headed` opens real windows when you want to watch a run.

## First run

1. Docker Desktop (Compose v2) running.
2. App `.env` present (same secrets as local dev: `SESSION_KEY`, and `BOOTSTRAP_PASSWORD` if you want a password other than the suite default).
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

Every account's password is `password`: the e2e Compose file pins `MEMRIES_BOOTSTRAP_PASSWORD` to that literal so the suite's `signIn` has a known credential ([ADR 0016](../../docs/adr/0016-local-password-auth.md)).

Each parallel worker signs in as its own owner, so the workers cannot see or clear each other's data ([ADR 0012](../../docs/adr/0012-e2e-one-suite-two-profiles.md)). The accounts are listed in [`scripts/owners.mjs`](scripts/owners.mjs) and bootstrapped by `MEMRIES_ADMIN_EMAILS`; worker 0 is `admin@example.com`, so a one-worker run behaves exactly as before. Fixture JPEGs live in `apps/e2e/.work/photos/<owner>/`, one folder per account, and are all regenerated before every `stack:up`. Inside a scenario use `prepare-fixtures prepare-owner`, which rebuilds only the calling worker's folder.

## Cleanup

```bash
make e2e-down
# or: pnpm --filter @memries/e2e run stack:down
```

That stops containers and keeps named volumes (`caddy_e2e_data`, and so on). To wipe volumes:

```bash
pnpm --filter @memries/e2e run stack:wipe
```

`.work/` photos/cache/db, `.features-gen/`, and `node_modules/` are gitignored. This does not touch `./data/photos` from the developer stack.

## Optional: one feature file

```bash
MEMRIES_E2E_FEATURE=timeline.feature pnpm --filter @memries/e2e test
```

That still uses the `memries-e2e` stack. It does not start a second Compose project.
