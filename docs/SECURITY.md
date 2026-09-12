# Security

Every control here exists for a stated reason. Where a control was deliberately
_not_ applied, that is stated too — an undocumented gap is worse than a known
one.

---

## Threat model

A small e-commerce store holding names, addresses, phone numbers, order history
and **body measurements**. That last one deserves emphasis: for a modest-fashion
retailer, both the measurements and the mere fact that someone shops here are
sensitive. Several decisions below follow from that rather than from a generic
checklist.

The realistic threats, in order of likelihood:

1. **Credential stuffing** against customer accounts using leaked password lists.
2. **Card testing** — running stolen card numbers through checkout in bulk.
3. **Account enumeration** — checking a leaked email list against the store to
   learn who shops here.
4. **IDOR** — editing an id in a URL to read someone else's order or measurements.
5. **A compromised or malicious staff account** changing prices or issuing refunds.
6. **Scraping** the catalogue.

Not in scope: a determined attacker with database access, and DDoS (that is the
CDN's job).

---

## The service boundary

The API holds every secret and is the only thing that connects to the database.
The storefront has the public configuration, the address of the API, and the
signing secret it needs to verify a session cookie — nothing else. A bug in a
React component cannot reach Postgres, because Prisma is not in the storefront's
dependency tree at all.

---

## Authentication

**Password hashing** — bcrypt, cost 12 (`backend/src/lib/password.ts`). High
enough to make offline cracking expensive, low enough that a login does not
monopolise a request. Revisit the cost annually.

The strength checker the registration form runs lives separately, in
`shared/src/password-strength.ts`. That split is the fix for a real leak: when
both lived in one module, importing the checker shipped bcrypt to every visitor
of `/register`.

**Account lockout** — 5 failed attempts locks the account for 15 minutes. This
is per-account and complements the per-IP rate limit; together they stop both
"one attacker guessing one password many times" and "many IPs guessing one
account".

**Timing equalisation** — when the submitted email has no account, `fakeVerify()`
runs a bcrypt comparison against a throwaway hash. Without it, an unknown email
returns measurably faster than a wrong password, and the login form becomes an
enumeration oracle.

**One error message** — unknown email, wrong password and locked account all
produce "Those details do not match an account". A suspended account is the
deliberate exception: that person needs to contact support rather than keep
retrying a password that is actually correct.

**Registration does not reveal whether an email is taken.** It returns the same
201 either way and instead emails the real account holder ("someone tried to
register with your email"), keyed by account and date so repeated attempts send
one message per day.

**Sessions** are signed JWTs (HS256, keyed by `AUTH_SECRET`) in an httpOnly
cookie, issued by the API. Verification pins the algorithm, issuer and audience,
so a token declaring `alg: none`, one signed with another key, and one minted for
a different purpose are all rejected. Claims are shape-checked before use.

**Google sign-in** is the authorization-code flow with PKCE, finished by
verifying Google's ID token against its published keys. The browser is bound to
the attempt by a short-lived signed state cookie, so a callback whose `state`
does not match is refused — that is what stops an attacker completing a sign-in
in a victim's browser. An unverified Google email is rejected, a suspended
account is refused here as well as at password sign-in, and an address that
already has a password account is **never** linked automatically: whoever
controls a Google account for that address would otherwise take over the
existing one.

---

## Authorisation

Two layers, and the redundancy is deliberate.

| Layer                              | What it does                                   | Trusted for authorisation |
| ---------------------------------- | ---------------------------------------------- | ------------------------- |
| `frontend/src/proxy.ts`            | Fast redirect, from the cookie's claims        | **No**                    |
| `backend/src/auth/current-user.ts` | Verifies the token, re-reads the live user row | **Yes**                   |

The proxy reads those claims **without checking the signature**, which follows
from it not being trusted: every route behind it gets its data from the API,
which does verify. A forged cookie reaches a page that answers 401 and bounces
the visitor back to sign in.

The alternative — verifying in the proxy — means the storefront and the API
must hold an identical `AUTH_SECRET`, and any drift between them silently signs
every visitor out while looking exactly like "sign-in is broken". That happened
twice while deploying this. The storefront now holds no secret at all.

A JWT carries the user's role _as of sign-in_. Demote a staff member at 09:00
and their week-old token still claims `ADMIN`. So `requireStaff()` and
`requirePermission()` query the database. If the proxy were deleted the store
would still be secure, only less pleasant to use — a matcher bug must not become
a privilege escalation. The proxy does not run on `/api` at all; the API
authorises those requests itself.

**Client-side role checks are for hiding UI only.** The admin nav filters by
permission so staff do not see links they cannot open; every admin endpoint
re-checks server-side.

**Privilege escalation is blocked by rank.** `canAssignRole()` only permits
assigning a role strictly below your own, so an `ADMIN` cannot promote anyone —
including themselves — to `SUPER_ADMIN`.

**IDOR** — `assertOwnershipOrStaff()` guards record access, and it reports
failures as "not found" rather than "forbidden" so probing for valid ids returns
nothing useful. Cart mutations are scoped to the caller's own cart, a saved
measurement profile is only honoured after confirming it belongs to the caller,
and the order confirmation returns an explicit allow-list of fields rather than
the row.

---

## Input validation

Every form and endpoint validates through a **shared Zod schema**
(`shared/src/validation.ts`) imported by both the React form and the API. Because
they are literally the same object they cannot drift — which is how "we validate
on both sides" usually becomes "we validate on neither".

The client copy is for fast feedback. **The server copy decides.** Measurements
submitted to `/api/cart/items` are re-validated against the product's own sizing
template regardless of what the browser said, because anyone can POST there and
a garment cut from unvalidated numbers is wasted fabric.

**Free text is sanitised** (`sanitizeText`) — tags and control characters
stripped. This is defence in depth, not the primary XSS control: React escapes
by default, so the real rule is _never_ call `dangerouslySetInnerHTML` on user
input. The two places that do use it (JSON-LD and breadcrumb structured data)
serialise our own database rows, never user input.

**Email templates escape explicitly.** They build raw HTML strings, so React is
not helping; `escapeHtml()` runs on every interpolated value. A customer whose
name contains a bracket must not be able to inject markup into their own
confirmation email.

**SQL injection** — Prisma parameterises everything. The one raw query
(`claimJobs`) uses tagged-template interpolation, which is parameterised, and
takes no user input.

---

## Rate limiting

Fixed-window, one `INCR` per check (`backend/src/lib/rate-limit.ts`). A fixed
window can allow up to 2× the limit across a boundary; that is an acceptable
trade here, since the goal is stopping abuse rather than metering a paid API.

| Policy         | Limit | Window | Why                                      |
| -------------- | ----- | ------ | ---------------------------------------- |
| `authLogin`    | 5     | 5 min  | Makes password guessing impractical      |
| `authRegister` | 3     | 1 hr   | Slows bulk account creation              |
| `checkout`     | 10    | 10 min | **Card testing** looks exactly like this |
| `search`       | 60    | 1 min  | Cheapest way to enumerate the catalogue  |
| `api`          | 120   | 1 min  | General backstop                         |

Signed-in users are limited by user id rather than IP — limiting by IP punishes
everyone behind the same office or mobile-carrier NAT.

**Client IP is only trustworthy behind a proxy you control.** The API uses
Express's `req.ip`, which honours `trust proxy`, so a forwarded address counts
only when it arrives from a hop configured in `TRUST_PROXY`. Browser traffic
reaches it through the storefront's rewrite, which passes the visitor's address
along, and server-side calls forward it explicitly. Exposing the API directly to
the internet without fixing `TRUST_PROXY` would let a client pick its own
rate-limit bucket.

---

## Payments and PCI scope

**No card data ever reaches this application.** Stripe Elements tokenises in the
browser; the server stores a payment intent id and nothing else.
`PaymentTransaction` holds references and gateway responses, never a PAN. This
keeps the store in SAQ-A scope.

**An order is only marked paid by a verified webhook.** A client-side "payment
succeeded" callback is trivially forged. Gateway callbacks must have their
signature verified — `stripe.webhooks.constructEvent` for Stripe, a constant-time
HMAC comparison for JazzCash and Easypaisa — before anything is trusted.

See `docs/ROADMAP.md`: the gateway adapters are **not yet implemented**, and COD
is the only live payment path.

---

## Secrets

Each service validates its own environment at boot.
`backend/src/lib/env.ts` covers the database, signing, payment, email and SMS
credentials; `frontend/src/lib/env.ts` covers only public configuration. Nothing
outside those modules reads `process.env` for a secret, and only `NEXT_PUBLIC_*`
values are inlined into the browser bundle, so a secret cannot leak into client
code by accident.

In production a missing required secret **fails the boot** rather than serving a
half-configured store.

`AUTH_SECRET` belongs to the API alone. The storefront needs no secret: its only
private setting is `API_URL`, the address it reaches the API on.

**Logs redact.** `backend/src/lib/logger.ts` strips anything matching a known
secret key name at any depth, because logs get exported to third-party tools. The
audit log redacts the same set, plus raw gateway payloads, since it is widely
readable inside the business and gets exported during investigations.

**IPs are hashed before storage** (`hashIp`), salted with `AUTH_SECRET`. We need
them for abuse detection; keeping them in the clear is a liability.

**Cron endpoints fail closed.** A missing `CRON_SECRET` is an error, not
"allow all", and the comparison is constant-time — a plain `===` short-circuits
on the first differing byte and leaks the secret through response timing on a
public URL.

---

## Transport and browser hardening

Set in `frontend/next.config.mjs` and applied to every page response:

- **CSP** with `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`,
  and an explicit allowlist per directive.
  `script-src` still needs `'unsafe-inline'`/`'unsafe-eval'` for Next's runtime;
  moving to a nonce-based policy is the main remaining hardening step.
- **HSTS** — 2 years, `includeSubDomains`, `preload`.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`, and a `Permissions-Policy`
  denying camera, microphone and geolocation.
- `poweredByHeader: false`.

The API sets its own headers with Helmet, marks every response `no-store` unless
a route opts into caching, and does not advertise Express.

**Cookies** — the session cookie is `httpOnly`, `sameSite=lax`, and, wherever the
storefront is served over HTTPS, `secure` with the `__Host-` prefix, which makes
the browser refuse it unless it is host-only, path `/` and delivered over HTTPS —
so no sibling subdomain can plant or overwrite it. The cart cookie is `httpOnly`
too and carries an opaque random token, not a cart id that could be incremented
into someone else's basket.

That choice follows the deployment's scheme (`APP_URL`) rather than `NODE_ENV`,
for two reasons: a `__Host-` cookie sent over plain HTTP is silently dropped by
the browser, and two services each reading their own `NODE_ENV` can disagree
about the name — which is exactly how a production-mode storefront came to
ignore every session its API had issued. Readers accept either name, because the
signature is what decides whether a token is trusted.

**CSRF** — cookies are `SameSite=Lax`, which already keeps them off a cross-site
form POST. The API adds a second check: a state-changing request whose `Origin`
is not one it serves is refused, as is one that hides its origin but declares
`Sec-Fetch-Site: cross-site`. Requests with no `Origin` at all are allowed
through, because browsers always send it on a cross-origin POST — its absence
means the request did not come from another site's page.

Because the browser reaches the API through the storefront's own origin, none of
this depends on CORS, and the cookies stay first-party.

---

## Dependencies

Dependabot runs weekly, grouped so a routine week is one reviewable PR. Major
upgrades of Next, React, Prisma and Tailwind are excluded — those are scheduled
work with migration guides, not a Monday-morning bot merge.

CI fails on `npm audit --audit-level=high`. Moderate and low advisories are
reported but do not block: a transitive moderate in a dev-only tool should not
stop a security fix from shipping.

---

## Deliberate gaps

Stated so they are decisions rather than oversights.

- **No 2FA.** Worth adding for staff accounts before the team grows.
- **No virus scanning on uploads.** Cloudinary validates type and size; content
  scanning would need an external service.
- **Email is not verified before an account can order.** Deliberate — an
  unverified customer can still buy, because blocking checkout on an email
  round-trip costs more sales than it prevents fraud at this scale.
- **Guest order numbers are the only key to a guest confirmation page.** They are
  sequential, so the endpoint is rate limited and the page exposes no payment
  detail. Requiring an email here would strand every guest; the richer tracking
  page does require one.
- **`'unsafe-inline'` in `script-src`.** Required by Next's inlined runtime;
  removing it means adopting nonces.
- **No WAF.** Rate limiting is the only application-level abuse control.

---

## Reporting

Email `security@momishop.pk`. Please do not open a public issue for a
vulnerability.
