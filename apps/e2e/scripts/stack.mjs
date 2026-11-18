#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEFAULT_STACK_PROJECT = 'memries-e2e';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const e2eRoot = dirname(scriptsDir);
const repoRoot = join(e2eRoot, '..', '..');
const composeFile = join(e2eRoot, 'docker-compose.yml');
const envFile = join(repoRoot, '.env');

export const DEFAULT_PORTS = {
  caddy: 18080,
  backend: 18081,
  frontend: 15173,
};

function envPort(env, name, fallback) {
  const raw = env[name];
  const n = raw == null || raw === '' ? NaN : Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env */
export function resolveStackConfig(env = process.env) {
  const ports = {
    caddy: envPort(env, 'CADDY_HOST_PORT', DEFAULT_PORTS.caddy),
    backend: envPort(env, 'BACKEND_HOST_PORT', DEFAULT_PORTS.backend),
    frontend: envPort(env, 'FRONTEND_HOST_PORT', DEFAULT_PORTS.frontend),
  };
  const origin = env.MEMRIES_E2E_ORIGIN || `http://localhost:${ports.caddy}`;
  const healthz = env.MEMRIES_E2E_HEALTHZ || `http://localhost:${ports.backend}/healthz`;
  return {
    project: env.MEMRIES_E2E_PROJECT || DEFAULT_STACK_PROJECT,
    ports,
    origin,
    healthz,
    publicUrl: origin,
    viteApiBase: origin,
    composeEnv: {
      CADDY_HOST_PORT: String(ports.caddy),
      BACKEND_HOST_PORT: String(ports.backend),
      FRONTEND_HOST_PORT: String(ports.frontend),
      MEMRIES_E2E_ORIGIN: origin,
    },
  };
}

/**
 * @param {ReturnType<typeof resolveStackConfig>} config
 * @param {string} composePath
 * @param {string} envPath
 * @param {string[]} extra
 */
export function composeArgs(config, composePath, envPath, extra) {
  return ['compose', '-p', config.project, '-f', composePath, '--env-file', envPath, ...extra];
}

function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: e2eRoot,
      env: { ...process.env, ...env },
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(url, timeoutMs) {
  const start = Date.now();
  let lastErr = '';
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.ok || (res.status >= 300 && res.status < 400)) return;
      lastErr = `${res.status}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${url} (${lastErr})`);
}

async function dumpLogs(config) {
  try {
    await run(
      'docker',
      composeArgs(config, composeFile, envFile, ['logs', '--tail', '80']),
      config.composeEnv,
    );
  } catch {
    // ignore
  }
}

export async function up(options = {}) {
  const env = options.env ?? process.env;
  if (!options.allowMissingEnv && !existsSync(envFile)) {
    throw new Error(`Missing ${envFile} (see the Memries README quick start)`);
  }
  const config = resolveStackConfig(env);
  const runDocker = options.runDocker ?? run;
  try {
    if (!options.skipFixtures) {
      const fixtures = await import(pathToFileURL(join(scriptsDir, 'prepare-fixtures.mjs')).href);
      await fixtures.prepareAll();
    }
    await runDocker(
      'docker',
      composeArgs(config, composeFile, envFile, ['up', '-d', '--build']),
      config.composeEnv,
    );
    if (!options.skipWait) {
      await waitFor(config.origin, 170_000);
      await waitFor(config.healthz, 60_000);
    }
  } catch (err) {
    if (!options.skipLogs) await dumpLogs(config);
    throw err;
  }
}

export async function down(wipe, options = {}) {
  const env = options.env ?? process.env;
  const config = resolveStackConfig(env);
  const runDocker = options.runDocker ?? run;
  const extra = wipe ? ['down', '-v', '--remove-orphans'] : ['down', '--remove-orphans'];
  await runDocker('docker', composeArgs(config, composeFile, envFile, extra), config.composeEnv);
}

const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  const cmd = process.argv[2] ?? 'up';
  const wipe = process.argv.includes('--wipe');

  if (cmd === 'up') {
    await up();
    // Playwright's webServer expects a long-lived process; exiting right after `compose up -d`
    // races its own URL poll and fails with "exited early". Stay alive until it stops us.
    if (process.argv.includes('--hold')) {
      const keepAlive = setInterval(() => {}, 1 << 30);
      await new Promise((resolve) => {
        process.once('SIGTERM', resolve);
        process.once('SIGINT', resolve);
      });
      clearInterval(keepAlive);
    }
  } else if (cmd === 'down') {
    await down(wipe);
  } else {
    console.error('Usage: node scripts/stack.mjs <up [--hold]|down [--wipe]>');
    process.exit(1);
  }
}
