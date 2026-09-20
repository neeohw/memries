# 0010. Memries owns a local platform-quality shelf

- Status: Accepted
- Date: 2026-08-26
- E2e wave superseded by: [0012](0012-e2e-one-suite-two-profiles.md) (one suite run, no slices)
- Source type: Internal decision (agent orchestration)

## Key thesis

`/platform-quality` lives in this repository. Waves are page-accessibility → e2e-docker → lint → format. There is no scripts-to-node convert wave. Scripts follow a going-forward dual-shell rule instead.

## Context

ADR 0001 said not to copy global skills into this tree unless the user asks. ADR 0009 carved out `/e2e-docker` because the suite, isolation env, and findings belong here. Quality lint/format/a11y then needed the same local shelf: agents in this workspace must not leave the folder, and the umbrella's convert wave does not apply.

The umbrella still points at Memries for e2e last-runs. This repo now also sequences its own quality waves so e2e setup can land before lint/format.

## Decision

1. The skill shelf under [`.cursor/skills/`](../../.cursor/skills/) includes `page-accessibility`, `frontend-page-accessibility`, `frontend-lint`, `frontend-format`, `backend-lint`, `backend-format`, `platform-lint`, `platform-format`, `e2e-docker`, and user-invoked `platform-quality`.
2. Planning is [`apps/scripts/app-fanout/app-fanout.mjs`](../../apps/scripts/app-fanout/app-fanout.mjs) with hardcoded trees (`apps/frontend`, `apps/backend`, `apps/e2e`, `apps/scripts`). Frontend children use React/Vite/Tailwind tools. Backend children use `gofmt` / `go vet`, not dotnet.
3. Wave order: **0** page-accessibility, **1** e2e (parent `plan` → `make e2e` → `record memries`; see [0012](0012-e2e-one-suite-two-profiles.md)), **2** lint, **3** format. `/platform-quality` caps at **4** agents per lint/format/a11y wave. E2E sits before lint/format so new feature and step files get both.
4. `/e2e-docker` standalone is the same parent suite run.
5. New scripts live in `apps/scripts/<name>/` as a unit-tested Node `.mjs` plus `.sh` / `.ps1` wrappers ([`.cursor/rules/dual-shell-scripts.mdc`](../../.cursor/rules/dual-shell-scripts.mdc)). Do not add a scripts-to-node orchestrator.

## Consequences

- Opening Memries as its own workspace is enough to run `/platform-quality`.
- ADR 0001 still holds for `context-map`: that skill stays user-level. Quality orchestrators are the asked-for exception.
- The Platform umbrella must not be edited from a Memries-only change.

## Limitations

- First lint/format runs may add ESLint/Prettier configs when a tree has none.
- `deploy/` is not a platform quality tree.
- Planner path after the workspace move is `apps/scripts/app-fanout/…` (see [0011](0011-turborepo-pnpm-workspace.md)).
