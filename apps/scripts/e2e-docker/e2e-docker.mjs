#!/usr/bin/env node
/**
 * Plan, record, and report the Memries Playwright suite (one Compose stack).
 * The parent runs `make e2e` when plan says needs-run, then records id memries.
 *
 * Usage:
 *   node apps/scripts/e2e-docker/e2e-docker.mjs plan [--force] [--base <branch>]
 *   node apps/scripts/e2e-docker/e2e-docker.mjs record [--commit <sha>] [--finding <json>] memries
 *   node apps/scripts/e2e-docker/e2e-docker.mjs status
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  SUITE_COMPOSE_PROJECT,
  SUITE_ID,
  SUITE_ORIGIN,
  SUITE_PATH,
  commitLastRunsIfNeeded,
  isAgentWorktreeBranch,
  parseFinding,
  suiteLastRunsAfterRecord,
} from './e2e-docker-last-runs.mjs';
import { decideE2eFeatureStatus, discoverE2eFeatures, e2eDiffPaths } from './e2e-features.mjs';
import { applyE2eLastRunsReadme, summarizeE2eLastRuns } from './e2e-last-runs-status.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LAST_RUNS_REL = '.cursor/skills/e2e-docker/last-runs.json';
const LAST_RUNS_PATH = join(ROOT, LAST_RUNS_REL);
const README_REL = 'README.md';
const README_PATH = join(ROOT, README_REL);
const SKILL_ID = 'e2e-docker';
const MAX_CHANGED_FILES = 40;
const SUITES = [{ id: 'memries', path: '', featuresDir: 'apps/e2e/features', gitlink: false }];

export { SUITE_COMPOSE_PROJECT, SUITE_ID, SUITE_ORIGIN, SUITE_PATH };

export function planE2eFeatures({
  lastRunsApps = {},
  suiteHead,
  dockerAvailable = true,
  force = false,
  pathExists = () => true,
  commitExists = () => false,
  changedFiles = [],
  baseBranch,
  skillId = SKILL_ID,
}) {
  const recorded = lastRunsApps[SUITE_ID] ?? {};
  const lastCommit = recorded.lastCommit ?? null;
  const files = Array.isArray(changedFiles) ? changedFiles : [];
  const decided = decideE2eFeatureStatus({
    pathExists: pathExists({ id: SUITE_ID, path: SUITE_PATH }),
    dockerAvailable,
    force,
    lastCommit,
    findingStatus: recorded.finding?.status ?? null,
    commitExists: lastCommit ? commitExists(lastCommit) : false,
    changedFiles: files,
  });
  const app = {
    id: SUITE_ID,
    skill: skillId,
    kind: 'e2e-suite',
    workflow: null,
    path: SUITE_PATH,
    agentName: `${skillId}-${SUITE_ID}`,
    worktreeBranch: `${skillId}-${SUITE_ID}`,
    baseBranch,
    lastCommit,
    status: decided.status,
    reason: decided.reason,
    changedFiles: files.slice(0, MAX_CHANGED_FILES),
    changedFileCount: files.length,
    suiteId: SUITE_ID,
    suitePath: '.',
    suiteCommit: suiteHead || null,
    composeProject: SUITE_COMPOSE_PROJECT,
    origin: SUITE_ORIGIN,
  };
  if (recorded.finding) app.finding = recorded.finding;

  const needsRun = decided.status === 'needs-run';
  const plan = {
    skill: skillId,
    kind: 'atomic',
    cohort: 'e2e',
    steps: ['e2e'],
    baseBranch,
    head: suiteHead || null,
    lastRunsPath: LAST_RUNS_REL,
    force,
    apps: [app],
    needsRun: needsRun ? [SUITE_ID] : [],
    launchNow: needsRun ? [SUITE_ID] : [],
    deferred: [],
    upToDate: decided.status === 'up-to-date' ? [SUITE_ID] : [],
    skipped: decided.status === 'skipped' ? [SUITE_ID] : [],
  };
  if (!force && plan.launchNow.length === 0 && plan.upToDate.length) {
    plan.hint = 'pass --force to rerun the suite and refresh last-runs';
  }
  return plan;
}

function usage() {
  console.error(`Usage:
  node apps/scripts/e2e-docker/e2e-docker.mjs plan [--force] [--base <branch>]
  node apps/scripts/e2e-docker/e2e-docker.mjs record [--commit <sha>] [--finding <json>] memries
  node apps/scripts/e2e-docker/e2e-docker.mjs status`);
  process.exit(2);
}

function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', ['-C', ROOT, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    if (allowFail) return '';
    const detail = err.stderr?.toString().trim() || err.message;
    throw new Error(`git ${args.join(' ')} failed: ${detail}`);
  }
}

function gitOk(args) {
  try {
    execFileSync('git', ['-C', ROOT, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

let dockerInfoCache;

function dockerAvailable() {
  if (dockerInfoCache !== undefined) return dockerInfoCache;
  try {
    execFileSync('docker', ['info'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15_000,
    });
    dockerInfoCache = true;
  } catch {
    dockerInfoCache = false;
  }
  return dockerInfoCache;
}

function listFeatureFiles(dir) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).filter((name) => name.endsWith('.feature'));
}

function discoveredFeatures() {
  return discoverE2eFeatures({ suites: SUITES, listFeatures: listFeatureFiles });
}

function refreshReadmeFromLastRuns(discovered, lastRunsApps) {
  const current = readFileSync(README_PATH, 'utf8');
  const applied = applyE2eLastRunsReadme({
    markdown: current,
    discovered,
    lastRunsApps,
    readFeature: (row) => readFileSync(join(ROOT, row.path), 'utf8'),
  });
  const changed = applied.markdown !== current;
  if (changed) writeFileSync(README_PATH, applied.markdown, 'utf8');
  return { changed, summary: applied.summary };
}

export function buildE2eStatus({ lastRunsApps = {} }) {
  const summary = summarizeE2eLastRuns({ lastRunsApps });
  return {
    skill: SKILL_ID,
    ...summary,
    exitCode: summary.allPassed ? 0 : 1,
  };
}

function loadLastRuns() {
  if (!existsSync(LAST_RUNS_PATH)) return { version: 1, apps: {} };
  const parsed = JSON.parse(readFileSync(LAST_RUNS_PATH, 'utf8'));
  if (!parsed || parsed.version !== 1 || typeof parsed.apps !== 'object' || parsed.apps === null) {
    throw new Error(`${LAST_RUNS_REL} must be { version: 1, apps: { ... } }`);
  }
  return parsed;
}

function detectCurrentBranch() {
  const name = git(['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true });
  if (!name || name === 'HEAD') {
    throw new Error('e2e-docker needs a named branch; checkout is detached.');
  }
  if (isAgentWorktreeBranch(name)) {
    throw new Error(
      `current branch '${name}' looks like an agent worktree. Checkout the feature branch first.`,
    );
  }
  return name;
}

function resolveBaseBranch(opts = {}) {
  const named = typeof opts.base === 'string' && opts.base ? opts.base : detectCurrentBranch();
  if (isAgentWorktreeBranch(named)) {
    throw new Error(`base branch '${named}' looks like an agent worktree.`);
  }
  if (!gitOk(['rev-parse', '--verify', `${named}^{commit}`])) {
    throw new Error(`local branch '${named}' is required for e2e-docker plans`);
  }
  return named;
}

function suiteChangedFiles(lastCommit, head, paths) {
  if (!lastCommit || !head || !paths?.length) return [];
  const out = git(['diff', '--name-only', `${lastCommit}..${head}`, '--', ...paths], {
    allowFail: true,
  });
  if (!out) return [];
  return out.split(/\r?\n/).filter(Boolean);
}

function plan(opts) {
  const branch = resolveBaseBranch(opts);
  const suiteHead = git(['rev-parse', 'HEAD'], { allowFail: true });
  const lastRuns = loadLastRuns();
  const lastCommit = lastRuns.apps[SUITE_ID]?.lastCommit;

  return planE2eFeatures({
    lastRunsApps: lastRuns.apps,
    suiteHead,
    dockerAvailable: dockerAvailable(),
    force: Boolean(opts.force),
    pathExists: () => existsSync(join(ROOT, SUITE_PATH)),
    commitExists: (sha) => gitOk(['cat-file', '-e', `${sha}^{commit}`]),
    changedFiles: suiteChangedFiles(lastCommit, suiteHead, e2eDiffPaths()),
    baseBranch: branch,
  });
}

function record(ids, opts) {
  if (ids.length !== 1 || ids[0] !== SUITE_ID) {
    throw new Error(`record only accepts suite id '${SUITE_ID}'`);
  }
  const finding = parseFinding(opts.finding);
  const lastRuns = loadLastRuns();
  const beforeApps = structuredClone(lastRuns.apps);
  const recordedAt = new Date().toISOString();
  const sha = opts.commit || git(['rev-parse', 'HEAD'], { allowFail: true }) || null;

  lastRuns.apps = suiteLastRunsAfterRecord({
    previousApps: lastRuns.apps,
    path: SUITE_PATH,
    sha,
    recordedAt,
    finding,
  });

  mkdirSync(dirname(LAST_RUNS_PATH), { recursive: true });
  writeFileSync(LAST_RUNS_PATH, `${JSON.stringify(lastRuns, null, 2)}\n`, 'utf8');
  const readme = refreshReadmeFromLastRuns(discoveredFeatures(), lastRuns.apps);
  const lastRunsCommit = commitLastRunsIfNeeded({
    beforeApps,
    afterApps: lastRuns.apps,
    ids: [SUITE_ID],
    skillId: SKILL_ID,
    relPath: LAST_RUNS_REL,
    extraPaths: [README_REL],
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true }),
    runGit: (args, options) => git(args, options),
  });
  const result = {
    skill: SKILL_ID,
    lastRunsPath: LAST_RUNS_REL,
    commit: sha,
    ids: [SUITE_ID],
    lastRunsCommitted: lastRunsCommit.committed,
    readmeUpdated: readme.changed,
    allPassed: readme.summary.allPassed,
  };
  if (finding) result.finding = finding;
  if (lastRunsCommit.message) result.lastRunsMessage = lastRunsCommit.message;
  if (lastRunsCommit.commit) result.lastRunsCommit = lastRunsCommit.commit;
  return result;
}

function status() {
  const lastRuns = loadLastRuns();
  return buildE2eStatus({
    lastRunsApps: lastRuns.apps,
  });
}

export function buildE2ePlan(opts) {
  return plan(opts);
}

export function recordE2eFindings(ids, opts) {
  return record(ids, opts);
}

export function main(argv = process.argv.slice(2)) {
  const { cmd, ids, opts } = parseArgs(argv);
  let result;
  if (cmd === 'plan') result = plan(opts);
  else if (cmd === 'record') result = record(ids, opts);
  else if (cmd === 'status') result = status();
  else usage();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function parseArgs(argv) {
  const positional = [];
  const opts = {
    apps: [],
    force: false,
    commit: null,
    finding: null,
    base: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--force') opts.force = true;
    else if (arg === '--app') opts.apps.push(argv[++i]);
    else if (arg === '--commit') opts.commit = argv[++i];
    else if (arg === '--finding') opts.finding = argv[++i];
    else if (arg === '--base') opts.base = argv[++i];
    else if (arg === '--wave') {
      i += 1;
    } else if (arg.startsWith('-')) usage();
    else positional.push(arg);
  }
  return { cmd: positional[0], ids: positional.slice(1), opts };
}

const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  const result = main();
  if (result?.exitCode) process.exit(result.exitCode);
}
