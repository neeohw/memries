import type { ReactNode } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import type { NavTab } from '../models/photo';

/** The admin tabs, in the order they are used (ADR 0024). */
const SECTIONS: { tab: NavTab; label: string }[] = [
  { tab: 'folders', label: 'admin.folders' },
  { tab: 'settings', label: 'admin.storage' },
];

/**
 * Wraps the admin pages with a strip to move between them.
 *
 * Folders used to be a main nav tab beside Memories and Albums, which put
 * server administration next to browsing and gave readers a tab they could
 * never open. Both admin pages now sit behind the gear, and this strip is how
 * they relate to each other.
 */
export function AdminLayout({
  tab,
  onTabChange,
  children,
}: {
  tab: NavTab;
  onTabChange: (tab: NavTab) => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav
        aria-label={t('admin.sections')}
        data-admin-sections
        className="flex shrink-0 gap-1 px-3 pt-3 min-[640px]:px-5"
      >
        {SECTIONS.map((section) => {
          const selected = section.tab === tab;
          return (
            <button
              key={section.tab}
              type="button"
              onClick={() => onTabChange(section.tab)}
              aria-current={selected ? 'page' : undefined}
              className={`min-h-9 rounded-full px-3.5 text-sm font-medium transition duration-200 ${
                selected ? 'bg-surface text-plum' : 'text-ink hover:bg-surface/60 hover:text-plum'
              }`}
            >
              {t(section.label)}
            </button>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
