# [P2] The e2e package does not typecheck

## Problem

`pnpm --filter @memries/e2e exec tsc --noEmit` reports two errors. Neither
breaks the suite, which Playwright transpiles without typechecking, so they
sit there unseen.

```text
playwright.config.ts(3,45): error TS7016: Could not find a declaration file
  for module './scripts/e2e-profile.mjs'
steps/library.steps.ts(28,49): error TS18048: 'list' is possibly 'undefined'
```

## Fix

**TS7016** — `scripts/e2e-profile.mjs` has no types. `scripts/owners.mjs` has
the same shape and was given a `.d.mts` beside it; do the same here.

**TS18048** — `originalsFor` keeps a per-`Page` `WeakMap` of `/api/original/`
request URLs. The runtime is correct: on a miss it assigns `list = []`, stores
it, then listens. But the `page.on('request')` callback does not keep the
`if (!list)` narrowing from the enclosing function, so `list.push` is illegal
under `strict`. Assign to a new const inside the branch and close over that.

## Seam

`apps/e2e/playwright.config.ts`, `apps/e2e/steps/library.steps.ts`,
`apps/e2e/tsconfig.json`.
