import { useEffect, useState } from 'react';

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
  const [displayed, setDisplayed] = useState(label);
  const [outgoing, setOutgoing] = useState<string | null>(null);

  if (label && label !== displayed) {
    setDisplayed(label);
    setOutgoing(reducedMotion ? null : displayed);
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
          aria-label="Current period"
          data-current-period
          data-period-motion={motion}
        >
          {displayed}
        </p>
      </div>
    </div>
  );
}
