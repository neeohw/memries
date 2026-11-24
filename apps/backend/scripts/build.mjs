#!/usr/bin/env node
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { goEnv, packageRoot, runGo } from './run-go.mjs';

/** The binaries this package produces, each from ./cmd/<name>. */
export const BINARIES = ['server', 'indexer'];

/**
 * MEMRIES_VIPS=1 builds against libvips instead of the pure Go renderer
 * (ADR 0015). HEIC can only be decoded that way.
 *
 * It applies to **both** binaries. The server was left pure on the theory
 * that it decodes nothing, which was wrong: cmd/server runs the index
 * coordinator in-process, so pressing Scan renders thumbnails inside the
 * server and a pure server fails every HEIC it is handed (ADR 0025).
 *
 * It needs libvips-dev and a C toolchain, so it stays opt-in: a plain
 * checkout still builds with nothing installed, and the result still runs —
 * it just refuses HEIC, saying which build is needed.
 */
export function buildTarget(name, binDir, { env = process.env } = {}) {
  const out = join(binDir, name);
  if (env.MEMRIES_VIPS === '1') {
    return {
      args: ['build', '-tags', 'vips', '-o', out, `./cmd/${name}`],
      env: goEnv({ CGO_ENABLED: '1' }, { base: env }),
    };
  }
  return { args: ['build', '-o', out, `./cmd/${name}`], env: goEnv({}, { base: env }) };
}

export function main() {
  const binDir = join(packageRoot, 'bin');
  mkdirSync(binDir, { recursive: true });
  for (const name of BINARIES) {
    const { args, env } = buildTarget(name, binDir);
    const status = runGo(args, { env });
    if (status !== 0) return status;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
