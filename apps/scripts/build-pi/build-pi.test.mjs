import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildArgs, exportStage, main, parseArgs, validatePlatform } from './build-pi.mjs';

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

// Both binaries come out of one container build, so a selection is a choice
// of export stage rather than a different toolchain (ADR 0025).
test('exportStage picks the stage holding exactly what was asked for', () => {
  assert.equal(exportStage({ server: true, indexer: true }), 'export');
  assert.equal(exportStage({ server: true, indexer: false }), 'export-server');
  assert.equal(exportStage({ server: false, indexer: true }), 'export-indexer');
});

test('validatePlatform rejects a malformed platform', () => {
  assert.throws(() => validatePlatform('arm64'), /malformed platform/);
  assert.equal(validatePlatform('linux/arm64'), undefined);
  assert.equal(validatePlatform('linux/arm/v7'), undefined);
});

test('buildArgs exports the binaries instead of leaving an image', () => {
  const args = buildArgs({
    dockerfile: '/repo/docker/Dockerfile.pi',
    context: '/repo/apps/backend',
    platform: 'linux/arm64',
    outDir: '/repo/dist/pi',
    goVersion: '1.26.11',
    target: 'export',
  });
  assert.deepEqual(args.slice(0, 2), ['buildx', 'build']);
  assert.equal(args[args.indexOf('--platform') + 1], 'linux/arm64');
  assert.equal(args[args.indexOf('--target') + 1], 'export');
  assert.equal(args[args.indexOf('--output') + 1], 'type=local,dest=/repo/dist/pi');
  assert.equal(args[args.indexOf('-f') + 1], '/repo/docker/Dockerfile.pi');
  assert.ok(args.includes('GO_VERSION=1.26.11'));
  assert.ok(args.includes('LDFLAGS=-s -w'));
  assert.equal(args.at(-1), '/repo/apps/backend');
});

// --keep-debug has to reach the container, which is where the build happens.
test('buildArgs keeps the symbol tables on request', () => {
  const args = buildArgs({
    dockerfile: '/d',
    context: '/c',
    platform: 'linux/arm64',
    outDir: '/o',
    goVersion: '1.26.11',
    target: 'export',
    keepDebug: true,
  });
  assert.ok(args.includes('LDFLAGS='));
  assert.ok(!args.includes('LDFLAGS=-s -w'));
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

// The server is a cgo build too, because it runs the index coordinator
// in-process: a pure server fails every HEIC that Scan hands it (ADR 0025).
test('main builds both binaries in one container', async () => {
  const { calls, deps } = fakeDeps();
  assert.equal(await main([], deps), 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, 'docker');
  assert.equal(calls[0].args[calls[0].args.indexOf('--target') + 1], 'export');
  assert.ok(calls[0].args.some((a) => String(a).endsWith('Dockerfile.pi')));
});

test('main exports one binary alone when asked', async () => {
  for (const [flag, stage] of [
    ['--server-only', 'export-server'],
    ['--indexer-only', 'export-indexer'],
  ]) {
    const { calls, deps } = fakeDeps();
    assert.equal(await main([flag], deps), 0);
    assert.deepEqual(
      calls.map((c) => c.cmd),
      ['docker'],
    );
    assert.equal(calls[0].args[calls[0].args.indexOf('--target') + 1], stage);
  }
});

test('main passes a failed build through', async () => {
  const { deps } = fakeDeps({ statuses: { docker: { status: 2 } } });
  assert.equal(await main([], deps), 2);
});

test('main explains a missing docker rather than reporting a build failure', async () => {
  const { logs, deps } = fakeDeps({
    statuses: { docker: { error: new Error('spawn docker ENOENT') } },
  });
  assert.equal(await main([], deps), 1);
  assert.ok(logs.some((l) => l.includes('docker is not available')));
  assert.ok(logs.some((l) => l.includes('cgo builds against libvips')));
});

// Both binaries link libvips, and video needs ffmpeg beside it, so the run
// says what the box needs.
test('main names the package the box needs', async () => {
  const { logs, deps } = fakeDeps();
  await main([], deps);
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
