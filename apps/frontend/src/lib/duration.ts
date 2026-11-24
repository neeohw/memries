/**
 * Clip lengths, written the way a player writes them.
 *
 * Under an hour is m:ss, because 0:07 reads as seven seconds and 00:07 reads
 * as a stopwatch. An hour or more gets h:mm:ss. The minutes and seconds are
 * padded, the leading unit never is.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  // Rounded, not floored: a 1.6s clip is "0:02", and floor would show a clip
  // that plays as "0:00".
  const total = Math.round(ms / 1000);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
