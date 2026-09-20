import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { composeArgs, renderDexConfig, resolveStackConfig, up } from './stack.mjs';

const DEX_TEMPLATE = `issuer: http://localhost:15556

staticClients:
  - id: memries
    redirectURIs:
      - http://localhost:18080/oauth/callback
`;

describe('resolveStackConfig', () => {
  it('uses the single-instance defaults so make e2e keeps 18080', () => {
    const config = resolveStackConfig({});
    assert.equal(config.project, 'memries-e2e');
    assert.deepEqual(config.ports, {
      caddy: 18080,
      backend: 18081,
      frontend: 15173,
      arango: 18529,
      dex: 15556,
    });
    assert.equal(config.origin, 'http://localhost:18080');
    assert.equal(config.healthz, 'http://localhost:18081/healthz');
    assert.equal(config.oidcIssuer, 'http://localhost:15556');
    assert.equal(config.oidcRedirectUrl, 'http://localhost:18080/oauth/callback');
    assert.equal(config.publicUrl, 'http://localhost:18080');
    assert.equal(config.viteApiBase, 'http://localhost:18080');
  });

  it('reads project and host ports from the environment', () => {
    const config = resolveStackConfig({
      MEMRIES_E2E_PROJECT: 'memries-e2e-alt',
      CADDY_HOST_PORT: '19000',
      BACKEND_HOST_PORT: '19001',
      FRONTEND_HOST_PORT: '19002',
      ARANGO_HOST_PORT: '19003',
      DEX_HOST_PORT: '19004',
    });
    assert.equal(config.project, 'memries-e2e-alt');
    assert.deepEqual(config.ports, {
      caddy: 19000,
      backend: 19001,
      frontend: 19002,
      arango: 19003,
      dex: 19004,
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
    assert.equal(config.oidcRedirectUrl, 'http://127.0.0.1:19000/oauth/callback');
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

describe('renderDexConfig', () => {
  it('rewrites issuer and redirect to the instance ports', () => {
    const config = resolveStackConfig({
      CADDY_HOST_PORT: '18080',
      DEX_HOST_PORT: '15556',
    });
    const rendered = renderDexConfig(DEX_TEMPLATE, config);
    assert.match(rendered, /issuer: http:\/\/localhost:15556/);
    assert.match(rendered, /http:\/\/localhost:18080\/oauth\/callback/);
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
