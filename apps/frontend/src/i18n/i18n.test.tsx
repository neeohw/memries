import { describe, expect, it } from 'vitest';
import { createTranslator } from './I18nProvider';
import { en } from './messages';
import { nl } from './nl';
import { browserLocales, intlLocale, isLocale, resolveLocale } from './locale';

describe('resolveLocale', () => {
  it('honours an explicit choice over the browser', () => {
    expect(resolveLocale('nl', ['en-GB', 'en'])).toBe('nl');
    expect(resolveLocale('en', ['nl-NL'])).toBe('en');
  });

  it('follows the browser when nothing is stored', () => {
    // Empty means "follow the browser": that is how a reader undoes a choice
    // without having to know what their browser asks for.
    expect(resolveLocale('', ['nl-NL', 'en'])).toBe('nl');
    expect(resolveLocale(null, ['nl'])).toBe('nl');
    expect(resolveLocale(undefined, ['en-US'])).toBe('en');
  });

  it('matches on the language, not the region', () => {
    expect(resolveLocale('', ['nl-BE'])).toBe('nl');
    expect(resolveLocale('', ['EN-au'])).toBe('en');
  });

  it('takes the first language it can serve, in preference order', () => {
    expect(resolveLocale('', ['de-DE', 'fr', 'nl-NL', 'en'])).toBe('nl');
  });

  it('falls back to English for a language it does not have', () => {
    expect(resolveLocale('', ['de-DE', 'fr'])).toBe('en');
    expect(resolveLocale('', [])).toBe('en');
    // A stored value that is not a language we serve is ignored, not trusted.
    expect(resolveLocale('de', ['nl'])).toBe('nl');
  });

  it('renders English dates the European way', () => {
    // en-US would say "March 15, 2026"; this is a European household product.
    expect(intlLocale('en')).toBe('en-GB');
    expect(intlLocale('nl')).toBe('nl-NL');
  });

  it('knows which strings are languages', () => {
    expect(isLocale('nl')).toBe(true);
    expect(isLocale('de')).toBe(false);
  });

  it('reads the browser list without one', () => {
    expect(Array.isArray(browserLocales())).toBe(true);
  });
});

describe('translator', () => {
  it('returns the message for the language', () => {
    expect(createTranslator('en')('nav.favorites')).toBe('Favorites');
    expect(createTranslator('nl')('nav.favorites')).toBe('Favorieten');
  });

  it('fills named placeholders', () => {
    expect(createTranslator('en')('albums.select', { name: 'Summer' })).toBe('Select album Summer');
  });

  it('leaves a placeholder with no value visible, rather than printing undefined', () => {
    // A stray {name} is a bug report; "Select album undefined" reads like a
    // product that does not know what it holds.
    expect(createTranslator('en')('albums.select')).toBe('Select album {name}');
  });

  it('picks a plural form by count', () => {
    const t = createTranslator('en');
    expect(t('albums.photoCount', { count: 1 })).toBe('1 photo');
    expect(t('albums.photoCount', { count: 4 })).toBe('4 photos');
    expect(t('albums.photoCount', { count: 0 })).toBe('0 photos');
  });

  it('pluralises Dutch by its own rules', () => {
    const t = createTranslator('nl');
    expect(t('albums.photoCount', { count: 1 })).toBe('1 foto');
    expect(t('albums.photoCount', { count: 3 })).toBe('3 foto’s');
  });

  it('falls back to English for a key a catalogue is missing', () => {
    // Belt and braces: the types already make this impossible to write.
    expect(createTranslator('nl')('app.name')).toBe('Memries');
  });

  it('returns the key itself when there is no message at all', () => {
    // Greppable, and obvious in the interface, unlike an empty space.
    expect(createTranslator('en')('nothing.here')).toBe('nothing.here');
  });
});

describe('catalogues', () => {
  function keysOf(node: unknown, prefix = ''): string[] {
    if (typeof node !== 'object' || node === null) return [prefix];
    return Object.entries(node).flatMap(([key, value]) =>
      keysOf(value, prefix ? `${prefix}.${key}` : key),
    );
  }

  it('say the same things in both languages', () => {
    // The types enforce this at compile time; this catches a key that is
    // present but left in English by mistake during a sweep.
    expect(keysOf(nl)).toEqual(keysOf(en));
  });

  it('has no English left in the Dutch catalogue by accident', () => {
    // Words that are genuinely the same in both languages.
    const shared = new Set([
      'Memries',
      'Albums',
      'Album',
      'WebDAV',
      'URL',
      'English',
      'Nederlands',
      'Week',
      'Auto',
      'Account',
    ]);
    const englishLeftovers: string[] = [];
    for (const key of keysOf(en)) {
      const a = key.split('.').reduce<never>((n, p) => (n as never)[p], en as never) as string;
      const b = key.split('.').reduce<never>((n, p) => (n as never)[p], nl as never) as string;
      if (a === b && !shared.has(a)) englishLeftovers.push(key);
    }
    expect(englishLeftovers).toEqual([]);
  });
});

describe('number formatting in messages', () => {
  it('groups a numeric value the way the language does', () => {
    // A year strip routinely reports four and five figures (ADR 0031), and
    // "11000 more" is not how anyone writes eleven thousand.
    expect(
      createTranslator('en')('timeline.showAllInPeriod', { count: 11000, period: '2019' }),
    ).toBe('11,000 more in 2019 — zoom in');
    expect(
      createTranslator('nl')('timeline.showAllInPeriod', { count: 11000, period: '2019' }),
    ).toBe('Nog 11.000 in 2019 — inzoomen');
  });

  it('leaves a string value alone, so a year keeps its digits', () => {
    // The period is passed as a string precisely so it is not grouped into
    // "2.019".
    expect(createTranslator('nl')('timeline.showAllInPeriod', { count: 5, period: '2019' })).toBe(
      'Nog 5 in 2019 — inzoomen',
    );
  });

  it('still chooses the plural form from the raw count', () => {
    expect(createTranslator('en')('favorites.count', { count: 1 })).toBe('1 memory');
    expect(createTranslator('en')('favorites.count', { count: 2400 })).toBe('2,400 memories');
  });
});
