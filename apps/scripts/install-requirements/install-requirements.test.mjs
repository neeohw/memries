import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDeps, goCommandCandidates, main } from './install-requirements.mjs';
import {
  GO_VERSION,
  NODE_VERSION,
  PNPM_VERSION,
  goSatisfies,
  goTarballUrl,
  nodeSatisfies,
  nodeTarballUrl,
  parseGoVersion,
  parseNodeMajor,
} from './versions.mjs';

describe('version helpers', () => {
  it('accepts Node 22+ and Go 1.23+', () => {
    assert.equal(parseNodeMajor('v22.23.2'), 22);
    assert.equal(nodeSatisfies('v20.18.2'), false);
    assert.equal(nodeSatisfies('v22.23.2'), true);
    assert.deepEqual(parseGoVersion('go version go1.23.6 linux/amd64'), {
      major: 1,
      minor: 23,
      patch: 6,
    });
    assert.equal(goSatisfies('go version go1.22.5 windows/amd64'), false);
    assert.equal(goSatisfies('go version go1.23.6 windows/amd64'), true);
    assert.equal(goSatisfies('go version go1.24.0 linux/amd64'), true);
  });

  it('builds official linux tarball URLs', () => {
    assert.equal(
      nodeTarballUrl('x64'),
      `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz`,
    );
    assert.equal(goTarballUrl('arm64'), `https://go.dev/dl/go${GO_VERSION}.linux-arm64.tar.gz`);
  });

  it('builds official macOS tarball URLs', () => {
    assert.equal(
      nodeTarballUrl('arm64', 'darwin'),
      `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-arm64.tar.gz`,
    );
    assert.equal(
      goTarballUrl('x64', 'darwin'),
      `https://go.dev/dl/go${GO_VERSION}.darwin-amd64.tar.gz`,
    );
  });

  it('probes the default Windows Go install path', () => {
    const bins = goCommandCandidates('win32', { ProgramFiles: 'C:\\Program Files' });
    assert.deepEqual(bins, ['go', 'C:\\Program Files\\Go\\bin\\go.exe', 'C:\\Go\\bin\\go.exe']);
    assert.deepEqual(goCommandCandidates('linux', {}), ['go']);
  });
});

