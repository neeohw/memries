import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { composeArgs, resolveStackConfig, up } from './stack.mjs';

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
    assert.deepEqual(composeArgs(config, '/e2e/docker-compose.yml', '/app/.env', ['up', '-d']), [
      'compose',
      '-p',
      'memries-e2e',
      '-f',
      '/e2e/docker-compose.yml',
      '--env-file',
      '/app/.env',
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
          allowMissingEnv: true,
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
