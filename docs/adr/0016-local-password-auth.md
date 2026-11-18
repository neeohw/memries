# ADR 0016 — Local password auth replaces Dex and OIDC

- Status: accepted
- Date: 2026-11-17
- Supersedes: the OIDC parts of [0003](0003-modular-monolith-compose.md)
- Related: [0013](0013-admin-managed-sources.md), [0014](0014-pluggable-sql-store.md), [0015](0015-build-tagged-thumbnail-backend.md)

## Context

Memries authenticated through Dex, an OIDC provider running as its own
container. What that bought, in practice, was one static password in
`deploy/dex/config.yaml`.

What it cost:

- A second long-lived container on a board with 2GB of RAM, for an application
  whose own resident set is under 250MiB while indexing.
- An issuer-URL problem. The browser and the backend had to agree on what
  `http://localhost:5556` meant, which they do not when one is a container and
  the other is the host. The workaround was `extra_hosts: localhost:host-gateway`
  on the backend plus publishing Dex on a host port instead of putting it behind
  Caddy, in both the dev and the e2e stacks.
- A dependency tree: `coreos/go-oidc`, `golang.org/x/oauth2`, and the discovery
  round trip they make at boot, which turns the identity provider into a
  start-up ordering constraint for the API.
- Five `MEMRIES_OIDC_*` settings and a client secret that had to be kept in
  step across two Compose files, a generated e2e config, and a template.

None of this is wrong for a multi-tenant service with federated identity. It is
the wrong shape for a single-household photo library whose entire user list is
`MEMRIES_ADMIN_EMAILS`. This is the same judgement as ADR 0014, where a graph
database was serving a workload with no traversals.

## Decision

Authenticate against a password hash in the catalog's `users` table. There is
no identity provider and no redirect flow.

### Hashing

argon2id, with `m=19MiB, t=2, p=1`:

| | |
| --- | --- |
| Measured cost | 23.8ms and 19.9MB on an M1 Pro |
| Extrapolated on the board | ~240ms per verification on a Cortex-A53 |

OWASP's often-quoted 64MiB profile would be both slow on this CPU and a larger
amplifier for an unauthenticated request. 19MiB keeps an interactive sign-in
under about a quarter of a second on the target hardware while staying far out
of reach of GPU cracking.

Hashes are stored in PHC form, so the parameters travel with the hash and can
be raised later without invalidating existing passwords:

```
$argon2id$v=19$m=19456,t=2,p=1$<salt>$<digest>
```

`VerifyPassword` reads those parameters rather than assuming the current
defaults, and a test pins that a hash carrying older ones still verifies.
Only `argon2id` is accepted: treating some other algorithm as valid would be
worse than refusing the sign-in. Comparison is `subtle.ConstantTimeCompare`.

### Endpoints

`POST /auth/login` and `POST /auth/logout`, deliberately outside `/api`, which
the session middleware guards — you cannot be required to present a session in
order to get one. The cookie itself is unchanged: still `memries`, still
gorilla sessions over the existing `MEMRIES_SESSION_KEY`, so ADR 0013's
per-owner ACL and every existing handler are untouched.

`Secure` is set on the cookie only when `MEMRIES_PUBLIC_URL` is https. Setting
it unconditionally would make the cookie unusable on the plain-http LAN install
this is mostly deployed as.

The login form posts field names `login` and `password`, and the handler accepts
either JSON or a form body. That keeps a no-JavaScript submit working, and it is
the contract `apps/e2e/steps/fixtures.ts` already drives — the suite's `signIn`
needed no change at all, because what it used to fill was Dex's form with the
same field names.

### Telling nothing to an attacker

Three failures are deliberately indistinguishable: wrong password, unknown
address, and an account whose `password_hash` is still empty. All three answer
`401` with the identical body, and all three spend the same time, because the
first two call `BurnPassword` to run the hash anyway. Otherwise the form is an
oracle for which addresses are registered.

`TestLoginFailuresAreIndistinguishable` compares the response bodies of all
three paths against each other rather than against a fixed string, so it fails
if any one of them starts to explain itself. It was verified to fail when the
handler appends the underlying reason.

A stored hash that will not parse is logged at error level, because it is an
operator problem, but the client still only learns that sign-in failed.

### Rate limiting

Token buckets, eight attempts of burst refilling one per 30 seconds, keyed two
ways:

- **By client address**, which slows credential stuffing from one host.
- **By account**, which slows a distributed guess at one known address, and
  which is the backstop for the fact that chi's `RealIP` middleware takes
  `X-Forwarded-For` at face value. That is correct behind Caddy and forgeable
  if the process is ever exposed directly.

Either limit alone leaves the other attack untouched. A successful sign-in
clears both buckets, so a few genuine typos do not leave someone locked out.

The limiter is also a resource guard, not only an anti-guessing measure: at
19MiB a verification, unthrottled attempts are a memory amplifier against a 2GB
board. For the same reason a counting semaphore caps concurrent verifications
at two, the request body is capped at 4KiB, and a password over 1KiB is
rejected before it reaches the hash.

### Bootstrap

`MEMRIES_BOOTSTRAP_PASSWORD` gives every `MEMRIES_ADMIN_EMAILS` account a
password at start-up, so a fresh install can be signed into.

It only ever fills an *empty* password. The variable normally stays set in a
Compose file or unit file, and re-applying it on every restart would silently
undo a password change. Setting it with no admin addresses configured is a
start-up error rather than a silent no-op, because the alternative is an
install that looks healthy and that nobody can sign into.

The password is never logged; only the fact that one was applied, with the
address.

## Consequences

- **Dex is gone**, with it: the service in both Compose files, `deploy/dex/`,
  `apps/e2e/deploy/dex.yaml` and its generator in `stack.mjs`, the published
  host port, the `DEX_HOST_PORT` plumbing through the fan-out scripts, the
  `extra_hosts: localhost:host-gateway` hack, the backend's `depends_on`, five
  `MEMRIES_OIDC_*` settings, `OIDC_CLIENT_SECRET`, and the `go-oidc` and
  `oauth2` modules. `/oauth/*` becomes `/auth/*` in both Caddyfiles and the
  Vite dev proxy.
- **The API no longer waits on an identity provider to boot.** `auth.New` does
  no network I/O, so it lost its `context.Context` parameter.
- **Sign-in is a screen, not a redirect.** `apiFetch` used to send a 401 to
  `window.location.assign('/oauth/login')`; it now throws `UnauthorizedError`,
  and `App` renders `LoginScreen` when `/api/me` reports 401. The library and
  all of its queries are mounted only once there is a session, so nothing fires
  a request that is bound to fail. A non-401 failure gets a "could not reach
  the server" retry instead, so a backend that is merely down does not look
  like a password problem.
- **There is no self-registration and no password-change UI.** Accounts come
  from `MEMRIES_ADMIN_EMAILS` plus bootstrap; the OIDC callback used to create
  a user on first sign-in and nothing does now. For a single-household library
  that is the whole user list, but a change-password endpoint is the obvious
  next thing this ADR does not cover, and until it exists a password is rotated
  by clearing `password_hash` and restarting with the variable set.
- **`User.PasswordHash` is `json:"-"`.** No handler returns a user object
  today, but a hash must not become a response field by accident later, and a
  test asserts the login response carries no password material.
- `UpsertUserByEmail` deliberately does not touch `password_hash`, so the
  Sources migration path cannot reset someone's password as a side effect.