describe('main', () => {
  it('uses winget on Windows when tools are missing', async () => {
    const winget = [];
    const logs = [];
    const status = await main([], {
      platform: () => 'win32',
      nodeOk: () => false,
      goFound: () => true,
      goOk: () => true,
      goVersion: () => 'go version go1.23.6 windows/amd64',
      wingetInstall: (id) => winget.push(id),
      enableCorepack: () => logs.push('corepack'),
      log: (msg) => logs.push(String(msg)),
    });
    assert.equal(status, 0);
    assert.deepEqual(winget, ['OpenJS.NodeJS.LTS']);
    assert.ok(logs.includes('corepack'));
    assert.ok(logs.some((line) => line.includes('pnpm install')));
  });

  it('skips winget when versions already satisfy', async () => {
    const winget = [];
    await main([], {
      platform: () => 'win32',
      nodeOk: () => true,
      goFound: () => true,
      goOk: () => true,
      nodeVersion: () => 'v22.23.2',
      goVersion: () => 'go version go1.23.6 windows/amd64',
      wingetInstall: (id) => winget.push(id),
      enableCorepack: () => {},
      log: () => {},
    });
    assert.deepEqual(winget, []);
  });

  it('skips Go install and update when any Go is already found', async () => {
    const winget = [];
    const logs = [];
    await main([], {
      platform: () => 'win32',
      nodeOk: () => true,
      nodeVersion: () => 'v22.23.2',
      goFound: () => true,
      goVersion: () => 'go version go1.22.5 windows/amd64',
      wingetInstall: (id) => winget.push(id),
      enableCorepack: () => {},
      log: (msg) => logs.push(String(msg)),
    });
    assert.deepEqual(winget, []);
    assert.ok(logs.some((line) => /skipping install and update/i.test(line)));
  });

  it('downloads official tarballs on Linux when tools are missing', async () => {
    const downloads = [];
    await main([], {
      platform: () => 'linux',
      arch: () => 'x64',
      nodeOk: () => false,
      goFound: () => false,
      goOk: () => false,
      prefix: () => '/tmp/tools',
      nodeDistVersion: NODE_VERSION,
      goDistVersion: GO_VERSION,
      installTarball: async (opts) => downloads.push(opts),
      enableCorepack: () => {},
      log: () => {},
    });
    assert.equal(downloads.length, 2);
    assert.equal(downloads[0].url, nodeTarballUrl('x64'));
    assert.equal(downloads[0].strip, 1);
    assert.equal(downloads[1].url, goTarballUrl('x64'));
    assert.equal(downloads[1].strip, 0);
  });

  it('skips the Go tarball when any Go is already found', async () => {
    const downloads = [];
    const logs = [];
    await main([], {
      platform: () => 'linux',
      arch: () => 'x64',
      nodeOk: () => true,
      nodeVersion: () => 'v22.23.2',
      goFound: () => true,
      goVersion: () => 'go version go1.22.5 linux/amd64',
      installTarball: async (opts) => downloads.push(opts),
      enableCorepack: () => {},
      log: (msg) => logs.push(String(msg)),
    });
    assert.deepEqual(downloads, []);
    assert.ok(logs.some((line) => /skipping install and update/i.test(line)));
  });

  it('skips corepack enable when pnpm is already found', () => {
    const spawned = [];
    const logs = [];
    const deps = createDeps({
      pnpmFound: () => true,
      pnpmVersion: () => '9.15.9',
      spawn: (cmd, args) => {
        spawned.push([cmd, ...(args || [])]);
        return { status: 0, stdout: '', stderr: '' };
      },
      log: (msg) => logs.push(String(msg)),
    });
    deps.enableCorepack();
    assert.deepEqual(spawned, []);
    assert.ok(logs.some((line) => /skipping corepack enable/i.test(line)));
  });

  it('runs corepack enable via the Windows shell so corepack.cmd resolves', () => {
    const calls = [];
    const deps = createDeps({
      platform: () => 'win32',
      pnpmFound: () => false,
      spawn: (cmd, args, opts) => {
        calls.push({ cmd, args, shell: Boolean(opts?.shell) });
        return { status: 0, stdout: '', stderr: '' };
      },
      log: () => {},
    });
    deps.enableCorepack();
    assert.equal(calls[0].cmd, 'corepack');
    assert.deepEqual(calls[0].args, ['enable']);
    assert.equal(calls[0].shell, true);
    assert.equal(calls[1].cmd, 'corepack');
    assert.deepEqual(calls[1].args, ['prepare', `pnpm@${PNPM_VERSION}`, '--activate']);
    assert.equal(calls[1].shell, true);
  });

  it('downloads official tarballs on macOS when tools are missing', async () => {
    const downloads = [];
    await main([], {
      platform: () => 'darwin',
      arch: () => 'arm64',
      nodeOk: () => false,
      goFound: () => false,
      goOk: () => false,
      prefix: () => '/tmp/tools',
      nodeDistVersion: NODE_VERSION,
      goDistVersion: GO_VERSION,
      installTarball: async (opts) => downloads.push(opts),
      enableCorepack: () => {},
      log: () => {},
    });
    assert.equal(downloads.length, 2);
    assert.equal(
      downloads[0].url,
      `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-arm64.tar.gz`,
    );
    assert.equal(downloads[0].strip, 1);
    assert.equal(
      downloads[1].url,
      `https://go.dev/dl/go${GO_VERSION}.darwin-arm64.tar.gz`,
    );
    assert.equal(downloads[1].strip, 0);
  });
});
