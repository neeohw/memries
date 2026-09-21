import { useRef } from 'react';
import { useSlidingHighlight } from '../hooks/useSlidingHighlight';
import type { Granularity } from '../models/photo';

const OPTIONS: { value: Granularity; label: string }[] = [
  { value: 'year', label: 'Year' },
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'day', label: 'Day' },
];

export function GranularitySelector({
  value,
  onChange,
  className = '',
}: {
  value: Granularity;
  onChange: (value: Granularity) => void;
  className?: string;
}) {
  const { groupRef, setItemRef, box } = useSlidingHighlight(value);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const move = (nextIndex: number) => {
    const option = OPTIONS[(nextIndex + OPTIONS.length) % OPTIONS.length];
    onChange(option.value);
    buttonRefs.current[(nextIndex + OPTIONS.length) % OPTIONS.length]?.focus();
  };

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label="Group memories by"
      className={`relative grid shrink-0 grid-cols-4 rounded-full bg-surface/55 p-0.5 shadow-inner backdrop-blur-md ${className}`}
    >
      <div
        aria-hidden
        data-granularity-indicator
        data-granularity={value}
        className="pointer-events-none absolute top-0.5 h-[calc(100%-0.25rem)] rounded-full bg-surface shadow-lift transition-[left,width] duration-300 ease-out motion-reduce:transition-none"
        style={{ left: box.left, width: box.width }}
      />
      {OPTIONS.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              buttonRefs.current[index] = node;
              setItemRef(option.value)(node);
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault();
                move(index + 1);
              }
              if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault();
                move(index - 1);
              }
              if (event.key === 'Home') {
                event.preventDefault();
                move(0);
              }
              if (event.key === 'End') {
                event.preventDefault();
                move(OPTIONS.length - 1);
              }
            }}
            className={`relative z-10 min-h-9 rounded-full px-2 text-xs font-medium min-[640px]:px-3 min-[640px]:text-sm transition-colors duration-200 ${
              checked ? 'text-plum' : 'text-ink hover:text-plum'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
