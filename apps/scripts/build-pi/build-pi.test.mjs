import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { goPlatform, indexerBuildArgs, main, parseArgs, serverBuildArgs } from './build-pi.mjs';

test('parseArgs defaults to the box', () => {
  const args = parseArgs([]);
  assert.equal(args.platform, 'linux/arm64');
  assert.equal(args.out, 'dist/pi');
  assert.equal(args.server, true);
  assert.equal(args.indexer, true);
  assert.equal(args.keepDebug, false);
});

test('parseArgs reads every flag', () => {
  const args = parseArgs([
    '--out',
    'build',
    '--platform',
    'linux/amd64',
    '--go-version',
    '1.27.0',
    '--keep-debug',
  ]);
  assert.deepEqual(
    { out: args.out, platform: args.platform, goVersion: args.goVersion, keepDebug: args.keepDebug },
    { out: 'build', platform: 'linux/amd64', goVersion: '1.27.0', keepDebug: true },
  );
});

test('parseArgs can build one half alone', () => {
  assert.equal(parseArgs(['--server-only']).indexer, false);
  assert.equal(parseArgs(['--server-only']).server, true);
  assert.equal(parseArgs(['--indexer-only']).server, false);
});

// Asking for both halves to be skipped is a typo, not a no-op build.
test('parseArgs rejects skipping both halves', () => {
  assert.throws(() => parseArgs(['--server-only', '--indexer-only']), /mutually exclusive/);
});

test('parseArgs rejects an unknown flag and a missing value', () => {
  assert.throws(() => parseArgs(['--nope']), /unknown argument/);
  assert.throws(() => parseArgs(['--out']), /missing value/);
  assert.throws(() => parseArgs(['--out', '--platform']), /missing value/);
});

// One --platform drives both halves, so the Go build and the container build
// cannot disagree about the target.
test('goPlatform maps Docker platforms onto GOOS/GOARCH', () => {
  assert.deepEqual(goPlatform('linux/arm64'), { GOOS: 'linux', GOARCH: 'arm64' });
  assert.deepEqual(goPlatform('linux/amd64'), { GOOS: 'linux', GOARCH: 'amd64' });
});

// Docker spells 32-bit ARM linux/arm/v7; Go wants GOARCH=arm with GOARM=7.
test('goPlatform translates the 32-bit ARM variant', () => {
  assert.deepEqual(goPlatform('linux/arm/v7'), { GOOS: 'linux', GOARCH: 'arm', GOARM: '7' });
});

test('goPlatform rejects a malformed platform', () => {
  assert.throws(() => goPlatform('arm64'), /malformed platform/);
});

test('serverBuildArgs strips symbols by default and keeps them on request', () => {
  assert.deepEqual(serverBuildArgs({ outDir: '/out', keepDebug: false }), [
    'build',
    '-trimpath',
    '-ldflags',
    '-s -w',
    '-o',
    join('/out', 'server'),
    './cmd/server',
  ]);

  assert.deepEqual(serverBuildArgs({ outDir: '/out', keepDebug: true }), [
    'build',
    '-trimpath',
    '-o',
    join('/out', 'server'),
    './cmd/server',
  ]);
});

test('indexerBuildArgs exports the binary instead of leaving an image', () => {
  const args = indexerBuildArgs({
    dockerfile: '/repo/docker/Dockerfile.pi-indexer',
    context: '/repo/apps/backend',
    platform: 'linux/arm64',
    outDir: '/repo/dist/pi',
    goVersion: '1.26.11',
  });
  assert.deepEqual(args.slice(0, 2), ['buildx', 'build']);
  assert.ok(args.includes('--platform'));
  assert.equal(args[args.indexOf('--platform') + 1], 'linux/arm64');
  assert.equal(args[args.indexOf('--target') + 1], 'export');
  assert.equal(args[args.indexOf('--output') + 1], 'type=local,dest=/repo/dist/pi');
  assert.equal(args[args.indexOf('--build-arg') + 1], 'GO_VERSION=1.26.11');
  assert.equal(args.at(-1), '/repo/apps/backend');
});

function fakeDeps({ statuses = {} } = {}) {
  const calls = [];
  const logs = [];
  return {
    calls,
    logs,
    deps: {
      cwd: '/repo',
      mkdir: async () => undefined,
      log: (...a) => logs.push(a.join(' ')),
      error: (...a) => logs.push(a.join(' ')),
      spawn: (cmd, args, opts) => {
        calls.push({ cmd, args, opts });
        return statuses[cmd] ?? { status: 0 };
      },
    },
  };
}

test('main builds the server with cgo off and the indexer through docker', async () => {
  const { calls, deps } = fakeDeps();
  assert.equal(await main([], deps), 0);

  const [server, indexer] = calls;
  assert.equal(server.cmd, 'go');
  assert.equal(server.opts.env.CGO_ENABLED, '0');
  assert.equal(server.opts.env.GOARCH, 'arm64');
  assert.equal(server.opts.cwd, join('/repo', 'apps', 'backend'));

  assert.equal(indexer.cmd, 'docker');
  assert.ok(indexer.args.includes('--platform'));
});

test('main skips the docker half for --server-only', async () => {
  const { calls, deps } = fakeDeps();
  assert.equal(await main(['--server-only'], deps), 0);
  assert.deepEqual(
    calls.map((c) => c.cmd),
    ['go'],
  );
});

test('main skips the go half for --indexer-only', async () => {
  const { calls, deps } = fakeDeps();
  assert.equal(await main(['--indexer-only'], deps), 0);
  assert.deepEqual(
    calls.map((c) => c.cmd),
    ['docker'],
  );
});

// A failed server build must not go on to produce an indexer beside a
// binary that is not there.
test('main stops at the first failure', async () => {
  const { calls, deps } = fakeDeps({ statuses: { go: { status: 2 } } });
  assert.equal(await main([], deps), 2);
  assert.deepEqual(
    calls.map((c) => c.cmd),
    ['go'],
  );
});

test('main explains a missing docker rather than reporting a build failure', async () => {
  const { logs, deps } = fakeDeps({
    statuses: { docker: { error: new Error('spawn docker ENOENT') } },
  });
  assert.equal(await main(['--indexer-only'], deps), 1);
  assert.ok(logs.some((l) => l.includes('docker is not available')));
  assert.ok(logs.some((l) => l.includes('--server-only')));
});

test('main explains a missing go toolchain', async () => {
  const { logs, deps } = fakeDeps({
    statuses: { go: { error: new Error('spawn go ENOENT') } },
  });
  assert.equal(await main(['--server-only'], deps), 1);
  assert.ok(logs.some((l) => l.includes('go is not available')));
  assert.ok(logs.some((l) => l.includes('install-requirements')));
});

// The indexer is the only half with a system dependency, so the run says so.
test('main names the package the box needs', async () => {
  const { logs, deps } = fakeDeps();
  await main(['--indexer-only'], deps);
  assert.ok(logs.some((l) => l.includes('libvips42t64')));
});

test('main reports a bad platform without spawning anything', async () => {
  const { calls, logs, deps } = fakeDeps();
  assert.equal(await main(['--platform', 'nonsense'], deps), 1);
  assert.deepEqual(calls, []);
  assert.ok(logs.some((l) => l.includes('malformed platform')));
});

test('main prints usage for --help', async () => {
  const { calls, logs, deps } = fakeDeps();
  assert.equal(await main(['--help'], deps), 0);
  assert.deepEqual(calls, []);
  assert.ok(logs.some((l) => l.includes('Usage: build-pi')));
});
