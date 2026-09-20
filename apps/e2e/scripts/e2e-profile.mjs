/**
 * Playwright run profile: desktop is headed with at most four workers; CI is serial.
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
    headless: false,
    trace: 'off',
    screenshot: 'off',
    reporter: 'list',
  };
}
