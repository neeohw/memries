import { describe, expect, it } from 'vitest';
import { formatBytes } from './formatBytes';

describe('formatBytes', () => {
  it('steps up through the units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 kB');
    expect(formatBytes(5_400_000)).toBe('5.4 MB');
    expect(formatBytes(7_200_000_000)).toBe('7.2 GB');
    expect(formatBytes(3_100_000_000_000)).toBe('3.1 TB');
  });

  it('drops the decimal once the number is large enough not to need it', () => {
    expect(formatBytes(248_000_000)).toBe('248 MB');
  });

  // 0 is how the server says it could not read the figure, and an empty
  // string lets the page leave it out rather than claim a full disk.
  it('returns nothing for zero, negative or non-finite sizes', () => {
    expect(formatBytes(0)).toBe('');
    expect(formatBytes(-1)).toBe('');
    expect(formatBytes(Number.NaN)).toBe('');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('');
  });

  it('writes the decimal separator the reader expects', () => {
    expect(formatBytes(7_200_000_000, 'en-GB')).toBe('7.2 GB');
    expect(formatBytes(7_200_000_000, 'nl-NL')).toBe('7,2 GB');
  });
});
