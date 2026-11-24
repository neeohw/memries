import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { composeArgs, renderConfig, resolveStackConfig, up } from './stack.mjs';

describe('resolveStackConfig', () => {
  it('uses the single-instance defaults so make e2e keeps 18080', () => {
    const config = resolveStackConfig({});
    assert.equal(config.project, 'memries-e2e');
    assert.deepEqual(config.ports, {
      caddy: 18080,
      backend: 18081,
      frontend: 15173,
    });
    assert.equal(config.origin, 'http://localhost:18080');
    assert.equal(config.healthz, 'http://localhost:18081/healthz');
    assert.equal(config.publicUrl, 'http://localhost:18080');
    assert.equal(config.viteApiBase, 'http://localhost:18080');
  });

  it('reads project and host ports from the environment', () => {
    const config = resolveStackConfig({
      MEMRIES_E2E_PROJECT: 'memries-e2e-alt',
      CADDY_HOST_PORT: '19000',
      BACKEND_HOST_PORT: '19001',
      FRONTEND_HOST_PORT: '19002',
    });
    assert.equal(config.project, 'memries-e2e-alt');
    assert.deepEqual(config.ports, {
      caddy: 19000,
      backend: 19001,
      frontend: 19002,
    });
    assert.equal(config.origin, 'http://localhost:19000');
    assert.equal(config.healthz, 'http://localhost:19001/healthz');
  });

  it('honors an explicit origin override', () => {
    const config = resolveStackConfig({
      CADDY_HOST_PORT: '19000',
      MEMRIES_E2E_ORIGIN: 'http://127.0.0.1:19000',
    });
    assert.equal(config.origin, 'http://127.0.0.1:19000');
    assert.equal(config.publicUrl, 'http://127.0.0.1:19000');
  });
});

describe('composeArgs', () => {
  it('pins the compose project and files', () => {
    const config = resolveStackConfig({ MEMRIES_E2E_PROJECT: 'memries-e2e' });
    assert.deepEqual(composeArgs(config, '/e2e/docker-compose.yml', ['up', '-d']), [
      'compose',
      '-p',
      'memries-e2e',
      '-f',
      '/e2e/docker-compose.yml',
      'up',
      '-d',
    ]);
  });
});

describe('up', () => {
  it('surfaces a compose failure without claiming a port lease', async () => {
    const commands = [];
    await assert.rejects(
      () =>
        up({
          env: {},
          skipConfig: true,
          skipFixtures: true,
          skipLogs: true,
          runDocker: async (_cmd, args) => {
            commands.push(args.includes('up') ? 'up' : args.join(' '));
            if (args.includes('up')) throw new Error('compose failed');
          },
        }),
      /compose failed/,
    );
    assert.deepEqual(commands, ['up']);
  });
});

// The stack's configuration is a file now, generated per run because the
// public URL carries the leased port (ADR 0028).
describe('renderConfig', () => {
  it('writes the leased origin as the public URL', () => {
    const yaml = renderConfig('http://localhost:19000');
    assert.match(yaml, /public_url: http:\/\/localhost:19000/);
    assert.match(yaml, /e2e: true/);
  });

  it('pins the throwaway credentials rather than reading a developer\'s', () => {
    const yaml = renderConfig('http://localhost:18080');
    assert.match(yaml, /bootstrap_password: "password"/);
    assert.match(yaml, /session_key: "[A-Za-z0-9+/=]+"/);
    // One admin per Playwright worker, in sync with owners.mjs.
    for (const who of ['admin', 'worker-1', 'worker-2', 'worker-3']) {
      assert.ok(yaml.includes(`${who}@example.com`), `${who} missing`);
    }
  });
});
