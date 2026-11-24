# ADR 0030 — A Debian package, behind the web server you already run

- Status: accepted
- Date: 2026-11-24

## Context

The box had binaries copied onto it and nothing else, so opening it in a
browser answered `404 page not found`. That is the server being honest: it
routes `/healthz`, `/auth/*` and `/api/*` and nothing at `/`. The web
interface comes from two other containers in Compose — nginx serving the
built SPA, Caddy putting it on `/` and proxying `/api` — and neither was on
the box.

Two ways out were on the table. Embedding the SPA in the binary with
`embed.FS` was the plan of record (W3) and makes one self-contained file.
Packaging it was asked for instead: a `.deb` that drops into an nginx or
Apache install, which is what a Debian box already has and already knows how
to run.

## Decision

### The package carries the interface; the web server serves it

`memries_<version>_<arch>.deb` installs:

```
/usr/bin/memries-server          the API, as a systemd service
/usr/bin/memries-indexer         the CLI
/usr/share/memries/www/          the built SPA
/etc/memries/config.yaml         a conffile (ADR 0028)
/lib/systemd/system/memries.service
/usr/share/memries/{nginx,apache}.conf
```

The service listens on **127.0.0.1:5987**, not a public interface. nginx or
Apache serves `/usr/share/memries/www` and proxies `/api` and `/auth` to it.

### Same origin is a requirement, not a preference

`apiFetch` calls `/api/...` with **relative paths**; there is no API base in
the client and no way to configure one. That is not an oversight to fix: the
session cookie is `HttpOnly`, `Path=/`, **`SameSite=Lax`**, so a browser
withholds it on cross-site requests. An interface served from another origin
would sign in and then immediately look signed out, whatever the CORS headers
said. Making that work means `SameSite=None; Secure`, which means TLS
everywhere, to buy a split nobody wanted.

So the proxy is load-bearing, and the shipped configs exist to get it right.
Both name `/auth` explicitly: sign-in sits outside `/api` on purpose — the
session middleware guards `/api`, and you cannot present a session in order
to get one — so a config that proxied only `/api` would serve an app that can
never log in. Both also turn proxy buffering off: originals stream with byte
ranges and run to hundreds of megabytes ([0029](0029-video.md)), and
buffering one to disk before sending a byte would stall every seek and fill
the card.

They are installed as examples under `/usr/share/memries/`, not dropped into
`sites-enabled`. A package has no business editing a web server's live
configuration.

### A port of its own, so nothing has to be taken away

The shipped vhost listens on **5988**, not 80.

The first draft used `listen 80` with `server_name _`, which looks harmless
and is not: a request that arrives by IP address matches no `server_name` at
all, so nginx hands it to whichever site is the **default**. On a box already
serving something — which is the normal case for a machine chosen to hold a
photo library — Memries either loses every request or, worse, the advice
becomes "disable the other site". Telling an admin to delete a config that is
not ours to delete is not an installation step.

A dedicated port makes the package additive: install it, enable the site,
nothing that already worked stops working. The two ways to reach it on `:80`
— a `server_name` of its own, or `default_server` where nothing else claims
it — are documented in the shipped config, as choices the admin makes about
their own machine.

Apache needs `Listen 5988` in `conf-available` as well as the vhost, because
it will not listen on a port no `Listen` directive names.

### Or under a sublocation, which the app had to learn

A port of its own is additive but it is still a second address to remember.
The other way to coexist is to mount Memries at `/memries/` on the site the
box already serves — and that the app could not do, because every URL it
built was absolute from the root: `/api/photos`, `/api/thumb/...`, and
`index.html` asking for `/assets/...`.

Three changes made it mountable anywhere:

- **Vite `base: './'`**, so the built `index.html` asks for `./assets/...`
  and the browser resolves that against wherever it was served from.
- **`withBase()`**, through which `apiFetch`, the thumbnail URLs, the
  original URLs and the sign-in form now pass.
- **The prefix is read at runtime** from `document.baseURI`, not compiled in.
  A build-time base would mean one package per mount point, which is the
  opposite of what packaging is for.

