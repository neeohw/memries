import { SignOutIcon } from './icons';

export function SignOutButton({ onSignOut }: { onSignOut: () => void }) {
  return (
    <button
      type="button"
      onClick={onSignOut}
      className="grid h-11 w-11 place-items-center rounded-full text-ink transition duration-200 hover:bg-surface/70 hover:text-plum active:scale-95"
      aria-label="Sign out"
      title="Sign out"
    >
      <SignOutIcon className="h-5 w-5" />
    </button>
  );
}
