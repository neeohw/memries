import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SUITE_ID } from './e2e-docker-last-runs.mjs';
import {
  applyE2eLastRunsReadme,
  catalogRowsFromFeatures,
  renderE2eCatalog,
  renderE2eLastRunsTag,
  replaceMarkedRegion,
  summarizeE2eLastRuns,
} from './e2e-last-runs-status.mjs';

function discovered(...stems) {
  return stems.map((stem) => ({
    id: `memries-${stem}`,
    featureFile: `${stem}.feature`,
    path: `apps/e2e/features/${stem}.feature`,
  }));
}

describe('summarizeE2eLastRuns', () => {
  it('is all-green only when the suite finding passed', () => {
    const summary = summarizeE2eLastRuns({
      lastRunsApps: {
        [SUITE_ID]: { finding: { status: 'passed' } },
      },
    });
    assert.deepEqual(summary, {
      allPassed: true,
      passed: 1,
      failed: 0,
      missing: 0,
      total: 1,
      rows: [{ id: SUITE_ID, stem: 'suite', status: 'passed' }],
    });
  });

  it('is not all-green when the suite failed or was never recorded', () => {
    assert.equal(
      summarizeE2eLastRuns({
        lastRunsApps: { [SUITE_ID]: { finding: { status: 'failed' } } },
      }).allPassed,
      false,
    );
    assert.equal(summarizeE2eLastRuns({ lastRunsApps: {} }).missing, 1);
  });
});

describe('renderE2eLastRunsTag', () => {
  it('renders a green check when the suite passed', () => {
    const tag = renderE2eLastRunsTag({
      allPassed: true,
      passed: 1,
      failed: 0,
      missing: 0,
      total: 1,
      rows: [{ id: SUITE_ID, stem: 'suite', status: 'passed' }],
    });
    assert.equal(tag, '[**E2E last-runs:** ✅ suite passed](#end-to-end-tests)');
  });

  it('renders a failed suite without a feature count', () => {
    const tag = renderE2eLastRunsTag({
      allPassed: false,
      passed: 0,
      failed: 1,
      missing: 0,
      total: 1,
      rows: [{ id: SUITE_ID, stem: 'suite', status: 'failed' }],
    });
    assert.equal(tag, '[**E2E last-runs:** ❌ suite failed](#end-to-end-tests)');
  });

  it('renders not recorded when the suite has no finding', () => {
    const tag = renderE2eLastRunsTag({
      allPassed: false,
      passed: 0,
      failed: 0,
      missing: 1,
      total: 1,
      rows: [{ id: SUITE_ID, stem: 'suite', status: 'missing' }],
    });
    assert.equal(tag, '[**E2E last-runs:** ❌ suite not recorded](#end-to-end-tests)');
  });
});

describe('replaceMarkedRegion', () => {
  it('rewrites the body between matching start and end comments', () => {
    const next = replaceMarkedRegion(
      '# Title\n\n<!-- e2e-last-runs-tag:start -->\nold\n<!-- e2e-last-runs-tag:end -->\n\nMore\n',
      'e2e-last-runs-tag',
      '[**E2E last-runs:** ✅ suite passed](#end-to-end-tests)',
    );
    assert.equal(
      next,
      '# Title\n\n<!-- e2e-last-runs-tag:start -->\n[**E2E last-runs:** ✅ suite passed](#end-to-end-tests)\n<!-- e2e-last-runs-tag:end -->\n\nMore\n',
    );
  });

  it('throws when the marked region is missing', () => {
    assert.throws(
      () => replaceMarkedRegion('# Title\n', 'e2e-last-runs-tag', 'x'),
      /missing marked region e2e-last-runs-tag/,
    );
  });
});

describe('catalogRowsFromFeatures', () => {
  it('reads the Feature title and description paragraph', () => {
    const rows = catalogRowsFromFeatures([
      {
        id: 'memries-login',
        source: `Feature: Sign in
  Dex login puts the owner on Memories.

  Scenario: Admin sees memories after login
    Given I am signed in
`,
      },
    ]);
    assert.deepEqual(rows, [
      {
        id: 'memries-login',
        title: 'Sign in',
        blurb: 'Dex login puts the owner on Memories.',
      },
    ]);
  });
});

describe('renderE2eCatalog', () => {
  it('marks every feature from the suite finding', () => {
    const markdown = renderE2eCatalog(
      [
        { id: 'memries-login', title: 'Sign in', blurb: 'Dex login puts the owner on Memories.' },
        { id: 'memries-search', title: 'Search', blurb: 'Filter on Memories opens Search.' },
      ],
      {
        rows: [{ id: SUITE_ID, stem: 'suite', status: 'passed' }],
      },
    );
    assert.equal(
      markdown,
      '- ✅ **Sign in** — Dex login puts the owner on Memories.\n- ✅ **Search** — Filter on Memories opens Search.',
    );
  });
});

describe('applyE2eLastRunsReadme', () => {
  const template = `# Memries

<!-- e2e-last-runs-tag:start -->
old tag
<!-- e2e-last-runs-tag:end -->

## End-to-end tests

<!-- e2e-last-runs-catalog:start -->
old catalog
<!-- e2e-last-runs-catalog:end -->
`;

  it('refreshes the tag and catalog from the suite finding and Feature blurbs', () => {
    const sources = {
      'memries-login': `Feature: Sign in
  Dex login puts the owner on Memories.
`,
      'memries-search': `Feature: Search
  Filter on Memories opens Search.
`,
    };
    const result = applyE2eLastRunsReadme({
      markdown: template,
      discovered: discovered('login', 'search'),
      lastRunsApps: {
        [SUITE_ID]: { finding: { status: 'failed' } },
      },
      readFeature: (row) => sources[row.id],
    });
    assert.equal(result.summary.allPassed, false);
    assert.match(
      result.markdown,
      /<!-- e2e-last-runs-tag:start -->\n\[\*+E2E last-runs:\*\* ❌ suite failed\]\(#end-to-end-tests\)\n<!-- e2e-last-runs-tag:end -->/,
    );
    assert.match(
      result.markdown,
      /<!-- e2e-last-runs-catalog:start -->\n- ❌ \*\*Sign in\*\* — Dex login puts the owner on Memories\.\n- ❌ \*\*Search\*\* — Filter on Memories opens Search\.\n<!-- e2e-last-runs-catalog:end -->/,
    );
  });

  it('refuses a discovered feature that has no Feature title', () => {
    assert.throws(
      () =>
        applyE2eLastRunsReadme({
          markdown: template,
          discovered: discovered('login'),
          lastRunsApps: {},
          readFeature: () => 'Scenario: missing heading\n',
        }),
      /feature file missing Feature: title: memries-login/,
    );
  });
});
