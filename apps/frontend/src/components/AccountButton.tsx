import { useI18n } from '../i18n/I18nProvider';
import { PersonIcon } from './icons';

/** Opens the account settings page (ADR 0021). */
export function AccountButton({ selected, onOpen }: { selected: boolean; onOpen: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t('account.open')}
      title={t('account.open')}
      aria-current={selected ? 'page' : undefined}
      className={`grid h-11 w-11 place-items-center rounded-full transition duration-200 active:scale-95 ${
        selected ? 'bg-surface text-plum' : 'text-ink hover:bg-surface/70 hover:text-plum'
      }`}
    >
      <PersonIcon className="h-5 w-5" />
    </button>
  );
}
