/**
 * Choosing and remembering the interface language (ADR 0021).
 *
 * Kept free of React so the resolution rules can be tested directly: which
 * language a reader ends up with is the part that is easy to get subtly
 * wrong, and hardest to notice when it is.
 */

export const LOCALES = ['en', 'nl'] as const;
export type Locale = (typeof LOCALES)[number];

/** The language used when nothing else decides. */
export const FALLBACK_LOCALE: Locale = 'en';

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * Picks the language from the reader's stored choice, else their browser.
 *
 * A stored choice always wins — it is an explicit instruction, and a browser
 * that disagrees is not a reason to overrule it. An empty stored value means
 * "follow the browser", which is how a reader undoes a choice without having
 * to know what their browser asks for.
 *
 * Browser languages are tried in the order given, because that list is a
 * preference order. Each is matched on its primary subtag, so `nl-BE` and
 * `nl-NL` both find Dutch: we translate a language, not a region.
 */
export function resolveLocale(
  stored: string | null | undefined,
  browser: readonly string[],
): Locale {
  if (stored && isLocale(stored)) return stored;
  for (const tag of browser) {
    const primary = tag.toLowerCase().split('-')[0];
    if (isLocale(primary)) return primary;
  }
  return FALLBACK_LOCALE;
}

/**
 * The BCP 47 tag handed to Intl for dates and numbers.
 *
 * English is rendered as en-GB rather than en: this is a European household
 * product, and "15 March 2026" is what the reader expects where en-US would
 * say "March 15, 2026".
 */
export function intlLocale(locale: Locale): string {
  return locale === 'en' ? 'en-GB' : 'nl-NL';
}

/** What `navigator` asks for, in preference order. */
export function browserLocales(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  if (navigator.languages?.length) return navigator.languages;
  return navigator.language ? [navigator.language] : [];
}
