# 0012. One e2e suite, two Playwright profiles

- Status: Accepted
- Date: 2026-08-28
- Source type: Internal decision (test orchestration)
- Supersedes: [0009](0009-e2e-docker-skill-owns-isolated-stacks.md), e2e slices in [0010](0010-memries-platform-quality-shelf.md)

## Key thesis

`/e2e-docker` plans and records **one** Playwright suite against **one** Compose stack (`memries-e2e` on 18080). Locally the suite is headed and uses at most four workers. In CI it runs one test at a time. There are no per-feature stacks, slots, or worktrees.

## Context

ADR 0009 isolated each `.feature` file on the 19000 port band so four child agents could run in parallel. That cost Docker RAM, lease machinery, and sequential slices. The desktop can run the whole suite in one Playwright process. Pipelines need the opposite: serial, headless, retries.

## Decision

1. One Compose project, `memries-e2e`, default host ports 18080–18081 / 15173 / 18529 / 15556. `make e2e` is the only suite entry. `MEMRIES_E2E_FEATURE` remains an optional filter, not an isolation path.
2. Playwright profile comes from `process.env.CI` via [`apps/e2e/scripts/e2e-profile.mjs`](../../apps/e2e/scripts/e2e-profile.mjs):
   - No `CI`: headed, `workers: 4`, `fullyParallel: true`, `retries: 0`, no trace/screenshot.
   - `CI=true`: headless, `workers: 1`, `fullyParallel: false`, `retries: 4`, `forbidOnly`, reporter `list` + `github`, `trace: 'on-first-retry'`, `screenshot: 'only-on-failure'`.
3. `/e2e-docker` is parent-only in this checkout: `plan` (dry JSON) → optional coverage under `apps/e2e/` → `make e2e` → `record memries`. No child agents, no merge/close of feature worktrees.
4. last-runs has one id `memries`. The first `record` drops leftover per-feature keys. `lastCommit` advances only on pass. README tag is one suite line; the catalog keeps feature blurbs and marks them from that finding.
5. `/platform-quality` wave **e2e** is the same parent flow. After it, `--wave 2` (lint). No `--wave 1.2`. Lint/format/a11y still fan out (cap 4).
6. `--force` marks the suite `needs-run`. Docker Desktop must be running or the plan skips with `docker-unavailable`.

## Consequences

- Opening Memries as its own workspace is enough to plan, run, and record the suite.
- Local workers share one library; CI does not, because it is serial.
- The Platform umbrella must not be edited from a Memries-only change.
