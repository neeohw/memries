import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { testPhoto } from '../test/fixtures';
import { Timeline } from './Timeline';

describe('Timeline', () => {
  it('pins the first Timeline Group as the current period', () => {
    render(
      <Timeline
        photos={[testPhoto({ takenAt: '2024-12-12T10:00:00' })]}
        granularity="month"
        onGranularityChange={() => {}}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByLabelText('Current period')).toHaveTextContent('December 2024');
  });

  it('uses a page heading and names the granularity group', () => {
    render(
      <Timeline photos={[]} granularity="month" onGranularityChange={() => {}} onOpen={() => {}} />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Your memries' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Group memories by' })).toBeTruthy();
    expect(screen.getByRole('status')).toHaveTextContent('No memories here yet.');
    expect(screen.getByRole('radio', { name: 'Year' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: 'Month' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('Timeline date scrubber', () => {
  const HISTOGRAM = [
    { key: '2026-03', count: 20 },
    { key: '2026-02', count: 20 },
    { key: '2026-01', count: 20 },
    { key: '2025-06', count: 20 },
  ];

  const loaded = [
    testPhoto({ id: 'mar', takenAt: '2026-03-10T10:00:00' }),
    testPhoto({ id: 'feb', takenAt: '2026-02-10T10:00:00' }),
  ];

  it('offers no scrubber until the library spans more than one month', () => {
    render(
      <Timeline
        photos={loaded}
        granularity="month"
        onGranularityChange={() => {}}
        onOpen={() => {}}
        histogram={[{ key: '2026-03', count: 20 }]}
      />,
    );
    expect(screen.queryByRole('slider', { name: 'Jump to date' })).toBeNull();
  });

  // The track comes from the server histogram, not from what is loaded, so it
  // reaches months the timeline has not paged to yet.
  it('spans the whole library even though only two months are loaded', () => {
    render(
      <Timeline
        photos={loaded}
        granularity="month"
        onGranularityChange={() => {}}
        onOpen={() => {}}
        histogram={HISTOGRAM}
      />,
    );
    const slider = screen.getByRole('slider', { name: 'Jump to date' });
    expect(slider.getAttribute('aria-valuemax')).toBe('3');
    expect(screen.getByText('2025')).toBeTruthy();
  });

  it('asks for another page when the target month is not loaded', async () => {
    const fetchNextPage = vi.fn();
    render(
      <Timeline
        photos={loaded}
        granularity="month"
        onGranularityChange={() => {}}
        onOpen={() => {}}
        histogram={HISTOGRAM}
        hasNextPage
        fetchNextPage={fetchNextPage}
      />,
    );
    // June 2025 is older than anything loaded, so the jump has to page back.
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'End' });
    await waitFor(() => {
      expect(fetchNextPage).toHaveBeenCalled();
    });
    expect(screen.getByRole('slider').getAttribute('aria-busy')).toBe('true');
  });

  it('does not page when the target month is already loaded', async () => {
    const fetchNextPage = vi.fn();
    render(
      <Timeline
        photos={loaded}
        granularity="month"
        onGranularityChange={() => {}}
        onOpen={() => {}}
        histogram={HISTOGRAM}
        hasNextPage
        fetchNextPage={fetchNextPage}
      />,
    );
    expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('0');

    // February is loaded, so this resolves without a request.
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowDown' });
    await waitFor(() => {
      // The thumb followed the list to February, which is how we know the jump
      // actually resolved rather than quietly doing nothing.
      expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('1');
    });
    expect(screen.getByRole('slider').getAttribute('aria-busy')).toBeNull();
    expect(fetchNextPage).not.toHaveBeenCalled();
  });

  // Otherwise a jump past the end of an exhausted library would hang on "…".
  it('settles on the oldest loaded month when there are no more pages', async () => {
    const fetchNextPage = vi.fn();
    render(
      <Timeline
        photos={loaded}
        granularity="month"
        onGranularityChange={() => {}}
        onOpen={() => {}}
        histogram={HISTOGRAM}
        hasNextPage={false}
        fetchNextPage={fetchNextPage}
      />,
    );
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'End' });
    await waitFor(() => {
      // June 2025 is unreachable, so it lands on February, the oldest loaded
      // month, instead of waiting forever for a page that is not coming.
      expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('1');
    });
    expect(screen.getByRole('slider').getAttribute('aria-busy')).toBeNull();
    expect(fetchNextPage).not.toHaveBeenCalled();
  });
});
