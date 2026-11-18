import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { E2E_OWNERS, ownerEmail } from './owners.mjs';

describe('ownerEmail', () => {
  it('keeps admin@example.com on slot 0, so the README and serial CI are unchanged', () => {
    assert.equal(ownerEmail(0), 'admin@example.com');
    assert.equal(ownerEmail(), 'admin@example.com');
  });

  it('gives every worker slot a distinct account', () => {
    const seen = new Set(E2E_OWNERS.map((_, i) => ownerEmail(i)));
    assert.equal(seen.size, E2E_OWNERS.length);
  });

  it('covers the four workers the local profile uses', () => {
    assert.ok(E2E_OWNERS.length >= 4);
  });

  it('refuses a slot it has no bootstrapped account for, rather than sharing one', () => {
    assert.throws(() => ownerEmail(E2E_OWNERS.length), /only \d+ are bootstrapped/);
  });

  it('rejects a non-index', () => {
    assert.throws(() => ownerEmail(-1), /non-negative integer/);
    assert.throws(() => ownerEmail(1.5), /non-negative integer/);
  });
});
