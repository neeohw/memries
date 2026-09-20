/**
 * Last-run status for the README tag: all-green only when the suite finding passed.
 * Catalog blurbs still come from feature files; marks follow the suite finding.
 */
import { SUITE_ID } from './e2e-docker-last-runs.mjs';

function suiteStatus(lastRunsApps, suiteId = SUITE_ID) {
  const status = lastRunsApps?.[suiteId]?.finding?.status;
  if (status === 'passed' || status === 'failed') return status;
  return 'missing';
}

export function summarizeE2eLastRuns({ lastRunsApps = {}, suiteId = SUITE_ID } = {}) {
  const status = suiteStatus(lastRunsApps, suiteId);
  return {
    allPassed: status === 'passed',
    passed: status === 'passed' ? 1 : 0,
    failed: status === 'failed' ? 1 : 0,
    missing: status === 'missing' ? 1 : 0,
    total: 1,
    rows: [{ id: suiteId, stem: 'suite', status }],
  };
}

export function renderE2eLastRunsTag(summary) {
  if (summary.allPassed) {
    return '[**E2E last-runs:** ✅ suite passed](#end-to-end-tests)';
  }
  if (summary.missing) {
    return '[**E2E last-runs:** ❌ suite not recorded](#end-to-end-tests)';
  }
  return '[**E2E last-runs:** ❌ suite failed](#end-to-end-tests)';
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function replaceMarkedRegion(markdown, id, body) {
  const start = `<!-- ${id}:start -->`;
  const end = `<!-- ${id}:end -->`;
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`);
  if (!pattern.test(markdown)) {
    throw new Error(`missing marked region ${id}`);
  }
  return markdown.replace(pattern, `${start}\n${body}\n${end}`);
}

const FEATURE_STOP = /^\s*(Scenario(?: Outline)?|Background|Rule|@|#)/i;

function parseFeatureBlurb(source) {
  const lines = String(source || '').split(/\r?\n/);
  let title = '';
  const blurb = [];
  let seenFeature = false;
  for (const line of lines) {
    const heading = /^Feature:\s*(.+)\s*$/.exec(line);
    if (heading) {
      title = heading[1].trim();
      seenFeature = true;
      continue;
    }
    if (!seenFeature) continue;
    if (FEATURE_STOP.test(line)) break;
    const text = line.trim();
    if (text) blurb.push(text);
  }
  return { title, blurb: blurb.join(' ') };
}

export function catalogRowsFromFeatures(files = []) {
  return files.map((file) => {
    const parsed = parseFeatureBlurb(file.source);
    return { id: file.id, title: parsed.title, blurb: parsed.blurb };
  });
}

export function renderE2eCatalog(catalog = [], summary = { rows: [] }) {
  const suiteMark = summary.rows?.[0]?.status === 'passed' ? '✅' : '❌';
  return catalog
    .map((row) => `- ${suiteMark} **${row.title}** — ${row.blurb}`)
    .join('\n');
}

export const README_TAG_REGION = 'e2e-last-runs-tag';
export const README_CATALOG_REGION = 'e2e-last-runs-catalog';

export function applyE2eLastRunsReadme({
  markdown,
  discovered = [],
  lastRunsApps = {},
  readFeature,
} = {}) {
  const files = discovered.map((row) => ({
    id: row.id,
    source: typeof readFeature === 'function' ? readFeature(row) : '',
  }));
  const catalog = catalogRowsFromFeatures(files);
  const missingTitle = catalog.filter((row) => !row.title).map((row) => row.id);
  if (missingTitle.length) {
    throw new Error(`feature file missing Feature: title: ${missingTitle.join(', ')}`);
  }
  const summary = summarizeE2eLastRuns({ lastRunsApps });
  let next = replaceMarkedRegion(markdown, README_TAG_REGION, renderE2eLastRunsTag(summary));
  next = replaceMarkedRegion(next, README_CATALOG_REGION, renderE2eCatalog(catalog, summary));
  return { markdown: next, summary };
}
