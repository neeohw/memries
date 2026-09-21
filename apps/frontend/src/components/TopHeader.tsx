import { ThemeToggle } from './ThemeToggle';

export function TopHeader() {
  return (
    <header className="flex items-center justify-between gap-3 px-3 py-1.5 min-[800px]:hidden">
      <div className="flex items-center gap-2">
        <span
          className="h-3.5 w-3.5 rounded-full bg-gradient-to-br from-peach to-blush"
          aria-hidden
        />
        <p className="font-display text-lg font-semibold tracking-tight text-plum">Memries</p>
      </div>
      <ThemeToggle />
    </header>
  );
}
