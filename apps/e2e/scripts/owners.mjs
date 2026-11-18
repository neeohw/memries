/**
 * One account per Playwright worker (ADR 0012).
 *
 * Local runs use four parallel workers against one Compose stack. They used to
 * share `admin@example.com`, which made them anything but independent: the
 * `After` hook calls `/api/e2e/reset`, and that is owner-scoped, so one
 * worker's teardown wiped another worker's live albums and favorites. Giving
 * each worker its own owner makes the workers unaware of each other without a
 * second stack, because every axis the backend indexes on is already
 * owner-scoped: dedup is `(owner_id, hash)`, `/api/e2e/reset` takes the
 * session's key, and the index scope is a photo folder named after the email.
 *
 * Slot 0 keeps `admin@example.com` so the README, the `indexer -owner` command
 * and serial CI runs all describe the same account they always did.
 *
 * The list is static because `MEMRIES_BOOTSTRAP_PASSWORD` is the only way an
 * account gets a password (ADR 0016), so the emails must be in the stack's
 * environment before the suite starts. Running more workers than there are
 * slots is therefore an error, not a silent fallback to sharing.
 */
export const E2E_OWNERS = Object.freeze([
  'admin@example.com',
  'worker-1@example.com',
  'worker-2@example.com',
  'worker-3@example.com',
]);

/** The owner for a Playwright worker, by its `parallelIndex`. */
export function ownerEmail(parallelIndex = 0) {
  if (!Number.isInteger(parallelIndex) || parallelIndex < 0) {
    throw new Error(`parallelIndex must be a non-negative integer, got ${parallelIndex}`);
  }
  const email = E2E_OWNERS[parallelIndex];
  if (!email) {
    throw new Error(
      `no e2e account for worker ${parallelIndex}: only ${E2E_OWNERS.length} are bootstrapped ` +
        `(MEMRIES_ADMIN_EMAILS in apps/e2e/docker-compose.yml). Lower --workers or add a slot.`,
    );
  }
  return email;
}
