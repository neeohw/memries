# ADR 0021 — English and Dutch, chosen per reader

- Status: accepted
- Date: 2026-11-20

## Context

The product is used by a Dutch-speaking household and written in English.
Everything a reader sees needs both languages, including the labels a screen
reader announces, which are often the only words on a screen full of
photographs.

## Decision

### Typed dictionaries, no i18n library

`i18n/messages.ts` holds English as `as const`, which freezes each value to
its own literal type. `Messages` widens those values to `string` while keeping
the key structure exact, so `nl.ts` typed as `Messages` **cannot compile with
a key missing**. That is the whole reason for not reaching for a library: the
failure this guards against — an English word appearing mid-sentence in a
Dutch interface — is caught by the compiler rather than by a reader.

Around 120 lines, no dependency, nothing to configure, and no bundle cost on a
machine where the bundle is served from a 2GB board.

Interpolation is `{named}`. A placeholder with no value is left visible rather
than replaced with "undefined": a stray `{count}` is a bug report, where
"undefined photos" reads like a product that does not know what it holds.

Plurals go through `Intl.PluralRules` with `.one` and `.other` forms, so "1
photo" and "3 foto's" are both right without either language hard-coding the
other's rules.

A key with no message returns the key itself — greppable, and obvious on
screen, unlike a blank space.

### The choice lives on the account

`users.locale` is `'en'`, `'nl'`, or **empty meaning "follow the browser"**.
That empty value matters: it is how a reader undoes a choice without having to
know what their browser asks for, and it is the default, so a Dutch browser
gets Dutch on first sign-in with nothing configured.

`GET /api/me` reports it and `PUT /api/me/locale` sets it. The locale is read
fresh on every `/api/me` rather than kept in the session cookie, which would
hold a stale copy until sign-out.

`resolveLocale` prefers the stored choice over the browser always — an
explicit instruction is not overruled by a header — and matches browser tags
on their primary subtag, so `nl-BE` and `nl-NL` both find Dutch. We translate
a language, not a region.

### Dates follow the language

Every formatter in `lib/formatDate.ts` takes an optional BCP 47 locale, passed
explicitly rather than read from a module-level "current language". That keeps
them pure: a label is a function of its inputs, and a test does not depend on
what another test set last.

English renders as **en-GB**, not `en`. This is a European household product:
"15 March 2026" is what the reader expects, where `en-US` would say "March 15,
2026". It also makes the rendering deterministic, instead of varying with
whatever locale the machine running the tests happens to have.

`formatWeekLabel` now takes its month names from `Intl` rather than a
hard-coded English array.

### An account settings page, not a control in the chrome

The language first went into the sidebar rail and the mobile header as a
`<select>`. That was wrong twice over: a browser-drawn control sitting beside
hand-made ones, and a per-reader setting given the same weight as a toolbar
button. There was also no room — the rail is 64px, so the languages had to
shrink to `EN` and `NL`, which is not what someone looking for their own
language scans for.

`AccountView` is a real page, reached from a person icon where the dropdown
was. It holds the language, who is signed in, and the way out — sign-out moved
here from the chrome at the same time, since it belongs with the account
rather than beside a theme toggle.

The language is a `radiogroup` rather than a select: three options is a choice
to show, not one to hide behind a control that opens. "Match my browser" is
first and is itself a choice, marked like the others. Each language is written
in itself — *Nederlands*, not *Dutch*. There is room here to say what the
setting affects, so the page does: dates and times follow it too.

Changing the language patches the cached `/api/me` optimistically: the whole
interface changes on this, and a round trip of English before the Dutch
arrives would look broken.

## Consequences

- Adding a string means adding it to both catalogues. The compiler enforces
  the Dutch half.
- A test asserts the two catalogues have identical keys **and** that no Dutch
  value is accidentally still the English one, with a short list of words that
  are genuinely the same in both (Memries, Album, WebDAV, URL, Week, Auto).
- Changing a locale is one row and takes effect on the next render; it is not
  a page reload.
- The e2e suite pins `locale: 'en-GB'` in Playwright and no account sets a
  language, so the suite stays English and its assertions are unaffected.
- Only the interface is translated. Photo metadata, folder paths and server
  error text are passed through as they come.
