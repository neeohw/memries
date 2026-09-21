import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function icon(props: IconProps) {
  return {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...props,
  };
}

export function FilterIcon(props: IconProps) {
  return (
    <svg {...icon(props)}>
      <path d="M4 6h16l-6 7.2V19l-4 1.5v-7.3L4 6Z" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...icon(props)}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

export function HeartIcon({ filled, ...props }: IconProps & { filled?: boolean }) {
  return (
    <svg {...icon(props)} fill={filled ? 'currentColor' : 'none'}>
      <path d="M12 20s-7-4.4-9.2-8.2C1.2 8.8 3.2 5 6.8 5c2 0 3.3 1.1 5.2 3.1C13.9 6.1 15.2 5 17.2 5c3.6 0 5.6 3.8 4 6.8C19 15.6 12 20 12 20Z" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...icon(props)}>
      <path d="M6 6 18 18M18 6 6 18" />
    </svg>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <svg {...icon(props)}>
      <path d="m15 5-7 7 7 7" />
    </svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...icon(props)}>
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg {...icon(props)}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function AlbumIcon(props: IconProps) {
  return (
    <svg {...icon(props)}>
      <rect x="4" y="6" width="14" height="14" rx="2.5" />
      <path d="M8 6V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-1" />
      <circle cx="9.5" cy="11.5" r="1.2" />
      <path d="m8 16 2.4-2.6 2 1.7 2.7-3.1L18 16" />
    </svg>
  );
}

export function TodayIcon(props: IconProps) {
  return (
    <svg {...icon(props)}>
      <rect x="4" y="5" width="16" height="15" rx="2.5" />
      <path d="M8 3.5v3M16 3.5v3M4 10h16" />
      <path d="m9 15 2 2 4-4.5" />
    </svg>
  );
}

export function FoldersIcon(props: IconProps) {
  return (
    <svg {...icon(props)}>
      <path d="M4 9v9.2A1.8 1.8 0 0 0 5.8 20H18a2 2 0 0 0 2-2v-7.2A1.8 1.8 0 0 0 18.2 9h-5.4L11 7H5.8A1.8 1.8 0 0 0 4 8.8V9Z" />
      <path d="M8 7V6.2A1.2 1.2 0 0 1 9.2 5h4.3L15 7" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...icon(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <svg {...icon(props)}>
      <circle cx="12" cy="12" r="3.6" />
      <path d="M12 3.2v1.8M12 19v1.8M4.9 4.9l1.3 1.3M17.8 17.8l1.3 1.3M3.2 12H5M19 12h1.8M4.9 19.1l1.3-1.3M17.8 6.2l1.3-1.3" />
    </svg>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <svg {...icon(props)}>
      <path d="M16.4 13.6A6.2 6.2 0 0 1 10.2 5.6 6.4 6.4 0 1 0 16.4 13.6Z" />
    </svg>
  );
}

export function SyncIcon(props: IconProps) {
  return (
    <svg {...icon(props)}>
      <path d="M19.5 12a7.5 7.5 0 0 1-13.2 4.9M4.5 12a7.5 7.5 0 0 1 13.2-4.9" />
      <path d="M18 3.5v3.8h-3.8M6 20.5v-3.8h3.8" />
    </svg>
  );
}
