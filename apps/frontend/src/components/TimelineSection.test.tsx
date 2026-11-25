import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { testPhoto } from '../test/fixtures';
import { TimelineSection } from './TimelineSection';

describe('TimelineSection', () => {
  it('exposes the Timeline Group as a labelled heading', () => {
    render(
      <TimelineSection
        group={{
          key: '2026-08',
          label: 'August 2026',
          sublabel: '5 memories',
          photos: [testPhoto()],
          total: 1,
        }}
        granularity="month"
        onOpen={() => {}}
        onActions={() => {}}
        showHeading
      />,
    );
    const heading = screen.getByRole('heading', { level: 2, name: 'August 2026' });
    expect(heading).toHaveAttribute('id', 'period-2026-08');
    expect(heading.closest('section')).toHaveAttribute('aria-labelledby', 'period-2026-08');
    expect(screen.getByRole('button', { name: /Open photo/ })).toHaveAttribute(
      'aria-haspopup',
      'dialog',
    );
  });
});

describe('TimelineSection drill-in', () => {
  const group = {
    key: '2026',
    label: '2026',
    sublabel: '11 memories',
    photos: [testPhoto({ takenAt: '2026-08-31T10:00:00' })],
    total: 1,
  };

  it('drills into the clicked group, not the one at the top of the screen', () => {
    const onDrillIn = vi.fn();
    render(
      <TimelineSection
        group={group}
        granularity="year"
        onOpen={() => {}}
        showHeading
        onDrillIn={onDrillIn}
        drillHintId="hint"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '2026' }));
    expect(onDrillIn).toHaveBeenCalledWith(group);
  });

  it('keeps the heading name the period alone, so the section label stays clean', () => {
    render(
      <TimelineSection
        group={group}
        granularity="year"
        onOpen={() => {}}
        showHeading
        onDrillIn={() => {}}
        drillHintId="hint"
      />,
    );
    // The action rides on aria-describedby. Putting it in the label would
    // rename both the heading and the section it labels.
    const heading = screen.getByRole('heading', { level: 2, name: '2026' });
    expect(heading).toBeTruthy();
    expect(screen.getByRole('button', { name: '2026' })).toHaveAttribute(
      'aria-describedby',
      'hint',
    );
  });

  it('is plain text at the closest level, with nothing to click', () => {
    render(
      <TimelineSection
        group={{ ...group, key: '2026-W36', label: '31 Aug – 6 Sep 2026' }}
        granularity="week"
        onOpen={() => {}}
        showHeading
      />,
    );
    expect(screen.getByRole('heading', { level: 2, name: '31 Aug – 6 Sep 2026' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '31 Aug – 6 Sep 2026' })).toBeNull();
  });
});

describe('TimelineSection on a sampled period', () => {
  const sampled = {
    key: '2026',
    label: '2026',
    sublabel: '1240 memories',
    photos: [testPhoto({ takenAt: '2026-08-31T10:00:00' })],
    total: 1240,
  };

  it('says how many photos zooming in would add, and zooms in on a press', () => {
    const onDrillIn = vi.fn();
    render(
      <TimelineSection
        group={sampled}
        granularity="year"
        onOpen={() => {}}
        showHeading
        onDrillIn={onDrillIn}
      />,
    );
    // 1,239 and not 1,240: the one on screen is not more.
    const more = screen.getByRole('button', { name: '1,239 more in 2026 — zoom in' });
    fireEvent.click(more);
    expect(onDrillIn).toHaveBeenCalledWith(sampled);
  });

  it('says nothing when the period is all there', () => {
    render(
      <TimelineSection
        group={{ ...sampled, total: 1 }}
        granularity="year"
        onOpen={() => {}}
        showHeading
        onDrillIn={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: /more in 2026/ })).toBeNull();
  });

  it('says nothing at the closest level, where there is nowhere to zoom', () => {
    render(
      <TimelineSection
        group={{ ...sampled, key: '2026-W36', label: '31 Aug – 6 Sep 2026' }}
        granularity="week"
        onOpen={() => {}}
        showHeading
      />,
    );
    expect(screen.queryByRole('button', { name: /more in/ })).toBeNull();
  });
});