What makes the runtime answer exact rather than a guess is that there is **no
client-side router**: tabs are React state, not history entries, so the
document URL is always the mount point. If routing is ever added, the
document can be at `/memries/albums` and the directory-of-the-URL rule stops
holding; the fix then is a `<base>` element, and this is the ADR that should
say so.

Without the trailing slash the browser resolves relative URLs against the
parent, so the snippet redirects `/memries` to `/memries/` rather than
letting the app guess. The asset block is a regular-expression location that
captures the rest of the path, because `alias` with no capture 404s every
hashed file — which it duly did on the first attempt.

### The session key is generated on the machine

A package cannot ship one: every install would share it, and anyone with the
`.deb` could forge a session on any of them. `postinst` generates 32 bytes
from `/dev/urandom` **only while the placeholder is still in place**, so
reinstalling or upgrading never signs everybody out.

The replacement is done with `awk`, not `sed`: base64 contains `/` and `+`,
which `sed` would read as syntax.

### `useradd`, not `adduser`

The first install failed with exit 127. `adduser` stopped being essential in
Debian and is absent from a minimal trixie; `useradd` comes from `passwd`,
which is required and always present. Depending on `adduser` would have
worked, but depending on nothing is better than depending on something for
one line.

The account is a system user with `nologin` and no home of its own, because
the library and the cache are named in the config and may live anywhere.

### The config is `root:memries 0640`, and that changed the server

Group-readable is how a service account reads a file it does not own. The
startup check flagged any access beyond the owner, so a **correctly
installed** system warned about its own config on every start. The check now
looks at world access only. Packaging found that; nothing else would have.

### Purge takes what can be rebuilt, and nothing else

`postrm purge` removes `/var/lib/memries` (the catalog) and
`/var/cache/memries` (thumbnails), because a scan rebuilds both from the
photos. It never touches `library.roots`. Those are the photos themselves,
they were there before the package, and a package manager has no business
deleting them.

### The hardening in the unit stops at the disk the photos are on

`ProtectSystem=strict` with `StateDirectory` and `CacheDirectory` is the right
default, but a photo library is usually on a disk of its own — on the Pi, a
card at `/media/sdhc`. `ReadWritePaths=/media` is in the shipped unit so the
common case works, and `systemctl edit memries` is the documented way to name
somewhere else. A sandbox the admin must defeat on day one teaches them to
turn sandboxing off.

### Built by `dpkg-deb`, in a container when there is none

`apps/scripts/build-deb/` stages the tree and runs
`dpkg-deb --build --root-owner-group`, which makes every file root-owned
without the build running as root. On a Mac there is no `dpkg-deb`, so it
runs the same command inside `debian:trixie` — the same shape as the binaries
themselves ([0025](0025-heic-and-the-cgo-build.md)).

It packages what is already built rather than building it, and refuses with
the command that makes each missing piece. `make build-deb` runs the frontend
build first: a stale `dist/` ships a months-old interface beside a new server
with nothing to say so, which is exactly what happened on the first attempt.

## Consequences

- **The box needs a web server.** That is the point, but it is a second thing
  to configure, where an embedded SPA would have been none.
- **`embed.FS` is not happening**, and W3 loses that item.
- **`public_url` is the browser's origin**, not the service's port — behind a
  proxy on port 80 it has no port in it. It is still the CORS allow-list and
  still decides whether the cookie is marked `Secure`, so it must say
  `https://` once there is TLS.
- **Upgrades keep the config**: it is a conffile, so dpkg prompts rather than
  overwriting, and the generated session key survives.
- The package is architecture-specific because the binaries are. `--arch`
  builds `amd64` from the same tree, given binaries for it.

## Verification

`build-deb.test.mjs` pins the installed layout, that every packaged source
exists, that the unit's `ExecStart` and the nginx config's `root` and
`proxy_pass` agree with where the package puts things and with the `addr` in
the shipped config, that the control file declares libvips and ffmpeg, and
that purge never reads `library.roots`.

The package itself was built and installed in a `debian:trixie` container:
apt resolved libvips and ffmpeg, `ldd` showed `libvips.so.42` resolving,
`postinst` created the account and generated a 32-byte key, the config landed
`root:memries 0640`, and the service started as `memries` and answered
`200` on `/healthz` and `401` on `/api/me`.
