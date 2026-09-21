import { useTheme } from '../hooks/useTheme';
import { MoonIcon, SunIcon } from './icons';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  const Icon = theme === 'dark' ? SunIcon : MoonIcon;

  return (
    <button
      type="button"
      onClick={toggle}
      className="grid h-11 w-11 place-items-center rounded-full text-ink transition duration-200 hover:rotate-12 hover:bg-surface/70 hover:text-plum active:scale-95"
      aria-label={label}
      title={label}
      data-theme-toggle
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}
