import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../i18n/I18nProvider';
import type { IndexStatus } from '../lib/indexStatus';
import { ScanProgress } from './ScanProgress';

function status(overrides: Partial<IndexStatus> = {}): IndexStatus {
  return {
    status: 'running',
    prefix: '',
    discovered: 0,
    processed: 0,
    indexed: 0,
    skipped: 0,
    failed: 0,
    ...overrides,
  };
}

describe('ScanProgress', () => {
  it('shows nothing before a scan has been asked for', () => {
    const { container } = render(<ScanProgress />);
    expect(container.firstChild).toBeNull();
  });

  it('shows nothing for a library that has never been indexed', () => {
    const { container } = render(<ScanProgress status={status({ status: 'not_started' })} />);
    expect(container.firstChild).toBeNull();
  });

  it('says it is queued before any walking starts', () => {
    render(<ScanProgress status={status({ status: 'queued' })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Queued…');
  });

  // Discovery walks the tree before it knows the total, so a percentage
  // would read 0% for minutes. The bar is indeterminate until there is a
  // denominator.
  it('reports looking, with no percentage, while discovery runs', () => {
    render(<ScanProgress status={status({ discovered: 0, processed: 0 })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Looking through the folders…');
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    expect(screen.queryByText('%', { exact: false })).toBeNull();
  });

  it('counts files and fills the bar once the total is known', () => {
    render(<ScanProgress status={status({ discovered: 400, processed: 100 })} />);
    expect(screen.getByRole('status')).toHaveTextContent('100 of 400 files');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByText('25%')).toBeTruthy();
  });

  it('summarises what a finished scan did', () => {
    render(
      <ScanProgress
        status={status({
          status: 'complete',
          discovered: 400,
          processed: 400,
          indexed: 12,
          skipped: 388,
        })}
      />,
    );
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Scan finished');
    expect(screen.getByRole('status')).toHaveTextContent('12 added · 388 unchanged');
    // Nothing is still in flight, so there is no bar to read.
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('counts unreadable files, singular and plural', () => {
    const done = { status: 'complete_with_errors' as const, discovered: 10, processed: 10 };
    const { rerender } = render(<ScanProgress status={status({ ...done, failed: 1 })} />);
    expect(screen.getByText('1 file could not be read')).toBeTruthy();

    rerender(<ScanProgress status={status({ ...done, failed: 4 })} />);
    expect(screen.getByText('4 files could not be read')).toBeTruthy();
  });

  // The server knows why it stopped; its words beat a generic line.
  it('shows the server error when a scan fails', () => {
    render(<ScanProgress status={status({ status: 'failed', error: 'permission denied' })} />);
    expect(screen.getByRole('status')).toHaveTextContent('permission denied');
  });

  it('falls back to its own wording when a failure carries no message', () => {
    render(<ScanProgress status={status({ status: 'failed' })} />);
    expect(screen.getByRole('status')).toHaveTextContent('The scan stopped before it finished.');
  });

  // A scan of 12k photos runs for minutes; a screen reader left on "Scanning"
  // the whole time learns nothing.
  it('announces its progress politely', () => {
    render(<ScanProgress status={status({ discovered: 400, processed: 100 })} />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('groups large counts the way the language does', () => {
    render(
      <I18nProvider locale="nl">
        <ScanProgress status={status({ discovered: 12000, processed: 1500 })} />
      </I18nProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('1.500 van 12.000 bestanden');
  });
});
