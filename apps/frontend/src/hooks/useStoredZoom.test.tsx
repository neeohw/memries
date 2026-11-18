import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ZOOM_STORAGE_KEY } from '../lib/zoom';
import { useStoredZoom } from './useStoredZoom';

describe('useStoredZoom', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('starts at month with nothing stored', () => {
    const { result } = renderHook(() => useStoredZoom());
    expect(result.current[0]).toBe('month');
  });

  it('starts from the level this tab last used', () => {
    window.sessionStorage.setItem(ZOOM_STORAGE_KEY, 'week');
    const { result } = renderHook(() => useStoredZoom());
    expect(result.current[0]).toBe('week');
  });

  it('stores each change, so a reload lands where the reader left off', () => {
    const { result } = renderHook(() => useStoredZoom());
    act(() => result.current[1]('year'));
    expect(result.current[0]).toBe('year');
    expect(window.sessionStorage.getItem(ZOOM_STORAGE_KEY)).toBe('year');

    // A second hook is the reload: it reads what the first one wrote.
    const { result: reloaded } = renderHook(() => useStoredZoom());
    expect(reloaded.current[0]).toBe('year');
  });

  it('falls back to month for a stored level that no longer exists', () => {
    window.sessionStorage.setItem(ZOOM_STORAGE_KEY, 'day');
    const { result } = renderHook(() => useStoredZoom());
    expect(result.current[0]).toBe('month');
  });
});
