import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { goEnv, runGo } from './run-go.mjs';

describe('runGo', () => {
  it('writes a toolchain hint when go is not on PATH', () => {
    const writes = [];
    const status = runGo(['version'], {
      spawn: () => ({
        status: null,
        error: Object.assign(new Error('spawnSync go ENOENT'), { code: 'ENOENT' }),
      }),
      stdout: { write: () => {} },
      stderr: { write: (chunk) => writes.push(String(chunk)) },
    });
    assert.equal(status, 1);
    assert.match(writes.join(''), /go is not available \(spawnSync go ENOENT\)/);
    assert.match(writes.join(''), /apps\/scripts\/install-requirements/);
  });
});

describe('goEnv', () => {
  it('fills LOCALAPPDATA on Windows when Turbo stripped it', () => {
    const env = goEnv(
      {},
      { platform: 'win32', home: 'C:\\Users\\dev', base: { USERPROFILE: 'C:\\Users\\dev' } },
    );
    assert.equal(env.CGO_ENABLED, '0');
    // goEnv builds this with path.join, which uses the separator of the
    // machine running the test, not of the platform being simulated. The
    // expectation has to do the same or this only ever passed on Windows.
    assert.equal(env.LOCALAPPDATA, join('C:\\Users\\dev', 'AppData', 'Local'));
  });
});
