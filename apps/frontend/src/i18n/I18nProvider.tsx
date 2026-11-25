import { createContext, useContext, useMemo } from 'react';
import { en, type Messages } from './messages';
import { nl } from './nl';
import { FALLBACK_LOCALE, intlLocale, type Locale } from './locale';

const CATALOGUES: Record<Locale, Messages> = { en, nl };

/** A message key, written as the dotted path through the catalogue. */
export type Values = Record<string, string | number>;

export interface I18n {
  locale: Locale;
  /** The BCP 47 tag for Intl: dates and numbers follow the language. */
  intl: string;
  t: (key: string, values?: Values) => string;
}

const I18nContext = createContext<I18n | null>(null);

/**
 * Looks a dotted key up in a catalogue.
 *
 * Returns undefined rather than throwing on a miss, so a key that only exists
 * in one catalogue degrades to the English word instead of a blank screen.
 */
function lookup(messages: Messages, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
      messages,
    );
}

/**
 * Fills `{named}` placeholders.
 *
 * A placeholder with no value is left as written rather than replaced with
 * "undefined": a visible `{count}` is a bug report, where "undefined photos"
 * reads like a product that does not know what it holds.
 *
 * A numeric value goes through `Intl.NumberFormat`, so a library of eleven
 * thousand photos reads as "11,000 memories" in English and "11.000" in
 * Dutch. It is done here rather than at the call sites because the grouping
 * separator is a property of the language, which is this file's subject. A
 * value that must stay unformatted — a year, an id — is passed as a string.
 */
function interpolate(template: string, format: Intl.NumberFormat, values?: Values): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    if (!(name in values)) return whole;
    const value = values[name];
    return typeof value === 'number' ? format.format(value) : String(value);
  });
}

export function createTranslator(locale: Locale): (key: string, values?: Values) => string {
  const catalogue = CATALOGUES[locale] ?? CATALOGUES[FALLBACK_LOCALE];
  const plural = new Intl.PluralRules(intlLocale(locale));
  const number = new Intl.NumberFormat(intlLocale(locale));

  return (key, values) => {
    let message = lookup(catalogue, key);
    if (message === undefined && catalogue !== CATALOGUES[FALLBACK_LOCALE]) {
      message = lookup(CATALOGUES[FALLBACK_LOCALE], key);
    }

    // A message that varies by count is an object of plural categories.
    if (message && typeof message === 'object' && values && 'count' in values) {
      const forms = message as Record<string, string>;
      const category = plural.select(Number(values.count));
      message = forms[category] ?? forms.other ?? forms.one;
    }

    if (typeof message !== 'string') {
      // The key itself, so a missing message is obvious in the interface and
      // greppable in the catalogue, rather than an empty space.
      return key;
    }
    return interpolate(message, number, values);
  };
}

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const value = useMemo<I18n>(
    () => ({ locale, intl: intlLocale(locale), t: createTranslator(locale) }),
    [locale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * The translator for the current language.
 *
 * Falls back to English outside a provider rather than throwing, so a test
 * that renders one component does not have to wrap it.
 */
export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  const fallback = useMemo<I18n>(
    () => ({
      locale: FALLBACK_LOCALE,
      intl: intlLocale(FALLBACK_LOCALE),
      t: createTranslator(FALLBACK_LOCALE),
    }),
    [],
  );
  return ctx ?? fallback;
}

/**
 * Shorthand for the common case of wanting only the translator.
 *
 * Returned as-is: the provider already memoises it per language, so
 * re-wrapping would add an identity that changes for no reason.
 */
export function useT(): (key: string, values?: Values) => string {
  return useI18n().t;
}
