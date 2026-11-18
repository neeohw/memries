import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ZoomControl } from './ZoomControl';

describe('ZoomControl', () => {
  it('steps one level per press', () => {
    const onChange = vi.fn();
    render(<ZoomControl value="month" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /^Zoom in/ }));
    expect(onChange).toHaveBeenCalledWith('week');

    fireEvent.click(screen.getByRole('button', { name: /^Zoom out/ }));
    expect(onChange).toHaveBeenLastCalledWith('year');
  });

  it('disables the direction that has nowhere to go', () => {
    const { rerender } = render(<ZoomControl value="year" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /^Zoom out/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Zoom in/ })).not.toBeDisabled();

    rerender(<ZoomControl value="week" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /^Zoom in/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Zoom out/ })).not.toBeDisabled();
  });

  it('says where each button lands, not just that it zooms', () => {
    // "Zoom in" alone tells a screen-reader user nothing about the grouping.
    render(<ZoomControl value="month" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Zoom in, group by a shorter period' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Zoom out, group by a longer period' })).toBeTruthy();
  });

  it('shows the current level between the two buttons', () => {
    const { rerender } = render(<ZoomControl value="month" onChange={() => {}} />);
    const shown = screen.getByText('Month');
    expect(shown).toHaveAttribute('aria-hidden', 'true');

    const buttons = screen.getAllByRole('button');
    const order = [...(shown.parentElement?.children ?? [])];
    expect(order.indexOf(buttons[0])).toBeLessThan(order.indexOf(shown));
    expect(order.indexOf(shown)).toBeLessThan(order.indexOf(buttons[1]));

    rerender(<ZoomControl value="year" onChange={() => {}} />);
    expect(screen.getByText('Year')).toBeTruthy();
  });

  it('keeps the shown level a fixed width, so the buttons do not move', () => {
    // Year, Month and Week differ in length; a resizing box would shift both
    // buttons out from under the pointer between presses.
    const { rerender } = render(<ZoomControl value="month" onChange={() => {}} />);
    const widthClass = [...screen.getByText('Month').classList].find((c) => c.startsWith('w-'));
    expect(widthClass).toBeTruthy();
    rerender(<ZoomControl value="week" onChange={() => {}} />);
    expect([...screen.getByText('Week').classList]).toContain(widthClass);
  });

  it('announces the grouping without saying it twice', () => {
    const { rerender } = render(<ZoomControl value="month" onChange={() => {}} />);
    const live = screen.getByText('Grouped by month');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveClass('sr-only');
    // The visible copy is hidden from the accessibility tree, so the live
    // region is the only thing a screen reader reads.
    expect(screen.getByText('Month')).toHaveAttribute('aria-hidden', 'true');

    rerender(<ZoomControl value="week" onChange={() => {}} />);
    expect(screen.getByText('Grouped by week')).toBeTruthy();
  });

  it('stretches below 640px, where it is the whole header row', () => {
    // The period label is absolutely positioned under the header at that
    // width, so a shrink-to-fit control would leave the row left-aligned and
    // pull the filter and sync buttons off the right edge.
    render(<ZoomControl value="month" onChange={() => {}} />);
    const group = screen.getByRole('group', { name: 'Timeline zoom' });
    expect([...group.classList]).toContain('max-[639px]:flex-1');
    expect([...group.classList]).toContain('max-[639px]:justify-between');
  });

  it('is a labelled group, so the two buttons are not loose in the header', () => {
    render(<ZoomControl value="month" onChange={() => {}} />);
    expect(screen.getByRole('group', { name: 'Timeline zoom' })).toBeTruthy();
  });
});
