# ADR 0028 — One YAML file configures the server

- Status: accepted
- Date: 2026-11-24
- Replaces: ADR 0022 (admin-settable thumbnail location), deleted with this change

## Context

The server was configured by sixteen `MEMRIES_*` environment variables, and
one setting — the thumbnail folder — was configured somewhere else entirely:
an admin page that wrote to a `settings` table, overriding the variable at
startup (the deleted ADR 0022).

That left no single answer to "what is this server configured to do". The
thumbnail folder had three possible sources (the stored setting, the
variable, the XDG default) and the only way to find the live value was to
open the admin page. Environment variables are also a poor fit for what this
is: a handful of long-lived settings on a box that is rebooted, not a
twelve-factor process re-scheduled across a fleet. They cannot be commented,
cannot be diffed, are invisible in `ps`, and `docker compose config` is the
only way to see what a container actually got.

## Decision

### One file, no environment layer

`memries.yaml` holds everything, including the secrets. There is no
`MEMRIES_*` fallback, no merge order, no precedence table: a setting has
exactly one home, so a running server is explained by one file that can be
read, commented, diffed and backed up.

```yaml
server:   { addr, public_url, session_key, e2e }
database: { driver, dsn }
library:  { roots: [...], cache }
admins:   { emails: [...], bootstrap_password }
storage:  { backend, s3: {...} }
```

Found at `--config`, then `$MEMRIES_CONFIG`, then `./memries.yaml`, then
`/etc/memries/config.yaml`. Those two variables are the exception that proves
the rule: a process has to be told **where** its configuration is, and that
is not itself a setting. The same goes for `$CACHE_DIRECTORY`, which systemd
sets from `CacheDirectory=` and which still supplies the default thumbnail
location — the service manager naming a directory it created, not a
configured value.

**Unknown keys are an error.** In a file that is the only source of truth, a
misspelled key that silently fell back to a default would be the exact
failure this format is meant to prevent. `library.cahce: /media/sdhc` has to
fail loudly, so `KnownFields(true)` is on and a typo names itself.

Secrets live in the file. It is gitignored, the server warns at startup if it
is readable by anyone but its owner, and the warning is not a refusal: a
bind-mounted file in a container is routinely `0644` and the server still has
to start.

### The thumbnail folder stops being a runtime setting

It is `library.cache`, set in the file and read at startup. The admin page,
the `settings` table, `db.Setting`/`SetSetting`, `GET/PUT /api/admin/settings`
and `Generator.SetRoot` are all gone.

Moving a cache is not something to do while the server is serving. The old
design let an admin point the generator at a new directory mid-flight, which
meant a mutex on every thumb path lookup, a half-populated cache until the
next scan, and a page that had to explain that the thumbnails they could
still see were in the old place. Thumb paths on a Photo are relative to the
root, so the honest operation is: stop the server, move the directory, edit
one line, start it. The generator is now a plain struct with a fixed root.

The admin area therefore holds one page, Folders, and the gear opens it
directly ([0024](0024-admin-area.md)). Free disk space is no longer shown
anywhere in the app; `df` is the tool for that, and nothing in the product
depended on it.

`library.cache` is optional. Left out it follows `$CACHE_DIRECTORY`, then
`$XDG_CACHE_HOME/memries/thumbs`, then `~/.cache/memries/thumbs` — the same
ladder as before, because thumbnails are a regenerable cache and the
platform already has an opinion about where those go.

### `library.roots` replaces two variables

`MEMRIES_LOCAL_ROOT` and `MEMRIES_SOURCE_ROOTS` were one list pretending to
be two things: the first was the legacy local store's root *and* implicitly
an allowed Source root, and the second added more. It is now one list, and
the first entry is what `LocalRoot()` returns.

### The E2E stack generates its file

`MEMRIES_E2E=1` becomes `server.e2e`, and the Playwright stack's public URL
carries the port that run leased, so `scripts/stack.mjs` writes
`apps/e2e/.work/memries.yaml` per run and Compose mounts it. The session key,
bootstrap password and admin list are pinned in that template for the same
reason they were pinned in the Compose file before: a developer's own
credentials must never reach a disposable stack
([0012](0012-e2e-one-suite-two-profiles.md), [0016](0016-local-password-auth.md)).

The suite's own `MEMRIES_E2E_*` variables stay. They configure the test
harness — which origin to drive, which feature to run — not the server.

## Consequences

- **Every install must be edited**, Compose included: `cp
  memries.example.yaml memries.yaml` and fill in `session_key`. `make up`
  fails with that instruction rather than starting a server with no key.
- **`.env` and `.env.example` are gone** from the backend's world. Compose
  still passes `GOMEMLIMIT`, which is a Go runtime knob rather than a
  setting of ours.
- **One new dependency**, `gopkg.in/yaml.v3`. Go has no YAML in its standard
  library, and hand-rolling a parser to avoid a dependency would be worse
  than the dependency.
- **The `settings` table is dropped** from the schema. An existing database
  keeps the unused table until it is recreated; nothing reads it.
- **Changing a setting now means a restart.** That was already true of
  fifteen of the sixteen variables.
- A reader who wants to know what the server is doing opens one file. That
  is the whole point.

## Verification

`internal/config/config_test.go` covers the file: defaults, the lowercasing
and cleaning, an unknown key rejected by name, every missing required setting
reported at once rather than one per restart, an unknown driver, the
"copy memries.example.yaml" message a new install meets, the search order,
and the permissions warning. `cacheroot_test.go` keeps the XDG ladder.
`stack.test.mjs` asserts the generated E2E file carries the leased origin and
the pinned credentials.
