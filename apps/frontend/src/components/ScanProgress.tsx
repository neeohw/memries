import { useI18n } from '../i18n/I18nProvider';
import { indexProgress, shouldPoll, type IndexStatus } from '../lib/indexStatus';

/**
 * Live progress for a scan started from the Folders page (ADR 0023).
 *
 * The coordinator runs one job for the whole library ([0020]), not one per
 * folder, so this sits at the top of the page rather than on the card whose
 * button was pressed — a scan triggered by one folder reports on all of them.
 */
export function ScanProgress({ status }: { status?: IndexStatus }) {
  const { t, intl } = useI18n();
  if (!status) return null;

  const running = shouldPoll(status);
  const failed = status.status === 'failed';
  const finished = status.status === 'complete' || status.status === 'complete_with_errors';
  if (!running && !failed && !finished) return null;

  const percent = indexProgress(status);
  const num = (value: number) => new Intl.NumberFormat(intl).format(value);

  return (
    <section
      aria-labelledby="scan-progress-title"
      data-scan-progress
      className="grid gap-2 rounded-xl bg-surface/70 p-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="scan-progress-title" className="font-medium text-plum">
          {running ? t('scan.title') : failed ? t('scan.stopped') : t('scan.done')}
        </h2>
        {running && status.discovered > 0 && (
          <p className="shrink-0 text-xs text-ink">{num(percent)}%</p>
        )}
      </div>

      {/* aria-live so the counts are announced as they climb, rather than
          leaving a screen reader on "Scanning" for several minutes. */}
      <p role="status" aria-live="polite" className="text-sm text-ink">
        {running && status.status === 'queued' && t('scan.queued')}
        {running && status.status === 'running' && status.discovered === 0 && t('scan.looking')}
        {running &&
          status.status === 'running' &&
          status.discovered > 0 &&
          t('scan.counted', {
            processed: num(status.processed),
            discovered: num(status.discovered),
          })}
        {finished &&
          t('scan.summary', { indexed: num(status.indexed), skipped: num(status.skipped) })}
        {failed && (status.error || t('scan.stopped'))}
      </p>

      {running && (
        <div
          role="progressbar"
          aria-label={t('scan.progress')}
          // Indeterminate until discovery has counted something: a bar at 0%
          // for the whole walk reads as stuck rather than as working.
          aria-valuenow={status.discovered > 0 ? percent : undefined}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-1.5 overflow-hidden rounded-full bg-cream"
        >
          <div
            className="h-full rounded-full bg-plum transition-[width] duration-300 ease-out motion-reduce:transition-none"
            style={{ width: status.discovered > 0 ? `${percent}%` : '15%' }}
          />
        </div>
      )}

      {status.failed > 0 && (
        <p className="text-xs text-ink">{t('scan.failedCount', { count: status.failed })}</p>
      )}
    </section>
  );
}
