# 0009. e2e-docker skill owns isolated stacks

- Status: Superseded
- Date: 2026-08-26
- Superseded by: [0012](0012-e2e-one-suite-two-profiles.md)
- Source type: Internal decision (test orchestration)

## Key thesis

`/e2e-docker` lives in this repository. One feature file gets one Compose project on the 19000 port band. Last-run findings are recorded here. The Platform umbrella points at this skill; it does not keep a second last-runs file.

## Context

Playwright BDD under `e2e/` needs a second stack so `make up` on 18080 stays free. A Platform prototype planned features from the umbrella and treated Memries as a gitlink. That forced empty-gitlink clones, an overlay of uncommitted isolation files, and last-runs commits in the wrong repo.

ADR 0001 said not to copy a global skill into this tree. That still holds for `context-map`. This orchestrator is different: the suite, the isolation env, and the findings belong here, and agents in this workspace must not leave the folder.

## Decision

1. The skill shelf is [`.cursor/skills/e2e-docker/`](../../.cursor/skills/e2e-docker/). Plan, record, and close run as `node apps/scripts/e2e-docker/e2e-docker.mjs`. `/platform-quality` wave 1 uses the same `planE2eFeatures` via `apps/scripts/app-fanout/app-fanout.mjs`.
2. Isolation is `MEMRIES_E2E_PROJECT`, `MEMRIES_E2E_FEATURE`, and the `*_HOST_PORT` band starting at 19000. Defaults in `apps/e2e/scripts/stack.mjs` stay on `memries-e2e` / 18080 for `make e2e`. Fan-out caps at **4** stacks at a time (stride 20): slots `19000–19004`, `19020–19024`, `19040–19044`, `19060–19064`. Machine-wide leases in `apps/e2e/scripts/e2e-slots.mjs` give each running stack exclusive ownership of one slot. Remaining features run as sequential slices **1.1**, **1.2**, **1.3**, … — never in parallel. `plan` returns empty `launchNow` while any prior slot is still held. Children do not wait or poll for a claimed slot. Each slice reuses the 19000 band after the previous stacks are down and their leases are released.
3. Children may author or update `apps/e2e/features` and `apps/e2e/steps` for that feature, then run it. They never edit `apps/frontend/` or `apps/backend/`. The parent merges `apps/e2e/` commits even when the run failed so lint/format can see the setup.
4. `lastCommit` is this repo's SHA and only advances when the finding passed.
5. The Platform umbrella may reference this path and record into this `last-runs.json`.
6. `--force` re-runs every discovered feature (still one stack each), including passed `no-diff` rows, and records last-runs again.

## Consequences

- Opening Memries as its own workspace is enough to run `/e2e-docker`.
- A checked-out gitlink is enough for the umbrella to plan; it must not write last-runs into the umbrella tree.
- Children may change `e2e/` coverage for that feature. Product fixes under `frontend/` or `backend/` are a later chat.
