# App fan-out (Memries)

Shared planner assets for the Memries quality orchestrators:

- `frontend-page-accessibility` / `frontend-format` / `frontend-lint`
- `backend-format` / `backend-lint`
- `platform-format` / `platform-lint`
- `e2e-docker` (one Playwright suite on `memries-e2e`)
- `platform-quality` (umbrella; user-invoked only; max 4 agents per wave)

Planning lives in [`apps/scripts/app-fanout/app-fanout.mjs`](../../../apps/scripts/app-fanout/app-fanout.mjs) and [`apps/scripts/app-fanout/app-fanout.config.json`](../../../apps/scripts/app-fanout/app-fanout.config.json). Standalone `/e2e-docker` still uses [`apps/scripts/e2e-docker/e2e-docker.mjs`](../../../apps/scripts/e2e-docker/e2e-docker.mjs); both call the same `planE2eFeatures`.

This folder is **not** a user-facing skill. Do not trigger it. Do not invoke `platform-quality` from here.

## Assets

Children copy these only when the tree has **no** formatter or linter yet. Do not replace an existing config.

| File | Use |
| ---- | --- |
| [assets/.prettierrc](assets/.prettierrc) | JS/TS/CSS (printWidth 100, singleQuote true) |
| [assets/eslint.config.js](assets/eslint.config.js) | ESLint + Prettier; frontend children add React plugins |
