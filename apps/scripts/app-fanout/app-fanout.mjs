#!/usr/bin/env node
/**
 * Discover Memries quality trees and decide which need a skill run
 * since their last recorded commit. Used by the one-step orchestrators
 * and the user-invoked umbrella platform-quality.
 *
 * Usage:
 *   node apps/scripts/app-fanout/app-fanout.mjs list
 *   node apps/scripts/app-fanout/app-fanout.mjs plan --skill <id> [--force] [--app <id> ...] [--wave <n[.n]>] [--base <branch>]
 *   node apps/scripts/app-fanout/app-fanout.mjs record --skill <id> [--commit <sha>] [--base <branch>]
 *     [--incomplete-pages <csv>] [--incomplete-files <csv>] [--finding <json>] <id> [<id> ...]
 *   node apps/scripts/app-fanout/app-fanout.mjs close --here
 *   node apps/scripts/app-fanout/app-fanout.mjs close --skill <id> [--base-worktree] [--base <branch>] <id> [<id> ...]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { closeOpenedWorktrees, parseWorktreeList } from '../e2e-docker/e2e-docker-close.mjs';
import {
  commitLastRunsIfNeeded,
  isAgentWorktreeBranch,
} from '../e2e-docker/e2e-docker-last-runs.mjs';
import { buildE2ePlan, recordE2eFindings } from '../e2e-docker/e2e-docker.mjs';
import { parseWaveArg } from '../e2e-docker/e2e-features.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, '..', '..', '..');
const CONFIG_PATH = join(SCRIPT_DIR, 'app-fanout.config.json');
const MAX_CHANGED_FILES = 80;
const DEFAULT_MAX_LAUNCH = 40;

export function posix(p) {
  return String(p || '').replaceAll('\\', '/');
}

export function skillSteps(skill) {
  return Array.isArray(skill.steps) ? skill.steps.filter((s) => typeof s === 'string' && s) : [];
}

export function isUmbrella(skill) {
  return skill?.kind === 'umbrella';
}

export function maxLaunchOf(config, skill) {
  const global = Number(config.maxLaunch) > 0 ? Number(config.maxLaunch) : DEFAULT_MAX_LAUNCH;
  const local = Number(skill?.maxLaunch);
  if (local > 0) return Math.min(global, local);
  return global;
}

function incompleteKey(skillOrField) {
  const field = typeof skillOrField === 'string' ? skillOrField : skillOrField?.incompleteField;
  if (field === 'pages') return 'incompletePages';
  if (field === 'files') return 'incompleteFiles';
  return null;
}

function incompleteReasonOf(skillOrField) {
  const field = typeof skillOrField === 'string' ? skillOrField : skillOrField?.incompleteField;
  if (field === 'pages') return 'incomplete-pages';
  if (field === 'files') return 'incomplete-files';
  return null;
}

export function decideTreeStatus({
  force = false,
  pathExists = true,
  lastCommit = null,
  commitExists = false,
  changedFiles = [],
  incomplete = [],
  incompleteReason = 'incomplete-files',
} = {}) {
  if (!pathExists) return { status: 'skipped', reason: 'missing-path' };
  if (force) return { status: 'needs-run', reason: 'force' };
  if (!lastCommit) return { status: 'needs-run', reason: 'never-run' };
  if (!commitExists) return { status: 'needs-run', reason: 'unknown-last-commit' };
  if (Array.isArray(changedFiles) && changedFiles.length) {
    return { status: 'needs-run', reason: 'git-diff' };
  }
  if (Array.isArray(incomplete) && incomplete.length) {
    return { status: 'needs-run', reason: incompleteReason };
  }
  return { status: 'up-to-date', reason: 'no-diff' };
}

export function planTrees({
  discovered,
  lastRunsApps = {},
  head,
  force = false,
  maxLaunch = DEFAULT_MAX_LAUNCH,
  baseBranch,
  skillId,
  lastRunsPath,
  steps = [],
  cohort = 'trees',
  incompleteField = null,
  pathExists = () => true,
  commitExists = () => false,
  changedFilesFor = () => [],
}) {
  const reasonForIncomplete = incompleteReasonOf(incompleteField);
  const key = incompleteKey(incompleteField);
  const apps = [];
  for (const row of discovered) {
    const recorded = lastRunsApps[row.id] ?? {};
    const lastCommit = recorded.lastCommit ?? null;
    const incomplete = key && Array.isArray(recorded[key]) ? recorded[key] : [];
    const files = lastCommit && head ? changedFilesFor(row) : [];
    const decided = decideTreeStatus({
      force,
      pathExists: pathExists(row),
      lastCommit,
      commitExists: lastCommit ? commitExists(lastCommit) : false,
      changedFiles: files,
      incomplete,
      incompleteReason: reasonForIncomplete,
    });
    const name = `${skillId}-${row.id}`;
    const entry = {
      id: row.id,
      skill: skillId,
      kind: row.kind,
      workflow: row.workflow ?? null,
      path: row.path,
      agentName: name,
      worktreeBranch: name,
      baseBranch,
      lastCommit,
      status: decided.status,
      reason: decided.reason,
      changedFiles: files.slice(0, MAX_CHANGED_FILES),
      changedFileCount: files.length,
    };
    if (key) entry[key] = incomplete;
    apps.push(entry);
  }
  const needsRun = apps.filter((a) => a.status === 'needs-run');
  return {
    skill: skillId,
    kind: 'atomic',
    cohort,
    steps,
    baseBranch,
    head: head || null,
    lastRunsPath,
    force,
    maxLaunch,
    apps,
    needsRun: needsRun.map((a) => a.id),
    launchNow: needsRun.slice(0, maxLaunch).map((a) => a.id),
    deferred: needsRun.slice(maxLaunch).map((a) => a.id),
    upToDate: apps.filter((a) => a.status === 'up-to-date').map((a) => a.id),
    skipped: apps.filter((a) => a.status === 'skipped').map((a) => a.id),
  };
}

function launchRow(app, branch) {
  const row = {
    skill: app.skill,
    id: app.id,
    agentName: app.agentName,
    worktreeBranch: app.worktreeBranch,
    baseBranch: app.baseBranch ?? branch,
    path: app.path,
  };
  if (app.featureFile) {
    row.featureFile = app.featureFile;
    row.suiteCommit = app.suiteCommit ?? null;
  }
  if (app.composeProject) {
    row.composeProject = app.composeProject;
    row.origin = app.origin;
  }
  return row;
}

function waveFilterParts(filter) {
  if (filter == null) return null;
  if (typeof filter === 'number') return { index: filter, slice: null };
  const index = Number(filter.index);
  if (!Number.isInteger(index) || index < 0) return null;
  const slice = filter.slice == null ? null : Number(filter.slice);
  return { index, slice: Number.isInteger(slice) && slice > 0 ? slice : null };
}

function collectNestedApps(wave, nestedBySkill) {
  const nestedApps = [];
  for (const nestedId of wave.skills) {
    const nested = nestedBySkill[nestedId];
    if (!nested) throw new Error(`missing nested plan for '${nestedId}'`);
    for (const app of nested.apps ?? []) {
      nestedApps.push({
        ...app,
        skill: nestedId,
        steps: nested.steps,
        lastRunsPath: nested.lastRunsPath,
      });
    }
  }
  return nestedApps;
}

function waveMaxOf(wave, nestedBySkill, maxLaunch) {
  return Math.min(
    maxLaunch,
    ...wave.skills.map((nestedId) => {
      const nested = nestedBySkill[nestedId];
      const local = Number(nested?.maxLaunch);
      return local > 0 ? Math.min(maxLaunch, local) : maxLaunch;
    }),
  );
}

function waveStatusLists(nestedApps, needsRun) {
  return {
    needsRun: needsRun.map((a) => a.agentName),
    upToDate: nestedApps.filter((a) => a.status === 'up-to-date').map((a) => a.agentName),
    skipped: nestedApps.filter((a) => a.status === 'skipped').map((a) => a.agentName),
  };
}

export function planUmbrellaWaves({
  waves,
  nestedBySkill,
  maxLaunch = DEFAULT_MAX_LAUNCH,
  waveFilter = null,
  baseBranch,
  head,
  force = false,
  skillId = 'platform-quality',
}) {
  if (!Array.isArray(waves) || !waves.length) {
    throw new Error(`umbrella '${skillId}' requires a non-empty waves array`);
  }
  const filter = waveFilterParts(waveFilter);
  const planned = [];
  waves.forEach((wave, index) => {
    if (filter && filter.index !== index) return;
    if (!Array.isArray(wave.skills) || !wave.skills.length) {
      throw new Error(`umbrella wave ${index} needs a skills array`);
    }
    const nestedApps = collectNestedApps(wave, nestedBySkill);
    const waveMax = waveMaxOf(wave, nestedBySkill, maxLaunch);
    const needsRun = nestedApps.filter((a) => a.status === 'needs-run');
    const lists = waveStatusLists(nestedApps, needsRun);
    planned.push({
      index,
      step: wave.step,
      skills: wave.skills,
      apps: nestedApps,
      ...lists,
      launchNow: needsRun.slice(0, waveMax).map((a) => launchRow(a, baseBranch)),
      deferred: needsRun.slice(waveMax).map((a) => a.agentName),
    });
  });

  return {
    skill: skillId,
    kind: 'umbrella',
    userInvokedOnly: true,
    cohort: 'all',
    steps: waves.map((w) => w.step),
    baseBranch,
    head,
    force,
    maxLaunch,
    waves: planned,
  };
}

export function listSkillsFromConfig(config, baseBranch) {
  const maxLaunch = maxLaunchOf(config);
  const skills = Object.entries(config.skills).map(([id, skill]) => {
    if (isUmbrella(skill)) {
      return {
        id,
        kind: 'umbrella',
        userInvokedOnly: true,
        cohort: skill.cohort ?? 'all',
        steps: (skill.waves ?? []).map((w) => w.step),
        waves: skill.waves ?? [],
      };
    }
    return {
      id,
      kind: 'atomic',
      cohort: skill.cohort,
      discover: skill.discover,
      steps: skillSteps(skill),
      lastRunsPath: skill.lastRunsPath,
      incompleteField: skill.incompleteField ?? null,
    };
  });
  return { maxLaunch, baseBranch, skills };
}

export function loadConfig(path = CONFIG_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function usage(exit = 1) {
  console.error(`Usage:
  node apps/scripts/app-fanout/app-fanout.mjs list
  node apps/scripts/app-fanout/app-fanout.mjs plan --skill <id> [--force] [--app <id> ...] [--wave <n[.n]>] [--base <branch>]
  node apps/scripts/app-fanout/app-fanout.mjs record --skill <id> [--commit <sha>] [--base <branch>]
    [--incomplete-pages <csv>] [--incomplete-files <csv>] [--finding <json>] <id> [<id> ...]
  node apps/scripts/app-fanout/app-fanout.mjs close --here
  node apps/scripts/app-fanout/app-fanout.mjs close --skill <id> [--base-worktree] [--base <branch>] <id> [<id> ...]`);
  process.exit(exit);
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

function detectCurrentBranch() {
  const name = git(['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true });
  if (!name || name === 'HEAD') {
    throw new Error('app-fanout needs a named branch; checkout is detached.');
  }
  if (isAgentWorktreeBranch(name)) {
    throw new Error(
      `current branch '${name}' looks like an agent worktree. Checkout the orchestrator branch first.`,
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
    throw new Error(`local branch '${named}' is required for app-fanout plans`);
  }
  return named;
}

function resolveSkill(config, skillId) {
  if (!skillId) {
    throw new Error(`--skill is required. Known: ${Object.keys(config.skills).join(', ')}`);
  }
  const skill = config.skills[skillId];
  if (!skill) {
    throw new Error(`unknown skill '${skillId}'. Known: ${Object.keys(config.skills).join(', ')}`);
  }
  return skill;
}

function discoverTrees(trees) {
  if (!Array.isArray(trees) || !trees.length) {
    throw new Error("discover 'trees' requires a non-empty trees array");
  }
  return trees.map((tree) => ({
    id: tree.id,
    kind: 'tree',
    workflow: null,
    path: posix(tree.path),
  }));
}

function discover(skill) {
  if (skill.discover === 'trees') return discoverTrees(skill.trees);
  if (skill.discover === 'e2e-features') {
    throw new Error('e2e-features plans go through buildE2ePlan');
  }
  throw new Error(`unknown discover '${skill.discover}'`);
}

function lastRunsFile(skill) {
  return join(ROOT, skill.lastRunsPath);
}

function loadLastRuns(skill) {
  const path = lastRunsFile(skill);
  if (!existsSync(path)) return { version: 1, apps: {} };
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (!parsed || parsed.version !== 1 || typeof parsed.apps !== 'object') {
    throw new Error(`${skill.lastRunsPath} must be { version: 1, apps: { ... } }`);
  }
  return parsed;
}

function changedFiles(lastCommit, head, treePath) {
  if (!lastCommit || !head || !treePath) return [];
  const out = git(['diff', '--name-only', `${lastCommit}..${head}`, '--', treePath], {
    allowFail: true,
  });
  if (!out) return [];
  return out.split(/\r?\n/).filter(Boolean);
}

function planAtomic(skillId, opts, config) {
  const skill = resolveSkill(config, skillId);
  if (isUmbrella(skill)) {
    throw new Error(`skill '${skillId}' is an umbrella — use plan --skill platform-quality`);
  }
  if (skill.discover === 'e2e-features') {
    return buildE2ePlan(opts);
  }
  const branch = resolveBaseBranch(opts);
  const head = git(['rev-parse', branch]);
  const lastRuns = loadLastRuns(skill);
  const wanted = new Set(opts.apps);
  const discovered = discover(skill).filter((row) => !wanted.size || wanted.has(row.id));
  return planTrees({
    discovered,
    lastRunsApps: lastRuns.apps,
    head,
    force: Boolean(opts.force),
    maxLaunch: maxLaunchOf(config, skill),
    baseBranch: branch,
    skillId,
    lastRunsPath: skill.lastRunsPath,
    steps: skillSteps(skill),
    cohort: skill.cohort,
    incompleteField: skill.incompleteField,
    pathExists: (row) => existsSync(join(ROOT, row.path)),
    commitExists: (sha) => gitOk(['cat-file', '-e', `${sha}^{commit}`]),
    changedFilesFor: (row) => changedFiles(lastRuns.apps[row.id]?.lastCommit, head, row.path),
  });
}

function plan(skillId, opts, config) {
  const skill = resolveSkill(config, skillId);
  if (!isUmbrella(skill)) return planAtomic(skillId, opts, config);
  const branch = resolveBaseBranch(opts);
  const head = git(['rev-parse', branch]);
  const nestedBySkill = {};
  for (const wave of skill.waves ?? []) {
    for (const nestedId of wave.skills ?? []) {
      if (!nestedBySkill[nestedId]) {
        nestedBySkill[nestedId] = planAtomic(nestedId, opts, config);
        nestedBySkill[nestedId].maxLaunch = maxLaunchOf(config, config.skills[nestedId]);
      }
    }
  }
  return planUmbrellaWaves({
    waves: skill.waves,
    nestedBySkill,
    maxLaunch: maxLaunchOf(config, skill),
    waveFilter: opts.wave ?? null,
    baseBranch: branch,
    head,
    force: Boolean(opts.force),
    skillId,
  });
}

function parseCsv(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function record(skillId, ids, opts, config) {
  if (!ids.length) usage();
  const skill = resolveSkill(config, skillId);
  if (isUmbrella(skill)) {
    throw new Error('record each nested skill, not platform-quality');
  }
  if (skill.discover === 'e2e-features') {
    return recordE2eFindings(ids, opts);
  }
  const sha = opts.commit
    ? git(['rev-parse', '--verify', `${opts.commit}^{commit}`])
    : git(['rev-parse', resolveBaseBranch(opts)]);
  const discovered = new Map(discover(skill).map((a) => [a.id, a]));
  const lastRuns = loadLastRuns(skill);
  const beforeApps = structuredClone(lastRuns.apps);
  const recordedAt = new Date().toISOString();
  const key = incompleteKey(skill);
  const items =
    key === 'incompletePages'
      ? parseCsv(opts.incompletePages)
      : key === 'incompleteFiles'
        ? parseCsv(opts.incompleteFiles)
        : [];

  for (const id of ids) {
    const app = discovered.get(id);
    if (!app) throw new Error(`unknown tree id '${id}' — not in the trees list for this skill`);
    const entry = { path: app.path, lastCommit: sha, recordedAt };
    if (key) entry[key] = items;
    lastRuns.apps[id] = entry;
  }

  const dest = lastRunsFile(skill);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, `${JSON.stringify(lastRuns, null, 2)}\n`, 'utf8');
  const lastRunsCommit = commitLastRunsIfNeeded({
    beforeApps,
    afterApps: lastRuns.apps,
    ids,
    skillId,
    relPath: skill.lastRunsPath,
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true }),
    runGit: (args, options) => git(args, options),
  });
  const result = {
    skill: skillId,
    lastRunsPath: skill.lastRunsPath,
    commit: sha,
    ids,
    lastRunsCommitted: lastRunsCommit.committed,
  };
  if (lastRunsCommit.message) result.lastRunsMessage = lastRunsCommit.message;
  if (lastRunsCommit.commit) result.lastRunsCommit = lastRunsCommit.commit;
  if (key) result[key] = items;
  return result;
}

function closeHelpers() {
  return {
    removeDir: (p) => rmSync(p, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }),
    exists: (p) => existsSync(p),
  };
}

function closeHere() {
  const here = process.cwd();
  const listPorcelain = git(['worktree', 'list', '--porcelain']);
  const listed = parseWorktreeList(listPorcelain);
  const primaryPath = listed[0]?.path;
  if (!primaryPath) {
    throw new Error('cannot resolve the primary checkout from this directory');
  }
  const closed = closeOpenedWorktrees({
    here,
    deleteBranch: false,
    primaryPath,
    listPorcelain,
    runGit: (args, options) => git(args, options),
    ...closeHelpers(),
  });
  return closed;
}

function closeSkill(skillId, ids, opts, config) {
  if (!opts.baseWorktree && (!skillId || !ids.length)) usage();
  const listPorcelain = git(['worktree', 'list', '--porcelain']);
  const listed = parseWorktreeList(listPorcelain);
  const primaryPath = listed[0]?.path || ROOT;
  const branches = [];
  if (skillId && ids.length) {
    const skill = resolveSkill(config, skillId);
    if (isUmbrella(skill)) {
      throw new Error('close each nested skill, not platform-quality');
    }
    for (const id of ids) {
      branches.push(`${skillId}-${id}`);
    }
  }
  const closed = closeOpenedWorktrees({
    branches,
    baseWorktree: opts.baseWorktree ? resolveBaseBranch(opts) : null,
    deleteBranch: true,
    primaryPath,
    listPorcelain,
    runGit: (args, options) => git(args, options),
    ...closeHelpers(),
  });
  return closed;
}

function parseArgs(argv) {
  const positional = [];
  const opts = {
    skill: null,
    apps: [],
    force: false,
    commit: null,
    incompletePages: null,
    incompleteFiles: null,
    finding: null,
    wave: null,
    base: null,
    here: false,
    baseWorktree: false,
    ids: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--force') opts.force = true;
    else if (arg === '--skill') opts.skill = argv[++i];
    else if (arg === '--app') opts.apps.push(argv[++i]);
    else if (arg === '--commit') opts.commit = argv[++i];
    else if (arg === '--incomplete-pages') opts.incompletePages = argv[++i];
    else if (arg === '--incomplete-files') opts.incompleteFiles = argv[++i];
    else if (arg === '--finding') opts.finding = argv[++i];
    else if (arg === '--here') opts.here = true;
    else if (arg === '--base-worktree') opts.baseWorktree = true;
    else if (arg === '--wave') {
      const parsed = parseWaveArg(argv[++i]);
      if (!parsed) usage();
      opts.wave = parsed;
    } else if (arg === '--base') opts.base = argv[++i];
    else if (arg === '--help' || arg === '-h') usage(0);
    else if (arg.startsWith('-')) usage();
    else positional.push(arg);
  }
  return { cmd: positional[0], opts: { ...opts, ids: positional.slice(1) } };
}

export function main(argv = process.argv.slice(2)) {
  const { cmd, opts } = parseArgs(argv);
  const config = loadConfig();
  let result;
  if (cmd === 'list') result = listSkillsFromConfig(config, resolveBaseBranch());
  else if (cmd === 'plan') result = plan(opts.skill, opts, config);
  else if (cmd === 'record') result = record(opts.skill, opts.ids, opts, config);
  else if (cmd === 'close')
    result = opts.here ? closeHere() : closeSkill(opts.skill, opts.ids, opts, config);
  else usage(cmd ? 1 : 0);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}
