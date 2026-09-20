/**
 * When to Conventional-Commit a skill last-runs.json after `record`.
 * The executing parent owns this file (and the README last-runs tag).
 */
import { join } from 'node:path';
const AGENT_WORKTREE_BRANCH_RE =
  /^(frontend|backend|platform)-(format|lint|page-accessibility)-|^scripts-to-node-|^e2e-docker-/;

export function isAgentWorktreeBranch(name) {
  return AGENT_WORKTREE_BRANCH_RE.test(name);
}

function findingKey(finding) {
  return JSON.stringify(finding ?? null);
}

export function parseFinding(raw) {
  if (raw == null || raw === '') return null;
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('--finding must be a JSON object');
  }
  if (parsed.status !== 'passed' && parsed.status !== 'failed') {
    throw new Error('--finding.status must be passed or failed');
  }
  const finding = { status: parsed.status };
  if (parsed.summary != null) finding.summary = String(parsed.summary);
  if (parsed.composeProject != null) finding.composeProject = String(parsed.composeProject);
  if (parsed.suiteCommit != null) finding.suiteCommit = String(parsed.suiteCommit);
  return finding;
}

export const SUITE_ID = 'memries';
export const SUITE_PATH = 'apps/e2e';
export const SUITE_COMPOSE_PROJECT = 'memries-e2e';
export const SUITE_ORIGIN = 'http://localhost:18080';

export function applyE2eRecord({ previous, path, sha, recordedAt, finding }) {
  const entry = { path, recordedAt };
  if (finding?.status === 'passed' && sha) {
    entry.lastCommit = sha;
  } else if (previous?.lastCommit) {
    entry.lastCommit = previous.lastCommit;
  }
  if (finding) entry.finding = finding;
  return entry;
}

/** First suite record drops leftover per-feature last-run keys. */
export function suiteLastRunsAfterRecord({ previousApps = {}, path, sha, recordedAt, finding }) {
  return {
    [SUITE_ID]: applyE2eRecord({
      previous: previousApps[SUITE_ID],
      path,
      sha,
      recordedAt,
      finding,
    }),
  };
}

export function lastRunsNeedCommit(beforeApps, afterApps, ids) {
  for (const id of ids) {
    const before = beforeApps?.[id];
    const after = afterApps?.[id];
    if (!after) continue;
    if (!before) return true;
    if (before.recordedAt !== after.recordedAt) return true;
    if (before.lastCommit !== after.lastCommit) return true;
    if (findingKey(before.finding) !== findingKey(after.finding)) return true;
  }
  return false;
}

export function lastRunsCommitMessage(skillId, ids, beforeApps) {
  const added = ids.filter((id) => !beforeApps?.[id]);
  const who = ids.length <= 4 ? ids.join(', ') : `${ids.length} trees`;
  if (added.length === ids.length) {
    return `chore(${skillId}): add last-run for ${who}`;
  }
  return `chore(${skillId}): record last-run for ${who}`;
}

export function lastRunsCommitTarget({ root, lastRunsPath, suitePath }) {
  const rel = String(lastRunsPath || '').replaceAll('\\', '/');
  const suite = String(suitePath || '')
    .replaceAll('\\', '/')
    .replace(/\/$/, '');
  if (suite && (rel === suite || rel.startsWith(`${suite}/`))) {
    return {
      cwd: join(root, suite),
      relPath: rel.slice(suite.length).replace(/^\//, ''),
    };
  }
  return { cwd: root, relPath: rel };
}

function dirtyGitPaths(paths, runGit) {
  return paths.filter((rel) => {
    const status = runGit(['status', '--porcelain', '--untracked-files=normal', '--', rel], {
      allowFail: true,
    });
    return Boolean(status && String(status).trim());
  });
}

export function commitLastRunsIfNeeded({
  beforeApps,
  afterApps,
  ids,
  skillId,
  relPath,
  extraPaths = [],
  branch,
  runGit,
}) {
  if (!lastRunsNeedCommit(beforeApps, afterApps, ids)) {
    return { committed: false, reason: 'unchanged' };
  }
  if (!branch || branch === 'HEAD') {
    throw new Error('refusing to commit last-runs.json on a detached HEAD');
  }
  if (isAgentWorktreeBranch(branch)) {
    throw new Error(`refusing to commit last-runs.json on child worktree branch '${branch}'`);
  }
  const paths = [relPath, ...extraPaths.filter(Boolean)];
  const dirty = dirtyGitPaths(paths, runGit);
  if (!dirty.length) {
    return { committed: false, reason: 'clean' };
  }
  const message = lastRunsCommitMessage(skillId, ids, beforeApps);
  runGit(['add', '--', ...dirty]);
  runGit(['commit', '--only', '-m', message, '--', ...dirty]);
  const commit = runGit(['rev-parse', 'HEAD'], { allowFail: true });
  return { committed: true, message, commit: commit || undefined };
}
