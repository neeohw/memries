import { useSlidingHighlight } from '../hooks/useSlidingHighlight';
import type { NavTab } from '../models/photo';
import { useI18n } from '../i18n/I18nProvider';
import { AlbumIcon, FoldersIcon, HeartIcon } from './icons';

type NavItem = { id: NavTab; label: string; icon: typeof AlbumIcon };

const NAV_ITEMS: NavItem[] = [
  { id: 'memories', label: 'nav.memories', icon: AlbumIcon },
  { id: 'favorites', label: 'nav.favorites', icon: HeartIcon },
  { id: 'albums', label: 'nav.albums', icon: FoldersIcon },
];

function NavButton({
  item,
  selected,
  onChange,
  layout,
  buttonRef,
}: {
  item: NavItem;
  selected: boolean;
  onChange: (tab: NavTab) => void;
  layout: 'vertical' | 'horizontal';
  buttonRef?: (node: HTMLButtonElement | null) => void;
}) {
  const { t } = useI18n();
  const Icon = item.icon;
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => onChange(item.id)}
      aria-current={selected ? 'page' : undefined}
      className={`group relative z-10 flex flex-col items-center justify-center gap-0.5 rounded-2xl font-medium transition duration-200 active:scale-[0.98] ${
        layout === 'vertical' ? 'h-11 w-11' : 'min-h-11 px-2 py-2 text-[0.7rem] min-[640px]:text-xs'
      } ${selected ? 'text-plum' : 'text-ink hover:text-plum'}`}
    >
      {item.id === 'favorites' ? (
        <HeartIcon className="h-5 w-5" filled={selected} />
      ) : (
        <Icon className="h-5 w-5" />
      )}
      {layout === 'vertical' ? (
        <>
          <span className="sr-only">{t(item.label)}</span>
          <span
            aria-hidden
            className="pointer-events-none absolute left-full top-1/2 ml-3 -translate-x-1 -translate-y-1/2 whitespace-nowrap rounded-lg bg-plum px-2.5 py-1 text-xs font-medium text-cream opacity-0 shadow-lift transition duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100 motion-reduce:transition-none"
          >
            {t(item.label)}
          </span>
        </>
      ) : (
        <span className="max-w-full truncate">{t(item.label)}</span>
      )}
    </button>
  );
}

function SlidingIndicator({
  box,
}: {
  box: { left: number; top: number; width: number; height: number };
}) {
  return (
    <div
      aria-hidden
      data-nav-indicator
      className="pointer-events-none absolute rounded-2xl bg-surface/80 shadow-soft transition-[left,top,width,height] duration-300 ease-out motion-reduce:transition-none"
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
    />
  );
}

export function NavButtons({
  tab,
  onChange,
  orientation,
}: {
  tab: NavTab;
  onChange: (tab: NavTab) => void;
  orientation: 'horizontal' | 'vertical';
}) {
  const items = NAV_ITEMS;
  const selected = items.some((item) => item.id === tab) ? tab : items[0].id;
  const { groupRef, setItemRef, box } = useSlidingHighlight(selected);

  if (orientation === 'vertical') {
    return (
      <div ref={groupRef} className="relative flex flex-col items-center gap-1">
        <SlidingIndicator box={box} />
        {items.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            selected={tab === item.id}
            onChange={onChange}
            layout="vertical"
            buttonRef={setItemRef(item.id)}
          />
        ))}
      </div>
    );
  }

  return (
    <div ref={groupRef} className="relative">
      <SlidingIndicator box={box} />
      <div className="nav-bar-mobile">
        {items.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            selected={tab === item.id}
            onChange={onChange}
            layout="horizontal"
            buttonRef={setItemRef(item.id)}
          />
        ))}
      </div>
    </div>
  );
}

export function BottomNavigation({
  tab,
  onChange,
}: {
  tab: NavTab;
  onChange: (tab: NavTab) => void;
}) {
  const { t } = useI18n();
  return (
    <nav
      data-nav-layout="bottom"
      aria-label={t('nav.main')}
      className="border-t border-plum/10 bg-cream/80 px-2 pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-xl min-[800px]:hidden"
    >
      <NavButtons tab={tab} onChange={onChange} orientation="horizontal" />
    </nav>
  );
}
