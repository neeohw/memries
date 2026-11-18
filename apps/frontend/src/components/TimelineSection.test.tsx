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
