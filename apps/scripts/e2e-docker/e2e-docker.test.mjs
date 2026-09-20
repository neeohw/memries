import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SUITE_ID,
  commitLastRunsIfNeeded,
  lastRunsCommitTarget,
  suiteLastRunsAfterRecord,
} from './e2e-docker-last-runs.mjs';
import { buildE2eStatus, planE2eFeatures } from './e2e-docker.mjs';

describe('planE2eFeatures', () => {
  it('plans the suite as one never-run row on the default stack', () => {
    const plan = planE2eFeatures({
      suiteHead: 'abc',
      baseBranch: 'main',
    });
    assert.deepEqual(plan.launchNow, [SUITE_ID]);
    assert.deepEqual(plan.needsRun, [SUITE_ID]);
    assert.deepEqual(plan.deferred, []);
    assert.equal(plan.waves, undefined);
    assert.equal(plan.maxLaunch, undefined);
    assert.equal(plan.apps.length, 1);
    assert.equal(plan.apps[0].id, SUITE_ID);
    assert.equal(plan.apps[0].kind, 'e2e-suite');
    assert.equal(plan.apps[0].path, 'apps/e2e');
    assert.equal(plan.apps[0].composeProject, 'memries-e2e');
    assert.equal(plan.apps[0].origin, 'http://localhost:18080');
    assert.equal(plan.apps[0].ports, undefined);
    assert.equal(plan.apps[0].slot, undefined);
    assert.equal(plan.apps[0].reason, 'never-run');
  });

  it('is up to date when the suite last-run passed and there is no diff', () => {
    const plan = planE2eFeatures({
      lastRunsApps: {
        [SUITE_ID]: {
          lastCommit: 'abc',
          finding: { status: 'passed', summary: '80 passed' },
        },
      },
      suiteHead: 'abc',
      commitExists: () => true,
      changedFiles: [],
      baseBranch: 'main',
    });
    assert.deepEqual(plan.upToDate, [SUITE_ID]);
    assert.deepEqual(plan.launchNow, []);
    assert.equal(plan.hint, 'pass --force to rerun the suite and refresh last-runs');
  });

  it('force-relaunches a passed suite so last-runs can refresh', () => {
    const plan = planE2eFeatures({
      lastRunsApps: {
        [SUITE_ID]: {
          lastCommit: 'abc',
          finding: { status: 'passed', summary: '80 passed' },
        },
      },
      suiteHead: 'abc',
      force: true,
      commitExists: () => true,
      changedFiles: [],
      baseBranch: 'main',
    });
    assert.equal(plan.force, true);
    assert.deepEqual(plan.launchNow, [SUITE_ID]);
    assert.equal(plan.apps[0].reason, 'force');
    assert.equal(plan.hint, undefined);
  });

  it('skips when docker is unavailable even if force is set', () => {
    const plan = planE2eFeatures({
      dockerAvailable: false,
      force: true,
      suiteHead: 'abc',
      baseBranch: 'main',
    });
    assert.deepEqual(plan.skipped, [SUITE_ID]);
    assert.deepEqual(plan.launchNow, []);
    assert.equal(plan.apps[0].reason, 'docker-unavailable');
  });
});

describe('suiteLastRunsAfterRecord', () => {
  it('keeps only the suite key after the first record', () => {
    const apps = suiteLastRunsAfterRecord({
      previousApps: {
        'memries-login': { lastCommit: 'old', finding: { status: 'passed' } },
        'memries-search': { lastCommit: 'old', finding: { status: 'failed' } },
      },
      path: 'apps/e2e',
      sha: 'abc',
      recordedAt: '2026-08-28T00:00:00.000Z',
      finding: { status: 'passed', summary: '80 passed', composeProject: 'memries-e2e' },
    });
    assert.deepEqual(Object.keys(apps), [SUITE_ID]);
    assert.equal(apps.memries.lastCommit, 'abc');
    assert.equal(apps.memries.finding.status, 'passed');
    assert.equal(apps.memries.path, 'apps/e2e');
  });
});

describe('lastRunsCommitTarget', () => {
  it('commits inside the suite repo when last-runs live there', () => {
    const target = lastRunsCommitTarget({
      root: '/repo',
      lastRunsPath: 'apps/memries/.cursor/skills/e2e-docker/last-runs.json',
      suitePath: 'apps/memries',
    });
    assert.equal(target.relPath, '.cursor/skills/e2e-docker/last-runs.json');
    assert.match(target.cwd.replaceAll('\\', '/'), /\/apps\/memries$/);
  });

  it('keeps the umbrella root when last-runs are not under the suite', () => {
    const target = lastRunsCommitTarget({
      root: '/repo',
      lastRunsPath: '.cursor/skills/e2e-docker/last-runs.json',
      suitePath: 'apps/memries',
    });
    assert.deepEqual(target, {
      cwd: '/repo',
      relPath: '.cursor/skills/e2e-docker/last-runs.json',
    });
  });
});

describe('commitLastRunsIfNeeded', () => {
  it('commits last-runs and the README tag in one commit', () => {
    const calls = [];
    const result = commitLastRunsIfNeeded({
      beforeApps: {},
      afterApps: {
        memries: { recordedAt: '2026-08-26T00:00:00.000Z', finding: { status: 'passed' } },
      },
      ids: ['memries'],
      skillId: 'e2e-docker',
      relPath: '.cursor/skills/e2e-docker/last-runs.json',
      extraPaths: ['README.md'],
      branch: 'main',
      runGit: (args) => {
        calls.push(args);
        if (args[0] === 'status') return ` M ${args.at(-1)}`;
        if (args[0] === 'rev-parse') return 'abc123';
        return '';
      },
    });
    assert.equal(result.committed, true);
    assert.equal(result.message, 'chore(e2e-docker): add last-run for memries');
    assert.deepEqual(
      calls.find((args) => args[0] === 'add'),
      ['add', '--', '.cursor/skills/e2e-docker/last-runs.json', 'README.md'],
    );
  });

  it('omits a clean README from the last-runs commit', () => {
    const calls = [];
    commitLastRunsIfNeeded({
      beforeApps: {},
      afterApps: {
        memries: { recordedAt: '2026-08-26T00:00:00.000Z', finding: { status: 'passed' } },
      },
      ids: ['memries'],
      skillId: 'e2e-docker',
      relPath: '.cursor/skills/e2e-docker/last-runs.json',
      extraPaths: ['README.md'],
      branch: 'main',
      runGit: (args) => {
        calls.push(args);
        if (args[0] === 'status') {
          return args.at(-1) === 'README.md' ? '' : ' M last-runs.json';
        }
        if (args[0] === 'rev-parse') return 'abc123';
        return '';
      },
    });
    assert.deepEqual(
      calls.find((args) => args[0] === 'add'),
      ['add', '--', '.cursor/skills/e2e-docker/last-runs.json'],
    );
  });
});

describe('buildE2eStatus', () => {
  it('exits 1 when the suite last-run is not passed', () => {
    const result = buildE2eStatus({
      lastRunsApps: {
        memries: { finding: { status: 'failed' } },
      },
    });
    assert.equal(result.skill, 'e2e-docker');
    assert.equal(result.allPassed, false);
    assert.equal(result.exitCode, 1);
    assert.equal(result.total, 1);
  });

  it('exits 0 when the suite last-run passed', () => {
    const result = buildE2eStatus({
      lastRunsApps: {
        memries: { finding: { status: 'passed' } },
      },
    });
    assert.equal(result.allPassed, true);
    assert.equal(result.exitCode, 0);
  });
});
