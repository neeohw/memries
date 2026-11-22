#!/usr/bin/env node
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { goEnv, packageRoot, runGo } from './run-go.mjs';

/**
 * MEMRIES_INDEXER_VIPS=1 builds the indexer against libvips instead of the
 * pure Go renderer (ADR 0015). HEIC can only be decoded that way, so the
 * Compose image sets it and matches what the box runs — otherwise indexing a
 * HEIC fails per file, which is exactly the trap IsMedia accepting it in
 * every build would otherwise leave (ADR 0026).
 *
 * It needs libvips-dev and a C toolchain, so it stays opt-in: a plain
 * checkout still builds with nothing installed.
 */
export function indexerTarget(binDir, { env = process.env } = {}) {
  const out = join(binDir, 'indexer');
  if (env.MEMRIES_INDEXER_VIPS === '1') {
    return {
      args: ['build', '-tags', 'vips', '-o', out, './cmd/indexer'],
      env: goEnv({ CGO_ENABLED: '1' }, { base: env }),
    };
  }
  return { args: ['build', '-o', out, './cmd/indexer'], env: goEnv({}, { base: env }) };
}

export function main() {
  const binDir = join(packageRoot, 'bin');
  mkdirSync(binDir, { recursive: true });
  const indexer = indexerTarget(binDir);
  const targets = [
    // The server decodes nothing, so it stays a pure Go build whatever the
    // indexer does (ADR 0025).
    { args: ['build', '-o', join(binDir, 'server'), './cmd/server'], env: goEnv() },
    indexer,
  ];
  for (const { args, env } of targets) {
    const status = runGo(args, { env });
    if (status !== 0) return status;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
