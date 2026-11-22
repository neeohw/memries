import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { indexerTarget } from './build.mjs';

// The server decodes nothing and stays pure Go; only the indexer needs cgo,
// and only so HEIC can be decoded (ADR 0025/0026).
test('indexerTarget builds pure Go by default', () => {
  const { args, env } = indexerTarget('/bin', { env: {} });
  assert.deepEqual(args, ['build', '-o', join('/bin', 'indexer'), './cmd/indexer']);
  assert.equal(env.CGO_ENABLED, '0');
  assert.ok(!args.includes('-tags'));
});

test('indexerTarget builds against libvips when asked', () => {
  const { args, env } = indexerTarget('/bin', { env: { MEMRIES_INDEXER_VIPS: '1' } });
  assert.deepEqual(args, [
    'build',
    '-tags',
    'vips',
    '-o',
    join('/bin', 'indexer'),
    './cmd/indexer',
  ]);
  assert.equal(env.CGO_ENABLED, '1');
});

// Anything other than exactly "1" leaves the default alone, so a stray empty
// value in an env file cannot silently require a C toolchain.
test('indexerTarget ignores other values', () => {
  for (const value of ['', '0', 'true', 'yes']) {
    const { args, env } = indexerTarget('/bin', { env: { MEMRIES_INDEXER_VIPS: value } });
    assert.ok(!args.includes('-tags'), `${value} should not enable vips`);
    assert.equal(env.CGO_ENABLED, '0');
  }
});
