import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hostDsn, main, parseArgs, parseEnvFile, sqliteTargets } from './db-clear.mjs';

describe('parseArgs', () => {
  it('reads driver, dsn and env-file', () => {
    assert.deepEqual(
      parseArgs(['--driver', 'sqlite', '--dsn', '/tmp/a.db', '--env-file', '.env.test']),
      { help: false, driver: 'sqlite', dsn: '/tmp/a.db', envFile: '.env.test' },
    );
  });

  it('flags help', () => {
    assert.equal(parseArgs(['--help']).help, true);
    assert.equal(parseArgs(['-h']).help, true);
  });

  it('rejects unknown args and missing values', () => {
    assert.throws(() => parseArgs(['--nope']), /unknown argument/);
    assert.throws(() => parseArgs(['--dsn']), /missing value/);
  });
});

describe('parseEnvFile', () => {
  it('skips blanks and comments, strips quotes', () => {
    assert.deepEqual(
      parseEnvFile('# note\n\nDB_DRIVER=sqlite\nDB_DSN="/data/db/x.db"\nBAD\n'),
      { DB_DRIVER: 'sqlite', DB_DSN: '/data/db/x.db' },
    );
  });
});

describe('sqliteTargets', () => {
  it('covers the catalog and its sidecars', () => {
    assert.deepEqual(sqliteTargets('/d/x.db'), [
      '/d/x.db',
      '/d/x.db-wal',
      '/d/x.db-shm',
      '/d/x.db-journal',
    ]);
  });
});

describe('hostDsn', () => {
  it('maps the container bind mount back to the repo', () => {
    assert.equal(hostDsn('/data/db/memries.db'), './data/db/memries.db');
  });

  it('leaves other paths alone', () => {
    assert.equal(hostDsn('./data/db/memries.db'), './data/db/memries.db');
    assert.equal(hostDsn('/srv/memries.db'), '/srv/memries.db');
  });
});

describe('main', () => {
  const baseDeps = (over = {}) => ({
    readFile: async () => {
      throw Object.assign(new Error('nope'), { code: 'ENOENT' });
    },
    env: {},
    cwd: '/repo',
    log: () => {},
    error: () => {},
    ...over,
  });

  it('removes the catalog and its sidecars', async () => {
    const removed = [];
    const status = await main(['--dsn', '/data/db/memries.db'], baseDeps({
      stat: async () => ({}),
      rm: async (path) => removed.push(path),
    }));
    assert.equal(status, 0);
    assert.deepEqual(removed, [
      '/repo/data/db/memries.db',
      '/repo/data/db/memries.db-wal',
      '/repo/data/db/memries.db-shm',
      '/repo/data/db/memries.db-journal',
    ]);
  });

  it('skips files that are not there', async () => {
    const removed = [];
    const logs = [];
    const status = await main(['--dsn', '/tmp/missing.db'], baseDeps({
      stat: async () => {
        throw new Error('ENOENT');
      },
      rm: async (path) => removed.push(path),
      log: (msg) => logs.push(String(msg)),
    }));
    assert.equal(status, 0);
    assert.deepEqual(removed, []);
    assert.ok(logs.some((line) => line.includes('nothing to clear')));
  });

  it('reads the dsn from the environment', async () => {
    const removed = [];
    await main([], baseDeps({
      env: { MEMRIES_DB_DSN: '/srv/cat.db' },
      stat: async () => ({}),
      rm: async (path) => removed.push(path),
    }));
    assert.ok(removed.includes('/srv/cat.db'));
  });

  it('reads the dsn from .env when the environment is empty', async () => {
    const removed = [];
    await main([], baseDeps({
      readFile: async () => 'DB_DSN=/fromenv/cat.db\n',
      stat: async () => ({}),
      rm: async (path) => removed.push(path),
    }));
    assert.ok(removed.includes('/fromenv/cat.db'));
  });

  it('refuses postgres instead of pretending to clear it', async () => {
    const errors = [];
    const removed = [];
    const status = await main(['--driver', 'postgres'], baseDeps({
      stat: async () => ({}),
      rm: async (path) => removed.push(path),
      error: (msg) => errors.push(String(msg)),
    }));
    assert.equal(status, 1);
    assert.deepEqual(removed, []);
    assert.ok(errors.some((line) => line.includes('postgres')));
  });

  it('rejects an unknown driver', async () => {
    const status = await main(['--driver', 'mysql'], baseDeps({
      stat: async () => ({}),
      rm: async () => {},
    }));
    assert.equal(status, 1);
  });

  it('prints usage for --help', async () => {
    const logs = [];
    const status = await main(['--help'], baseDeps({ log: (msg) => logs.push(String(msg)) }));
    assert.equal(status, 0);
    assert.ok(logs.join('\n').includes('Usage: db-clear'));
  });
});
