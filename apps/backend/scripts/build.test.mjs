import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { BINARIES, buildTarget } from './build.mjs';

test('builds pure Go by default, so a plain checkout needs no C toolchain', () => {
  const { args, env } = buildTarget('indexer', '/bin', { env: {} });
  assert.deepEqual(args, ['build', '-o', join('/bin', 'indexer'), './cmd/indexer']);
  assert.equal(env.CGO_ENABLED, '0');
  assert.ok(!args.includes('-tags'));
});

// The server runs the index coordinator in-process, so it needs the same
// renderer the indexer does or Scan fails on every HEIC (ADR 0025).
test('builds every binary against libvips when asked, the server included', () => {
  assert.deepEqual(BINARIES, ['server', 'indexer']);
  for (const name of BINARIES) {
    const { args, env } = buildTarget(name, '/bin', { env: { MEMRIES_VIPS: '1' } });
    assert.deepEqual(args, ['build', '-tags', 'vips', '-o', join('/bin', name), `./cmd/${name}`]);
    assert.equal(env.CGO_ENABLED, '1');
  }
});

// Anything other than exactly "1" leaves the default alone, so a stray empty
// value in an env file cannot silently require a C toolchain.
test('ignores other values', () => {
  for (const value of ['', '0', 'true', 'yes']) {
    const { args, env } = buildTarget('server', '/bin', { env: { MEMRIES_VIPS: value } });
    assert.ok(!args.includes('-tags'), `${value} should not enable vips`);
    assert.equal(env.CGO_ENABLED, '0');
  }
});
