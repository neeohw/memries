import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  decideE2eFeatureStatus,
  discoverE2eFeatures,
  e2eDiffPaths,
  featureId,
  featureRelPath,
  parseWaveArg,
} from './e2e-features.mjs';

const localSuite = {
  id: 'memries',
  path: '',
  featuresDir: 'apps/e2e/features',
  gitlink: false,
};

const umbrellaSuite = {
  id: 'memries',
  path: 'apps/memries',
  featuresDir: 'e2e/features',
  gitlink: true,
};

describe('featureRelPath', () => {
  it('uses the features dir when the suite is the repo root', () => {
    assert.equal(featureRelPath('', 'e2e/features'), 'e2e/features');
    assert.equal(featureRelPath('.', 'e2e/features'), 'e2e/features');
  });

  it('prefixes a nested suite path', () => {
    assert.equal(featureRelPath('apps/memries', 'e2e/features'), 'apps/memries/e2e/features');
  });
});

describe('featureId', () => {
  it('joins suite and feature stem', () => {
    assert.equal(featureId('memries', 'timeline.feature'), 'memries-timeline');
    assert.equal(featureId('memries', 'viewer-keyboard.feature'), 'memries-viewer-keyboard');
  });
});

describe('discoverE2eFeatures', () => {
  it('emits one row per feature file at the repo root', () => {
    const apps = discoverE2eFeatures({
      suites: [localSuite],
      listFeatures: (dir) => {
        assert.equal(dir, 'apps/e2e/features');
        return ['albums.feature', 'timeline.feature'];
      },
    });
    assert.deepEqual(
      apps.map((a) => a.id),
      ['memries-albums', 'memries-timeline'],
    );
    assert.deepEqual(apps[1], {
      id: 'memries-timeline',
      kind: 'e2e-feature',
      workflow: null,
      path: 'apps/e2e/features/timeline.feature',
      suiteId: 'memries',
      suitePath: '.',
      featuresDir: 'apps/e2e/features',
      featureFile: 'timeline.feature',
      gitlink: false,
    });
  });

  it('keeps the umbrella-relative path when the suite is nested', () => {
    const apps = discoverE2eFeatures({
      suites: [umbrellaSuite],
      listFeatures: (dir) => {
        assert.equal(dir, 'apps/memries/e2e/features');
        return ['timeline.feature'];
      },
    });
    assert.equal(apps[0].path, 'apps/memries/e2e/features/timeline.feature');
    assert.equal(apps[0].suitePath, 'apps/memries');
    assert.equal(apps[0].gitlink, true);
  });

  it('discovers checked-out feature files', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const dir = join(root, 'apps', 'e2e', 'features');
    if (!existsSync(dir)) return;
    const files = readdirSync(dir).filter((name) => name.endsWith('.feature'));
    if (!files.includes('timeline.feature')) return;
    const apps = discoverE2eFeatures({
      suites: [localSuite],
      listFeatures: (rel) =>
        readdirSync(join(root, rel)).filter((name) => name.endsWith('.feature')),
    });
    assert.ok(apps.some((a) => a.id === 'memries-timeline'));
    assert.equal(apps.length, files.length);
  });
});

describe('e2eDiffPaths', () => {
  it('diffs the e2e harness and both product apps as one suite', () => {
    assert.deepEqual(e2eDiffPaths(), ['apps/e2e', 'apps/frontend', 'apps/backend']);
  });
});

describe('parseWaveArg', () => {
  it('reads a quality-wave index and still parses a dotted form', () => {
    assert.deepEqual(parseWaveArg('0'), { index: 0, slice: null });
    assert.deepEqual(parseWaveArg('1'), { index: 1, slice: null });
    assert.deepEqual(parseWaveArg('1.1'), { index: 1, slice: 1 });
    assert.deepEqual(parseWaveArg('1.2'), { index: 1, slice: 2 });
    assert.equal(parseWaveArg('e2e'), null);
  });
});

describe('decideE2eFeatureStatus', () => {
  it('needs a run when never recorded', () => {
    assert.deepEqual(decideE2eFeatureStatus({ pathExists: true }), {
      status: 'needs-run',
      reason: 'never-run',
    });
  });

  it('is up to date when the last finding passed and there is no diff', () => {
    assert.deepEqual(
      decideE2eFeatureStatus({
        pathExists: true,
        lastCommit: 'abc',
        commitExists: true,
        findingStatus: 'passed',
        changedFiles: [],
      }),
      { status: 'up-to-date', reason: 'no-diff' },
    );
  });

  it('needs a run when force is set even after a passed finding', () => {
    assert.deepEqual(
      decideE2eFeatureStatus({
        pathExists: true,
        lastCommit: 'abc',
        commitExists: true,
        findingStatus: 'passed',
        changedFiles: [],
        force: true,
      }),
      { status: 'needs-run', reason: 'force' },
    );
  });

  it('still skips when docker is unavailable even if force is set', () => {
    assert.deepEqual(
      decideE2eFeatureStatus({
        pathExists: true,
        dockerAvailable: false,
        force: true,
        lastCommit: 'abc',
        commitExists: true,
        findingStatus: 'passed',
      }),
      { status: 'skipped', reason: 'docker-unavailable' },
    );
  });
});
