#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_PLATFORM = 'linux/arm64';
const DEFAULT_OUT = 'dist/pi';
// Matches Dockerfile.backend's ARG GO_VERSION so both images use one toolchain.
const DEFAULT_GO_VERSION = '1.26.11';

const USAGE = `Usage: build-pi [--out DIR] [--platform linux/arm64] [--go-version X.Y.Z]
                [--server-only | --indexer-only] [--keep-debug]

Build the Memries binaries for the box (ADR 0025).

  server   pure Go, CGO_ENABLED=0, built here. Decodes nothing, so it needs
           no system libraries.
  indexer  cgo, -tags vips, built inside a debian:trixie container so it
           links the same glibc and libvips the box has. HEIC needs native
           decode: pure Go measured 4.6-24.7s per 12MP frame on an A53
           against ~0.8s native.

The box needs 'apt install libvips42t64' for the indexer. The server has no
such dependency. Requires Docker for the indexer only.

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
 * goarch maps a Docker platform onto GOOS/GOARCH, so one --platform drives
 * both halves of the build and they cannot disagree about the target.
 * @param {string} platform
 * @returns {{ GOOS: string, GOARCH: string }}
 */
export function goPlatform(platform) {
  const [os, arch, variant] = platform.split('/');
  if (!os || !arch) throw new Error(`malformed platform: ${platform}`);
  // Docker spells 32-bit ARM linux/arm/v7; Go spells it linux/arm GOARM=7.
  if (arch === 'arm' && variant) return { GOOS: os, GOARCH: 'arm', GOARM: variant.replace('v', '') };
  return { GOOS: os, GOARCH: arch };
}

/**
 * serverBuild is the pure-Go half. -trimpath keeps build paths out of the
 * binary; -s -w drop the symbol and DWARF tables, which is most of the size.
 * @param {{ outDir: string, keepDebug: boolean }} opts
 * @returns {string[]}
 */
export function serverBuildArgs({ outDir, keepDebug }) {
  const args = ['build', '-trimpath'];
  if (!keepDebug) args.push('-ldflags', '-s -w');
  args.push('-o', join(outDir, 'server'), './cmd/server');
  return args;
}

/**
 * indexerBuildArgs drives buildx. --target export is a scratch stage holding
 * only the binary, and --output type=local writes it to disk instead of
 * leaving an image behind.
 * @param {{ dockerfile: string, context: string, platform: string,
 *   outDir: string, goVersion: string }} opts
 * @returns {string[]}
 */
export function indexerBuildArgs({ dockerfile, context, platform, outDir, goVersion }) {
  return [
    'buildx',
    'build',
    '--platform',
    platform,
    '--build-arg',
    `GO_VERSION=${goVersion}`,
    '-f',
    dockerfile,
    '--target',
    'export',
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

  if (args.server) {
    let target;
    try {
      target = goPlatform(args.platform);
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      return 1;
    }
    log(`server  -> ${join(args.out, 'server')} (${args.platform}, CGO_ENABLED=0)`);
    const result = spawn('go', serverBuildArgs({ outDir, keepDebug: args.keepDebug }), {
      cwd: backendDir,
      env: { ...process.env, CGO_ENABLED: '0', ...target },
      stdio: 'inherit',
    });
    if (result.error) {
      error(`go is not available (${result.error.message}).`);
      error('Install the host toolchain from apps/scripts/install-requirements/.');
      return 1;
    }
    if (result.status !== 0) return result.status ?? 1;
  }

  if (args.indexer) {
    log(`indexer -> ${join(args.out, 'indexer')} (${args.platform}, cgo + libvips)`);
    const result = spawn(
      'docker',
      indexerBuildArgs({
        dockerfile: join(repoRoot, 'docker', 'Dockerfile.pi-indexer'),
        context: backendDir,
        platform: args.platform,
        outDir,
        goVersion: args.goVersion,
      }),
      { cwd: repoRoot, stdio: 'inherit' },
    );
    if (result.error) {
      error(`docker is not available (${result.error.message}).`);
      error('The indexer needs it; --server-only skips this half.');
      return 1;
    }
    if (result.status !== 0) return result.status ?? 1;
    log('');
    log('The box needs: apt install libvips42t64');
  }

  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)));
}
