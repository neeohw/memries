#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_ARCH = 'arm64';
const DEFAULT_OUT = 'dist/deb';
/** Matches apps/frontend/package.json; the package version is the product's. */
const DEFAULT_VERSION = '0.1.0';

const USAGE = `Usage: build-deb [--out DIR] [--arch arm64|amd64] [--version X.Y.Z]

Build the Memries .deb (ADR 0030).

It packages what is already built rather than building it:

  dist/pi/server, dist/pi/indexer   make build-pi
  apps/frontend/dist                pnpm --filter @memries/frontend build

The package installs the API server as a systemd service on 127.0.0.1:5987,
the web interface in /usr/share/memries/www, and nginx and Apache examples.
Depends on libvips42t64 and ffmpeg.

dpkg-deb builds it. Where that is missing — a Mac — it runs in a
debian:trixie container instead, which needs Docker.

Defaults: --out ${DEFAULT_OUT} --arch ${DEFAULT_ARCH} --version ${DEFAULT_VERSION}
`;

/**
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  const out = { out: DEFAULT_OUT, arch: DEFAULT_ARCH, version: DEFAULT_VERSION, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      out.help = true;
      continue;
    }
    const take = () => {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) throw new Error(`missing value for ${arg}`);
      i += 1;
      return value;
    };
    if (arg === '--out') out.out = take();
    else if (arg === '--arch') out.arch = take();
    else if (arg === '--version') out.version = take();
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!/^(arm64|amd64)$/.test(out.arch)) {
    throw new Error(`--arch must be arm64 or amd64, not ${out.arch}`);
  }
  // Debian versions are compared field by field; a bad one installs but can
  // never be upgraded cleanly, which is worse than refusing it here.
  if (!/^[0-9][0-9a-zA-Z.+~-]*$/.test(out.version)) {
    throw new Error(`--version must start with a digit: ${out.version}`);
  }
  return out;
}

/**
 * layout maps a path inside the package to the file it comes from.
 *
 * Returned rather than written so a test can read the shape of the package
 * without building one: what lands where is the part worth pinning.
 * @param {{ repoRoot: string }} opts
 */
export function layout({ repoRoot }) {
  const pkg = join(repoRoot, 'packaging');
  return {
    binaries: {
      'usr/bin/memries-server': join(repoRoot, 'dist', 'pi', 'server'),
      'usr/bin/memries-indexer': join(repoRoot, 'dist', 'pi', 'indexer'),
    },
    files: {
      'etc/memries/config.yaml': join(pkg, 'debian', 'config.yaml'),
      'lib/systemd/system/memries.service': join(pkg, 'debian', 'memries.service'),
      'usr/share/memries/nginx.conf': join(pkg, 'web', 'nginx.conf'),
      'usr/share/memries/nginx-sublocation.conf': join(pkg, 'web', 'nginx-sublocation.conf'),
      'usr/share/memries/apache.conf': join(pkg, 'web', 'apache.conf'),
    },
    // The built SPA, copied wholesale: its filenames are content-hashed and
    // change every build, so naming them here would be a list that rots.
    trees: {
      'usr/share/memries/www': join(repoRoot, 'apps', 'frontend', 'dist'),
    },
    control: ['control', 'conffiles', 'postinst', 'prerm', 'postrm'].map((name) => [
      name,
      join(pkg, 'debian', name),
    ]),
  };
}

/** Files that must already exist, with the command that makes each. */
export function prerequisites({ repoRoot }) {
  const l = layout({ repoRoot });
  return [
    ...Object.values(l.binaries).map((path) => ({ path, how: 'make build-pi' })),
    {
      path: join(repoRoot, 'apps', 'frontend', 'dist', 'index.html'),
      how: 'pnpm --filter @memries/frontend build',
    },
  ];
}

/**
 * controlFile fills the template. Installed-Size is in kibibytes and is what
 * apt shows before downloading, so it is measured rather than guessed.
 */
