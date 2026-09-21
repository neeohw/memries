import type { ReactNode } from 'react';

export function PageHeader({
  title,
  meta,
  leading,
  actions,
}: {
  title: string;
  meta?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex min-h-14 shrink-0 items-center gap-2 px-3 py-2 min-[640px]:px-5">
      {leading}
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <h1 className="truncate font-display text-lg font-semibold tracking-tight text-plum">
          {title}
        </h1>
        {meta && <p className="shrink-0 text-xs text-ink">{meta}</p>}
      </div>
      {actions}
    </div>
  );
}
