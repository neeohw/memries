#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, win32 as winPath } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { installLinux } from './install-linux.mjs';
import { installWindows } from './install-windows.mjs';
import {
  GO_VERSION,
  NODE_VERSION,
  PNPM_VERSION,
  goSatisfies,
  nodeSatisfies,
  parseGoVersion,
} from './versions.mjs';

export function spawnToolOptions(platform = process.platform) {
  return platform === 'win32' ? { shell: true } : {};
}

function commandVersion(cmd, args, spawnImpl, platform = process.platform) {
  const result = spawnImpl(cmd, args, { encoding: 'utf8', ...spawnToolOptions(platform) });
  if ((result.status ?? 1) !== 0) return '';
  return String(result.stdout || result.stderr || '').trim();
}

export function goCommandCandidates(platform, env = process.env) {
  const names = ['go'];
  if (platform === 'win32') {
    names.push(winPath.join(env.ProgramFiles || 'C:\\Program Files', 'Go', 'bin', 'go.exe'));
    names.push(winPath.join('C:\\', 'Go', 'bin', 'go.exe'));
  }
  return names;
}

export function createDeps(overrides = {}) {
  const spawnImpl = overrides.spawn ?? spawnSync;
  const deps = {
    platform: () => process.platform,
    arch: () => process.arch,
    env: process.env,
    log: (...args) => console.log(...args),
    nodeDistVersion: NODE_VERSION,
    goDistVersion: GO_VERSION,
    prefix() {
      return this.env.MEMRIES_TOOL_PREFIX || join(homedir(), '.local');
    },
    nodeVersion() {
      return commandVersion('node', ['-v'], spawnImpl, this.platform());
    },
    goVersion() {
      for (const cmd of goCommandCandidates(this.platform(), this.env)) {
        const text = commandVersion(cmd, ['version'], spawnImpl, this.platform());
        if (text) return text;
      }
      return '';
    },
    pnpmVersion() {
      return commandVersion('pnpm', ['-v'], spawnImpl, this.platform());
    },
    nodeOk() {
      return nodeSatisfies(this.nodeVersion());
    },
    goOk() {
      return goSatisfies(this.goVersion());
    },
    goFound() {
      return parseGoVersion(this.goVersion()) != null;
    },
    pnpmFound() {
      return /^\d+\.\d+/.test(this.pnpmVersion());
    },
    wingetInstall(id, extraArgs = []) {
      const result = spawnImpl(
        'winget',
        [
          'install',
          '--id',
          id,
          '-e',
          '--accept-package-agreements',
          '--accept-source-agreements',
          '--disable-interactivity',
          ...extraArgs,
        ],
        { encoding: 'utf8', stdio: 'inherit' },
      );
      if ((result.status ?? 1) !== 0) {
        throw new Error(`winget install ${id} failed with status ${result.status}`);
      }
    },
    async installTarball({ url, dest, strip }) {
      mkdirSync(dest, { recursive: true });
      const archive = join(dest, `.memries-dl-${Date.now()}.tar.gz`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`download failed ${res.status} ${url}`);
      await pipeline(res.body, createWriteStream(archive));
      const stripArgs = strip > 0 ? ['--strip-components', String(strip)] : [];
      const result = spawnImpl('tar', ['-C', dest, '-xzf', archive, ...stripArgs], {
        encoding: 'utf8',
        stdio: 'inherit',
      });
      if ((result.status ?? 1) !== 0) {
        throw new Error(`tar extract failed for ${url}`);
      }
    },
    enableCorepack() {
      if (this.pnpmFound()) {
        this.log(`pnpm ${this.pnpmVersion()} already available; skipping corepack enable`);
        return;
      }
      const spawnOpts = {
        encoding: 'utf8',
        stdio: 'inherit',
        ...spawnToolOptions(this.platform()),
      };
      const enable = spawnImpl('corepack', ['enable'], spawnOpts);
      if ((enable.status ?? 1) !== 0) {
        const detail = enable.error?.message || `status ${enable.status}`;
        throw new Error(`corepack enable failed: ${detail}`);
      }
      const prepare = spawnImpl(
        'corepack',
        ['prepare', `pnpm@${PNPM_VERSION}`, '--activate'],
        spawnOpts,
      );
      if ((prepare.status ?? 1) !== 0) {
        const detail = prepare.error?.message || `status ${prepare.status}`;
        throw new Error(`corepack prepare pnpm@${PNPM_VERSION} failed: ${detail}`);
      }
    },
    ...overrides,
  };
  return deps;
}

export async function main(argv = process.argv.slice(2), injected = {}) {
  const deps = createDeps(injected);
  const platform = deps.platform();
  if (platform === 'win32') {
    await installWindows(deps);
  } else if (platform === 'linux' || platform === 'darwin') {
    await installLinux(deps);
  } else {
    throw new Error(`Unsupported platform '${platform}'. Use Windows, Linux, or macOS.`);
  }
  deps.enableCorepack();
  deps.log('');
  deps.log('Toolchain ready. Next, from the Memries repo root:');
  deps.log('  pnpm install');
  deps.log('  pnpm build');
  if (argv.includes('--help')) return 0;
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
