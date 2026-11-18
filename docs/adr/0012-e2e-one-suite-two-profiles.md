# 0012. One e2e suite, two Playwright profiles

- Status: Accepted
- Date: 2026-08-28
- Source type: Internal decision (test orchestration)
- Supersedes: [0009](0009-e2e-docker-skill-owns-isolated-stacks.md), e2e slices in [0010](0010-memries-platform-quality-shelf.md)

## Key thesis

`/e2e-docker` plans and records **one** Playwright suite against **one** Compose stack (`memries-e2e` on 18080). Locally the suite is headed and uses at most four workers. In CI it runs one test at a time. There are no per-feature stacks, slots, or worktrees.

## Context

ADR 0009 isolated each `.feature` file on the 19000 port band so four child agents could run in parallel. That cost Docker RAM, lease machinery, and sequential slices. The desktop can run the whole suite in one Playwright process. Pipelines need the opposite: serial, headless, retries.

## Amendment, 2026-11-18 — one account per worker

The consequence below once read "Local workers share one library; CI does not,
because it is serial." Sharing turned out to be worse than slow: the suite's
`After` hook calls `/api/e2e/reset`, which is owner-scoped, so one worker's
teardown dropped another worker's albums and unset its favorites mid-scenario.
A four-worker run reported 25 failures where `--workers=1` reported 1, with no
code change in between.

Each parallel worker now signs in as its own owner, listed in
[`apps/e2e/scripts/owners.mjs`](../../apps/e2e/scripts/owners.mjs) and
bootstrapped by `MEMRIES_ADMIN_EMAILS` in the e2e compose file. Slot 0 stays
`admin@example.com`, so the README, `indexer -owner` and serial CI runs talk
about the same account they always did.

This needed no second stack and no new container, because every axis the
backend keys on is already owner-scoped: dedup is `(owner_id, hash)`, Albums
Sources and `/api/e2e/reset` all take the session's key, and the index scope is
a photo folder named after the owner's email. That last one also isolates the
filesystem for free: the three scenarios that mutate fixtures on disk
(`set-exif`, `remove-photo`, `relocate-photo`) now rewrite one worker's folder,
so `prepare-fixtures` grew an `--owner` flag and a `prepare-owner` command, and
bare `prepare-fixtures` — which rebuilds every slot — is reserved for stack up.

Running more workers than there are accounts is an error with a message naming
the fix, not a silent fall back to sharing: `MEMRIES_BOOTSTRAP_PASSWORD` is the
only way an account gets a password ([0016](0016-local-password-auth.md)), so
the emails must be in the stack's environment before the suite starts.

What is still shared is the stack itself: one backend process, one SQLite file
(WAL, `busy_timeout` 10s, one connection), one thumbnail cache keyed by
owner-scoped photo key, and an index coordinator with a single run slot, so
four first-time index runs queue rather than overlap. All of that serializes
work; none of it lets one worker observe or destroy another's data.

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
- Local workers each own a library; see the amendment above. They still share
  one Compose stack, so their requests serialize through one backend.
- The Platform umbrella must not be edited from a Memries-only change.
