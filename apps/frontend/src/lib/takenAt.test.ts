import { describe, expect, it } from 'vitest';
import { wallClockFromExifValue, yearCeiling } from './takenAt';

describe('wallClockFromExifValue', () => {
  it('reads an EXIF clock as a wall clock, subseconds dropped', () => {
    expect(wallClockFromExifValue('2024:08:25 18:30:01.44')).toBe('2024-08-25T18:30:01');
  });

  it('reads an RFC date as a wall clock', () => {
    expect(wallClockFromExifValue('Sun, 25 Aug 2024 18:30:01 GMT')).toBe('2024-08-25T18:30:01');
  });

  it('answers null for anything it cannot place on a calendar', () => {
    expect(wallClockFromExifValue('last summer')).toBeNull();
    expect(wallClockFromExifValue(undefined)).toBeNull();
  });
});

describe('yearCeiling', () => {
  it('bounds the feed at the start of the year after the one clicked', () => {
    expect(yearCeiling('2019-07-14T18:30:01')).toBe('2020-01-01');
  });

  it('is the same bound wherever in the year the photo falls', () => {
    expect(yearCeiling('2019-01-01T00:00:00')).toBe(yearCeiling('2019-12-31T23:59:59'));
  });

  it('answers an empty string for a clock with no year to read', () => {
    expect(yearCeiling('')).toBe('');
    expect(yearCeiling('soon')).toBe('');
    expect(yearCeiling('201')).toBe('');
    // The server's own ceiling is 2100; a bound it cannot parse is a 400.
    expect(yearCeiling('9999-01-01T00:00:00')).toBe('');
  });
});
