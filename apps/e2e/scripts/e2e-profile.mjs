/**
 * Playwright run profile: desktop runs four workers, CI runs one.
 *
 * Both are headless. A headed Chromium is a real desktop application, so the
 * window server brings it to the front when it launches, and Playwright has no
 * way to ask for a background window. Across four workers and a suite this
 * size that is a window stealing focus every few seconds — which is
 * unusable if anything else is happening on the machine.
 *
 * `pnpm test:headed` passes --headed when you actually want to watch a run.
 */
export function resolveE2ePlaywrightProfile(env = process.env) {
  const inCI = Boolean(env.CI);
  if (inCI) {
    return {
      inCI: true,
      fullyParallel: false,
      workers: 1,
      retries: 4,
      forbidOnly: true,
      headless: true,
      trace: 'on-first-retry',
      screenshot: 'only-on-failure',
      reporter: [['list'], ['github']],
    };
  }
  return {
    inCI: false,
    fullyParallel: true,
    workers: 4,
    retries: 0,
    forbidOnly: false,
    headless: true,
    trace: 'off',
    screenshot: 'off',
    reporter: 'list',
  };
}