export function controlFile(template, { version, arch, sizeKiB }) {
  return template
    .replace('{{VERSION}}', version)
    .replace('{{ARCH}}', arch)
    .replace('{{SIZE}}', String(sizeKiB));
}

export function packageName(version, arch) {
  return `memries_${version}_${arch}.deb`;
}

/**
 * dpkgArgs builds the package from a staged tree. --root-owner-group makes
 * every file root:root without needing root to build, which is what lets this
 * run from a checkout.
 */
export function dpkgArgs(stageDir, debPath) {
  return ['--build', '--root-owner-group', stageDir, debPath];
}

/** The same, inside a container, for a machine with no dpkg-deb. */
export function dockerArgs(repoRoot, stageRel, debRel) {
  return [
    'run', '--rm',
    '-v', `${repoRoot}:/work`,
    '-w', '/work',
    'debian:trixie',
    'dpkg-deb', ...dpkgArgs(stageRel, debRel),
  ];
}

function dirSizeKiB(dir) {
  let bytes = 0;
  const walk = (p) => {
    const st = statSync(p);
    if (st.isDirectory()) {
      for (const entry of readdirSync(p)) walk(join(p, entry));
    } else {
      bytes += st.size;
    }
  };
  walk(dir);
  return Math.max(1, Math.ceil(bytes / 1024));
}

/**
 * @param {string[]} argv
 */
export async function main(argv, deps = {}) {
  const spawn = deps.spawn ?? spawnSync;
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

  const missing = prerequisites({ repoRoot }).filter((p) => !existsSync(p.path));
  if (missing.length > 0) {
    error('Nothing to package yet. Build these first:');
    for (const m of missing) error(`  ${m.path}\n    -> ${m.how}`);
    return 1;
  }

  const outDir = resolve(repoRoot, args.out);
  const stageDir = join(outDir, `memries_${args.version}_${args.arch}`);
  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });

  const l = layout({ repoRoot });
  for (const [rel, src] of Object.entries(l.binaries)) {
    const dest = join(stageDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    chmodSync(dest, 0o755);
  }
  for (const [rel, src] of Object.entries(l.files)) {
    const dest = join(stageDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    chmodSync(dest, 0o644);
  }
  for (const [rel, src] of Object.entries(l.trees)) {
    cpSync(src, join(stageDir, rel), { recursive: true });
  }

  const debianDir = join(stageDir, 'DEBIAN');
  mkdirSync(debianDir, { recursive: true });
  const sizeKiB = dirSizeKiB(stageDir);
  for (const [name, src] of l.control) {
    const dest = join(debianDir, name);
    if (name === 'control') {
      writeFileSync(
        dest,
        controlFile(readFileSync(src, 'utf8'), { ...args, sizeKiB }),
      );
      chmodSync(dest, 0o644);
    } else {
      copyFileSync(src, dest);
      chmodSync(dest, name === 'conffiles' ? 0o644 : 0o755);
    }
  }

  const debName = packageName(args.version, args.arch);
  const debPath = join(outDir, debName);
  log(`${debName} <- ${stageDir}`);

  const native = spawn('dpkg-deb', dpkgArgs(stageDir, debPath), { stdio: 'inherit' });
  if (native.error) {
    log('dpkg-deb is not installed here; building in a debian:trixie container.');
    const rel = (p) => p.slice(repoRoot.length + 1);
    const viaDocker = spawn('docker', dockerArgs(repoRoot, rel(stageDir), rel(debPath)), {
      stdio: 'inherit',
    });
    if (viaDocker.error) {
      error(`neither dpkg-deb nor docker is available (${viaDocker.error.message}).`);
      return 1;
    }
    if (viaDocker.status !== 0) return viaDocker.status ?? 1;
  } else if (native.status !== 0) {
    return native.status ?? 1;
  }

  log('');
  log(`Install with:  sudo apt install ./${args.out}/${debName}`);
  log('Then put the web interface in front of it: /usr/share/memries/nginx.conf');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)));
}
