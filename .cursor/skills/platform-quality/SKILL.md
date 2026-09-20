---
name: platform-quality
description: >-
  User-invoked umbrella only. Sequences page accessibility, then e2e-docker
  (one suite run), then lint, then format across the Memries frontend,
  backend, e2e, and scripts trees. One agent per dirty tree for a11y/lint/format
  (max 4 per wave). The e2e wave is parent-only: plan → make e2e → record
  memries. Use only when the user typed /platform-quality or asked to run all
  quality workflows. Never start this skill from frontend-format, frontend-lint,
  e2e-docker, or any other orchestrator.
---

# Platform quality (Memries)

Reusable **umbrella orchestrator**. This skill does **not** format, lint, audit, or run the suite itself except the e2e wave, which the parent runs. It plans every nested skill, launches **one wave at a time**, merges successful branches into the **current local branch**, closes each opened worktree, records last-runs (and commits each nested `last-runs.json` when an entry is added or last-run time changes), then plans the next wave.

**User-invoked only.** Start this skill only when the current user message called `/platform-quality` (or this skill by name). Atomic orchestrators must never launch it.

Planning uses [`apps/scripts/app-fanout/app-fanout.mjs`](../../../apps/scripts/app-fanout/app-fanout.mjs) (`--skill platform-quality`). The script reads the current branch and puts it on every `launchNow` row as `baseBranch`. Pass that through to every child as `{{BASE_BRANCH}}`. Each nested skill diffs that tree (or the e2e suite) from its last recorded commit to the current tip. Empty `launchNow` means no diff — skip the wave.

New scripts follow the dual-shell Cursor rule.

## Progress

```
Progress:
- [ ] 1. Confirm the user invoked this skill directly
- [ ] 2. Plan the current wave (re-plan after each merge)
- [ ] 3. a11y/lint/format: fan out one agent per launchNow row (max 4). e2e: parent runs make e2e
- [ ] 4. Merge child branches into baseBranch (a11y/lint/format only)
- [ ] 5. Close each opened worktree (nested `close --skill …`; `--base-worktree` after the wave)
- [ ] 6. Record each nested skill using that branch's new SHA (commits last-runs.json)
- [ ] 7. Next wave, or stop if deferred / empty
- [ ] 8. Summarize
```

## Waves (never combine steps)

Same-tree lint and format must not run in parallel. E2E setup runs before lint/format so new `apps/e2e/` files get both.

1. **page-accessibility** — `frontend-page-accessibility` only
2. **e2e** — `e2e-docker` only: parent `plan` → (coverage if needed) → `make e2e` → `record memries`. No children, no slices
3. **lint** — `frontend-lint` + `backend-lint` + `platform-lint`
4. **format** — `frontend-format` + `backend-format` + `platform-format`

Re-run `plan --skill platform-quality --wave <n>` after each wave's merges so diffs see the new `baseBranch` tip. After page-accessibility merges: `--wave 1` (e2e). After the suite is recorded: `--wave 2` (lint). After lint merges: `--wave 3` (format).

## Defaults

- Cap **4** agents per a11y/lint/format wave. E2E is one parent run
- Task `description` = plan `agentName` (`frontend-page-accessibility-frontend`)
- `best-of-n-runner`, `environment: local`, background when two or more
- Do not poll. End the turn after launch
- Never push
- `last-runs.json` files are parent-only; record per nested skill, never `--skill platform-quality`. `record` commits that file when an entry is added or last-run time changes
- Children close their worktree with `close --here` before they return (keeps the branch). The parent always runs nested `close --skill` after merge or failure
- E2E may edit `apps/e2e/` only. `lastCommit` advances only on pass

## Parent checkout (do not move it)

- The parent checkout **never** `git checkout`s a child `worktreeBranch`.
- The parent **never** `git reset --hard`.
- Children work only in the isolated `best-of-n-runner` worktree. They never run git in the parent path.
- After launch, the parent stays on the plan `baseBranch` until it merges.
- After every child (success or fail), close that worktree. After the wave, close `.worktrees/<baseBranch>` if you created it.

## 1. Plan

```
node apps/scripts/app-fanout/app-fanout.mjs plan --skill platform-quality --wave 0
```

After page-accessibility merges: `--wave 1` (e2e). After the suite is recorded: `--wave 2` (lint). After lint merges: `--wave 3` (format).

Optional: `--force`, repeatable `--app <id>`, `--base <branch>` (default is the current checkout).

When the user asked to force, refresh, or prove every quality wave, pass `--force` on each `plan` so skipped `no-diff` rows run again — including the e2e suite — and last-runs refresh after record.

If the current wave's `launchNow` is empty (`no-diff` / skipped), skip to the next wave. If every remaining wave is empty, stop.

## 2. Fan out (a11y / lint / format)

- One Task per `launchNow` row, one message, never more than 4
- Fill the **nested skill's** agent prompt including `{{BASE_BRANCH}}` from the plan
- Link each agent as `[agentName](id)`

## 2b. E2E wave (parent)

Follow [e2e-docker](../e2e-docker/SKILL.md). Do not launch a child. If `launchNow` is `memries`, update coverage if needed, run `make e2e`, then record:

```
node apps/scripts/app-fanout/app-fanout.mjs record --skill e2e-docker --commit <base-sha> --finding "{\"status\":\"passed\",\"summary\":\"80 passed\",\"composeProject\":\"memries-e2e\",\"suiteCommit\":\"<sha>\"}" memries
```

Record pass **and** fail. `lastCommit` only advances on pass.

## 3. Merge, close, then record (a11y / lint / format)

Merge `worktreeBranch` into the plan `baseBranch`. If this checkout is still on that branch and merge-clean, merge here. Otherwise `git worktree add .worktrees/<baseBranch> <baseBranch>` and merge there.

Then close the worktree that child opened — success or fail, merged or not — using the **nested** skill:

```
node apps/scripts/app-fanout/app-fanout.mjs close --skill frontend-page-accessibility frontend
```

After the last child of the wave, if you created `.worktrees/<baseBranch>` for merges:

```
node apps/scripts/app-fanout/app-fanout.mjs close --skill frontend-page-accessibility --base-worktree
```

Then record the **nested** skill with that branch's new SHA:

```
node apps/scripts/app-fanout/app-fanout.mjs record --skill frontend-page-accessibility --commit <base-sha> frontend
```

`record` Conventional-Commits **only** that nested skill's `last-runs.json` when an id is new or `recordedAt` / `lastCommit` / `finding` changed. Do not leave the file unstaged. Do not record the umbrella. Do not record quality-wave failures except the e2e wave, which records pass **and** fail findings.

## 4. Summarize

Per wave: launched, merged, closed worktrees, deferred, skipped empty (`no-diff`), failures. Never push.

## Out of scope

- Starting this skill unless the user invoked it
- Combining lint and format in one child
- Infrastructure deploys
- Per-feature e2e stacks or `--wave 1.2` slices
