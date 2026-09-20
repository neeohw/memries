---
name: e2e-docker
description: >-
  Plans and records the Memries Playwright BDD suite against one Compose
  stack (memries-e2e). Diffs this checkout, runs make e2e in the parent
  checkout when the suite needs a run, and records last-runs id memries.
  Use when the user wants /e2e-docker, /e2e-docker --force, or the e2e
  wave of /platform-quality. Do not invoke platform-quality from here.
---

# E2E Docker

Reusable **orchestrator** for this repository. The parent plans the suite, may update coverage under `apps/e2e/` when the diff lacks it, then runs `make e2e` against `memries-e2e` and records one last-run. Do not edit `apps/frontend/` or `apps/backend/` to make a scenario pass.

Planning uses [`apps/scripts/e2e-docker/e2e-docker.mjs`](../../../apps/scripts/e2e-docker/e2e-docker.mjs). Feature blurbs for the README catalog come from [`apps/scripts/e2e-docker/e2e-features.mjs`](../../../apps/scripts/e2e-docker/e2e-features.mjs). The stack is [`apps/e2e/scripts/stack.mjs`](../../../apps/e2e/scripts/stack.mjs). Playwright local vs CI lives in [`apps/e2e/scripts/e2e-profile.mjs`](../../../apps/e2e/scripts/e2e-profile.mjs). `/platform-quality` wave **e2e** calls the same `planE2eFeatures` via [`apps/scripts/app-fanout/app-fanout.mjs`](../../../apps/scripts/app-fanout/app-fanout.mjs).

## Progress

```
Progress:
- [ ] 1. Plan (suite id memries + git diff)
- [ ] 2. Update apps/e2e/features and steps if coverage is missing
- [ ] 3. Run make e2e when launchNow is memries
- [ ] 4. Record the suite finding (commits last-runs.json and the README tag)
- [ ] 5. Summarize
```

## Defaults

- One suite, one stack (`memries-e2e` / 18080). Not one feature per Docker project
- Setup + run: add or update `apps/e2e/features` and `apps/e2e/steps` when product diffs lack coverage, then `make e2e`
- Never push. Do not edit product code under `apps/frontend/` or `apps/backend/`
- `last-runs.json` is parent-only; the executing parent commits it (and the README last-runs tag) when `record` adds `memries` or changes last-run time / lastCommit / finding. The first record drops leftover per-feature keys
- Do **not** invoke `platform-quality`
- Do **not** fan out worktrees or claim 19000-band slots
- Docker Desktop must be running. The plan skips with `docker-unavailable` when it is not
- `lastCommit` advances **only on pass**
- `/e2e-docker --force` marks the suite `needs-run` (reason `force`) and refreshes last-runs after record
- Local (no `CI`): headed, at most four workers, no retries. Pipeline (`CI=true`): headless, one worker, four retries

## 1. Plan

```
node apps/scripts/e2e-docker/e2e-docker.mjs plan
```

When the user asked to force, refresh, or prove the suite:

```
node apps/scripts/e2e-docker/e2e-docker.mjs plan --force
```

Wrappers: `./apps/scripts/e2e-docker/e2e-docker.sh plan` or `./apps/scripts/e2e-docker/e2e-docker.ps1 plan`.
Make: `make e2e-docker` or `make e2e-docker-force` (`make e2e-docker FORCE=1`).

Optional: `--force`, `--base <branch>`.

Treat `status: "needs-run"` as work. Skip `up-to-date` (`no-diff` after a passed finding) and `skipped` (`docker-unavailable`, missing path) unless the plan was forced. If `launchNow` is empty, report that (and the plan `hint` if present) and stop.

## 2. Run

When `launchNow` is `memries`:

```
make e2e
```

That is `pnpm --filter @memries/e2e test`. Playwright starts `memries-e2e` if it is not already up.

## 3. Record

Pass **and** fail. `lastCommit` is this repo's SHA and only advances on pass:

```
node apps/scripts/e2e-docker/e2e-docker.mjs record --commit <sha> --finding "{\"status\":\"passed\",\"summary\":\"80 passed\",\"composeProject\":\"memries-e2e\",\"suiteCommit\":\"<sha>\"}" memries
```

`record` refreshes the README last-runs tag and catalog, then Conventional-Commits `.cursor/skills/e2e-docker/last-runs.json` and `README.md` when `memries` is new or `recordedAt` / `lastCommit` / `finding` changed. Do not leave those files unstaged.

`status` (or `make e2e-last-runs`) exits `0` only when the suite last-run passed.

## 4. Summarize

Status, finding, compose project `memries-e2e`. Never push.

## Out of scope

- Fixing product code under `apps/frontend/` or `apps/backend/` to make a feature pass
- Infrastructure deploys
- Starting `platform-quality` from this skill
- Per-feature Compose projects or worktree fan-out
