import { describe, expect, it } from 'vitest';
import { formatDuration } from './duration';

describe('formatDuration', () => {
  it('writes clip lengths the way a player does', () => {
    expect(formatDuration(7000)).toBe('0:07');
    expect(formatDuration(62000)).toBe('1:02');
    expect(formatDuration(600000)).toBe('10:00');
  });

  it('adds hours only when there are some', () => {
    expect(formatDuration(3_600_000)).toBe('1:00:00');
    expect(formatDuration(3_723_000)).toBe('1:02:03');
    expect(formatDuration(59_000)).toBe('0:59');
  });

  // Flooring would label a clip that plays as "0:00".
  it('rounds rather than floors', () => {
    expect(formatDuration(1600)).toBe('0:02');
    expect(formatDuration(500)).toBe('0:01');
  });

  // A still has no duration, and neither has a clip whose container did not
  // say; both want no badge at all rather than "0:00".
  it('says nothing for a length it does not have', () => {
    expect(formatDuration(0)).toBe('');
    expect(formatDuration(-5)).toBe('');
    expect(formatDuration(Number.NaN)).toBe('');
  });
});
