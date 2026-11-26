#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_PLATFORM = 'linux/arm64';
const DEFAULT_OUT = 'dist/pi';
// Matches Dockerfile.backend's ARG GO_VERSION so both images use one toolchain.
const DEFAULT_GO_VERSION = '1.26.11';

/** The buildx stage that exports each selection (docker/Dockerfile.pi). */
const EXPORT_STAGES = {
  both: 'export',
  server: 'export-server',
  indexer: 'export-indexer',
};

const USAGE = `Usage: build-pi [--out DIR] [--platform linux/arm64] [--go-version X.Y.Z]
                [--server-only | --indexer-only] [--keep-debug]

Build the Memries binaries for the box (ADR 0025).

Both are cgo, -tags vips, built inside a debian:trixie container so they link
the same glibc and libvips the box has. HEIC needs native decode: pure Go
measured 4.6-24.7s per 12MP frame on an A53 against ~0.8s native.

The server is one of them because it runs the index coordinator in-process:
pressing Scan in the UI renders thumbnails inside the server, so a pure
server cannot import a HEIC.

The box needs 'apt install libvips42t64 ffmpeg' — libvips is linked in,
ffmpeg is run as a program to read video. Requires Docker.

Defaults: --out ${DEFAULT_OUT} --platform ${DEFAULT_PLATFORM} --go-version ${DEFAULT_GO_VERSION}
`;

/**
 * @param {string[]} argv
 * @returns {{ out: string, platform: string, goVersion: string,
 *   server: boolean, indexer: boolean, keepDebug: boolean, help: boolean }}
 */
export function parseArgs(argv) {
  const out = {
    out: DEFAULT_OUT,
    platform: DEFAULT_PLATFORM,
    goVersion: DEFAULT_GO_VERSION,
    server: true,
    indexer: true,
    keepDebug: false,
    help: false,
  };
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
    if (arg === '--out') out.out = take();
    else if (arg === '--platform') out.platform = take();
    else if (arg === '--go-version') out.goVersion = take();
    else if (arg === '--keep-debug') out.keepDebug = true;
    else if (arg === '--server-only') out.indexer = false;
    else if (arg === '--indexer-only') out.server = false;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!out.server && !out.indexer) {
    throw new Error('--server-only and --indexer-only are mutually exclusive');
  }
  return out;
}

/**
 * validatePlatform rejects a typo here rather than letting buildx fail
 * several seconds into a pull.
 * @param {string} platform
 */
export function validatePlatform(platform) {
  const [os, arch] = platform.split('/');
  if (!os || !arch) throw new Error(`malformed platform: ${platform}`);
}

/**
 * exportStage picks the scratch stage holding exactly the requested
 * binaries, so --server-only does not drop an indexer next to it.
 * @param {{ server: boolean, indexer: boolean }} selection
 * @returns {string}
 */
export function exportStage({ server, indexer }) {
  if (server && indexer) return EXPORT_STAGES.both;
  return server ? EXPORT_STAGES.server : EXPORT_STAGES.indexer;
}

/**
 * buildArgs drives buildx. --target is a scratch stage holding only the
 * binaries, and --output type=local writes them to disk instead of leaving
 * an image behind.
 * @param {{ dockerfile: string, context: string, platform: string,
 *   outDir: string, goVersion: string, target: string, keepDebug?: boolean }} opts
 * @returns {string[]}
 */
export function buildArgs({
  dockerfile,
  context,
  platform,
  outDir,
  goVersion,
  target,
  keepDebug = false,
}) {
  return [
    'buildx',
    'build',
    '--platform',
    platform,
    '--build-arg',
    `GO_VERSION=${goVersion}`,
    // Empty keeps the symbol and DWARF tables the default strips.
    '--build-arg',
    `LDFLAGS=${keepDebug ? '' : '-s -w'}`,
    '-f',
    dockerfile,
    '--target',
    target,
    '--output',
    `type=local,dest=${outDir}`,
    context,
  ];
}

/**
 * @param {string[]} argv
 * @param {{
 *   spawn?: typeof spawnSync,
 *   mkdir?: typeof mkdir,
 *   cwd?: string,
 *   log?: (...args: unknown[]) => void,
 *   error?: (...args: unknown[]) => void,
 * }} [deps]
 */
export async function main(argv, deps = {}) {
  const spawn = deps.spawn ?? spawnSync;
  const mkdirImpl = deps.mkdir ?? mkdir;
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  const repoRoot = deps.cwd ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

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

  const outDir = resolve(repoRoot, args.out);
  const backendDir = join(repoRoot, 'apps', 'backend');
  await mkdirImpl(outDir, { recursive: true });

  try {
    validatePlatform(args.platform);
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const wanted = [args.server && 'memries-server', args.indexer && 'memries-indexer'].filter(
    Boolean,
  );
  log(`${wanted.join(' + ')} -> ${args.out}/ (${args.platform}, cgo + libvips)`);

  const result = spawn(
    'docker',
    buildArgs({
      dockerfile: join(repoRoot, 'docker', 'Dockerfile.pi'),
      context: backendDir,
      platform: args.platform,
      outDir,
      goVersion: args.goVersion,
      target: exportStage(args),
      keepDebug: args.keepDebug,
    }),
    { cwd: repoRoot, stdio: 'inherit' },
  );
  if (result.error) {
    error(`docker is not available (${result.error.message}).`);
    error('Both binaries are cgo builds against libvips, so the container is how they are made.');
    return 1;
  }
  if (result.status !== 0) return result.status ?? 1;
  log('');
  log('The box needs: apt install libvips42t64 ffmpeg');

  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)));
}
