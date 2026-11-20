import type { ReactNode } from 'react';
import type { NavTab } from '../models/photo';
import { BottomNavigation, NavButtons } from './BottomNavigation';
import { AccountButton } from './AccountButton';
import { ThemeToggle } from './ThemeToggle';
import { TopHeader } from './TopHeader';
import { useI18n } from '../i18n/I18nProvider';

export function AppShell({
  tab,
  onTabChange,
  admin = false,
  children,
}: {
  tab: NavTab;
  onTabChange: (tab: NavTab) => void;
  admin?: boolean;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="relative flex h-dvh overflow-hidden bg-cream text-plum">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[70] focus:rounded-full focus:bg-plum focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-cream"
      >
        Skip to content
      </a>

      <aside
        data-nav-layout="side"
        className="relative z-30 hidden w-16 shrink-0 flex-col items-center justify-between border-r border-plum/5 py-4 min-[800px]:flex"
      >
        <div className="flex w-full flex-col items-center gap-6">
          <span
            className="grid h-9 w-9 place-items-center rounded-2xl bg-surface/80 shadow-soft"
            title="Memries"
          >
            <span
              className="h-4 w-4 rounded-full bg-gradient-to-br from-peach to-blush"
              aria-hidden
            />
            <span className="sr-only">Memries</span>
          </span>
          <nav aria-label={t('nav.main')} className="w-full">
            <NavButtons tab={tab} onChange={onTabChange} orientation="vertical" admin={admin} />
          </nav>
        </div>
        <div className="flex w-full flex-col items-center">
          <ThemeToggle />
          <AccountButton selected={tab === 'account'} onOpen={() => onTabChange('account')} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopHeader selected={tab === 'account'} onOpenAccount={() => onTabChange('account')} />
        <main id="main-content" tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
          {children}
        </main>
        <BottomNavigation tab={tab} onChange={onTabChange} admin={admin} />
      </div>
    </div>
  );
}
