import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveE2ePlaywrightProfile } from './e2e-profile.mjs';

describe('resolveE2ePlaywrightProfile', () => {
  it('uses at most four local workers, headed, and no retries when CI is unset', () => {
    assert.deepEqual(resolveE2ePlaywrightProfile({}), {
      inCI: false,
      fullyParallel: true,
      workers: 4,
      retries: 0,
      forbidOnly: false,
      headless: false,
      trace: 'off',
      screenshot: 'off',
      reporter: 'list',
    });
  });

  it('runs one test at a time with four retries when CI is set', () => {
    assert.deepEqual(resolveE2ePlaywrightProfile({ CI: 'true' }), {
      inCI: true,
      fullyParallel: false,
      workers: 1,
      retries: 4,
      forbidOnly: true,
      headless: true,
      trace: 'on-first-retry',
      screenshot: 'only-on-failure',
      reporter: [['list'], ['github']],
    });
  });
});
