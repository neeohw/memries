import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';

export const PERIOD_SWAP_MS = 380;

export function CurrentPeriod({
  label,
  scrolling,
  direction,
  reducedMotion,
}: {
  label: string;
  scrolling: boolean;
  direction: 'older' | 'newer';
  reducedMotion: boolean;
}) {
  const { t } = useI18n();
  const [displayed, setDisplayed] = useState(label);
  const [outgoing, setOutgoing] = useState<string | null>(null);
  if (label && label !== displayed) {
    setDisplayed(label);
    // The slide means the list is moving, so it is only for a change that
    // arrives while it is. A zoom change is not a scroll: this component is
    // remounted on one, mounts holding the label from the old grouping, and
    // is handed the new one once the list has settled — animating that played
    // "April 2026" against "2026", both on screen at once (ADR 0019).
    setOutgoing(reducedMotion || !scrolling ? null : displayed);
  }

  useEffect(() => {
    if (!outgoing) return;
    const timer = window.setTimeout(() => setOutgoing(null), PERIOD_SWAP_MS);
    return () => window.clearTimeout(timer);
  }, [outgoing]);

  const liveScrolling = scrolling && !reducedMotion;
  const swapping = Boolean(outgoing) && !reducedMotion;
  const motion = reducedMotion
    ? 'none'
    : swapping
      ? `slide-${direction}`
      : liveScrolling
        ? 'scroll'
        : 'idle';

  return (
    <div
      className="period-frame"
      data-period-scrolling={liveScrolling ? 'true' : 'false'}
      data-period-direction={direction}
    >
      <div className="period-window">
        {outgoing && swapping && (
          <span className={`period-layer period-out-${direction}`} aria-hidden>
            {outgoing}
          </span>
        )}
        <p
          className={`period-layer period-label${swapping ? ` period-in-${direction}` : ''}`}
          aria-live="polite"
          aria-label={t('timeline.currentPeriod')}
          data-current-period
          data-period-motion={motion}
        >
          {displayed}
        </p>
      </div>
    </div>
  );
}
