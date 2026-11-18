#!/usr/bin/env node
import { readFile, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DRIVER = 'sqlite';
const DEFAULT_DSN = './data/db/memries.db';

const USAGE = `Usage: db-clear [--driver sqlite|postgres] [--dsn PATH] [--env-file PATH]

Empty the Memries catalog so the next Index run rebuilds it (ADR 0014).
Deletes the SQLite catalog file and its -wal / -shm siblings.
Does not touch ./data/photos or the thumb cache.

Defaults: ${DEFAULT_DRIVER} / ${DEFAULT_DSN}
Reads MEMRIES_DB_DRIVER, MEMRIES_DB_DSN, DB_DRIVER, DB_DSN (.env or environment)
`;

/**
 * @param {string[]} argv
 * @returns {{ driver?: string, dsn?: string, envFile?: string, help: boolean }}
 */
export function parseArgs(argv) {
  /** @type {{ driver?: string, dsn?: string, envFile?: string, help: boolean }} */
  const out = { help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      out.help = true;
      continue;
    }
    const take = () => {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`missing value for ${arg}`);
      }
      i += 1;
      return value;
    };
    if (arg === '--driver') out.driver = take();
    else if (arg === '--dsn') out.dsn = take();
    else if (arg === '--env-file') out.envFile = take();
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

/**
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseEnvFile(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * sqliteTargets lists every file SQLite may hold for one catalog.
 * @param {string} dsn
 * @returns {string[]}
 */
export function sqliteTargets(dsn) {
  return [dsn, `${dsn}-wal`, `${dsn}-shm`, `${dsn}-journal`];
}

/**
 * hostDsn maps a container path to the host bind mount, so `make db-clear`
 * works from the repo root while the backend sees /data/db.
 * @param {string} dsn
 * @returns {string}
 */
export function hostDsn(dsn) {
  if (dsn.startsWith('/data/db/')) return `./data/db/${dsn.slice('/data/db/'.length)}`;
  return dsn;
}

/**
 * @param {string[]} argv
 * @param {{
 *   readFile?: typeof readFile,
 *   rm?: typeof rm,
 *   stat?: typeof stat,
 *   env?: NodeJS.ProcessEnv,
 *   cwd?: string,
 *   log?: (...args: unknown[]) => void,
 *   error?: (...args: unknown[]) => void,
 * }} [deps]
 */
export async function main(argv, deps = {}) {
  const readFileImpl = deps.readFile ?? readFile;
  const rmImpl = deps.rm ?? rm;
  const statImpl = deps.stat ?? stat;
  const env = deps.env ?? process.env;
  const cwd = deps.cwd ?? process.cwd();
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;

  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    error(USAGE.trim());
    return 1;
  }
  if (args.help) {
    log(USAGE.trim());
    return 0;
  }

  const fileEnv = await loadEnvFile(args.envFile, cwd, readFileImpl);
  const pick = (/** @type {string[]} */ keys) => {
    for (const key of keys) {
      if (env[key]) return env[key];
      if (fileEnv[key]) return fileEnv[key];
    }
    return undefined;
  };

  const driver = (
    args.driver ||
    pick(['MEMRIES_DB_DRIVER', 'DB_DRIVER']) ||
    DEFAULT_DRIVER
  ).toLowerCase();

  if (driver === 'postgres') {
    error(
      'db-clear only empties a SQLite catalog. For postgres, drop and recreate the database with your own tooling.',
    );
    return 1;
  }
  if (driver !== 'sqlite') {
    error(`unsupported driver: ${driver} (want sqlite or postgres)`);
    return 1;
  }

  const rawDsn = args.dsn || pick(['MEMRIES_DB_DSN', 'DB_DSN']) || DEFAULT_DSN;
  const dsn = hostDsn(rawDsn);
  const base = isAbsolute(dsn) ? dsn : resolve(cwd, dsn);

  const removed = [];
  for (const target of sqliteTargets(base)) {
    try {
      await statImpl(target);
    } catch {
      continue;
    }
    await rmImpl(target, { force: true });
    removed.push(target);
  }

  if (removed.length === 0) {
    log(`no SQLite catalog at ${base} (nothing to clear)`);
  } else {
    log(`cleared catalog: ${removed.join(', ')}`);
  }
  return 0;
}

/**
 * @param {string | undefined} envFile
 * @param {string} cwd
 * @param {typeof readFile} readFileImpl
 */
async function loadEnvFile(envFile, cwd, readFileImpl) {
  const path = envFile
    ? isAbsolute(envFile)
      ? envFile
      : resolve(cwd, envFile)
    : join(cwd, '.env');
  try {
    return parseEnvFile(await readFileImpl(path, 'utf8'));
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return {};
    }
    throw err;
  }
}

const invoked =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invoked) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    });
}
