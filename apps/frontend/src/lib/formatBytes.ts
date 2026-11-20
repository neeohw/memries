/**
 * Human-readable byte size for the free-space figure beside the thumbnail
 * folder. Locale-aware, because "1,5 GB" is what a Dutch reader expects where
 * English writes "1.5 GB" (ADR 0021).
 */
export function formatBytes(bytes: number, locale?: string): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  // No decimal on bytes and kB, where a fraction is noise; one above that.
  const digits = unit <= 1 ? 0 : value < 100 ? 1 : 0;
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
  return `${formatted} ${units[unit]}`;
}
