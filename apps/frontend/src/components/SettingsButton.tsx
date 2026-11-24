import { useI18n } from '../i18n/I18nProvider';
import { GearIcon } from './icons';

/** Opens the admin area, which is the Folders page. Admins only (ADR 0024). */
export function SettingsButton({ selected, onOpen }: { selected: boolean; onOpen: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t('admin.open')}
      title={t('admin.open')}
      aria-current={selected ? 'page' : undefined}
      className={`grid h-11 w-11 place-items-center rounded-full transition duration-200 active:scale-95 ${
        selected ? 'bg-surface text-plum' : 'text-ink hover:bg-surface/70 hover:text-plum'
      }`}
    >
      <GearIcon className="h-5 w-5" />
    </button>
  );
}
