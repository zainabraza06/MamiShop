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

## Authentication

**Password hashing** — bcrypt, cost 12 (`src/lib/password.ts`). High enough to
make offline cracking expensive, low enough that a login does not monopolise a
serverless invocation. Revisit the cost annually.

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

**OAuth is re-checked separately.** Google sign-in never reaches `authorize()`,
so the suspended-account check lives in the `signIn` callback too — otherwise a
banned user walks straight back in through Google.

---

## Authorisation

Two layers, and the redundancy is deliberate.

| Layer                   | What it does                           | Trusted for authorisation |
| ----------------------- | -------------------------------------- | ------------------------- |
| `src/middleware.ts`     | Fast redirect based on the session JWT | **No**                    |
| `src/server/session.ts` | Re-reads the live user row and decides | **Yes**                   |

A JWT carries the user's role _as of sign-in_. Demote a staff member at 09:00
and their week-old token still claims `ADMIN`. So `requireStaff()` and
`requirePermission()` query the database. If `middleware.ts` were deleted the
app would still be secure, only less pleasant to use — a matcher bug must not
become a privilege escalation.

**Client-side role checks are for hiding UI only.** The admin nav filters by
permission so staff do not see links they cannot open; every one of those pages
re-checks server-side.

**Privilege escalation is blocked by rank.** `canAssignRole()` only permits
assigning a role strictly below your own, so an `ADMIN` cannot promote anyone —
including themselves — to `SUPER_ADMIN`.

**IDOR** — `assertOwnershipOrStaff()` guards record access, and it reports
failures as "not found" rather than "forbidden" so probing for valid ids returns
nothing useful. Cart mutations are scoped to the caller's own cart, and a saved
measurement profile is only honoured after confirming it belongs to the caller.

---

## Input validation

Every form and endpoint validates through a **shared Zod schema**
(`src/lib/validation.ts`) imported by both the React form and the server
handler. Because they are literally the same object they cannot drift — which is
how "we validate on both sides" usually becomes "we validate on neither".

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

Fixed-window, one `INCR` per check (`src/lib/rate-limit.ts`). A fixed window can
allow up to 2× the limit across a boundary; that is an acceptable trade here,
since the goal is stopping abuse rather than metering a paid API.

| Policy         | Limit | Window | Why                                      |
| -------------- | ----- | ------ | ---------------------------------------- |
| `authLogin`    | 5     | 5 min  | Makes password guessing impractical      |
| `authRegister` | 3     | 1 hr   | Slows bulk account creation              |
| `checkout`     | 10    | 10 min | **Card testing** looks exactly like this |
| `search`       | 60    | 1 min  | Cheapest way to enumerate the catalogue  |
| `api`          | 120   | 1 min  | General backstop                         |

Signed-in users are limited by user id rather than IP — limiting by IP punishes
everyone behind the same office or mobile-carrier NAT.

**Client IP is only trustworthy behind a proxy you control.** On Vercel the edge
overwrites `x-forwarded-for`. On another host, terminate at a proxy that strips
inbound values, or the header is spoofable.

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

`src/lib/env.ts` validates at boot and splits the schema in two. Only
`NEXT_PUBLIC_*` values are inlined into the browser bundle, and because nothing
outside that module reads `process.env` for secrets, a secret cannot leak into
client code by accident. `serverEnv()` throws if called in the browser.

In production a missing required secret **fails the deploy** rather than
serving a half-configured store.

**Logs redact.** `src/lib/logger.ts` strips anything matching a known secret key
name at any depth, because logs get exported to third-party tools. The audit log
redacts the same set, plus raw gateway payloads, since it is widely readable
inside the business and gets exported during investigations.

**IPs are hashed before storage** (`hashIp`), salted with `AUTH_SECRET`. We need
them for abuse detection; keeping them in the clear is a liability.

**Cron endpoints fail closed.** A missing `CRON_SECRET` is an error, not
"allow all", and the comparison is constant-time — a plain `===` short-circuits
on the first differing byte and leaks the secret through response timing on a
public URL.

---

## Transport and browser hardening

Set in `next.config.mjs` and applied to every response:

- **CSP** with `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`,
  and an explicit allowlist per directive.
  `script-src` still needs `'unsafe-inline'`/`'unsafe-eval'` for Next's runtime;
  moving to a nonce-based policy is the main remaining hardening step.
- **HSTS** — 2 years, `includeSubDomains`, `preload`.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`, and a `Permissions-Policy`
  denying camera, microphone and geolocation.
- `poweredByHeader: false`.

**Cookies** — session cookies are `httpOnly`, `sameSite=lax`, and `secure` in
production with the `__Secure-` prefix so the browser rejects them over plain
HTTP. The cart cookie is `httpOnly` too and carries an opaque random token, not
a cart id that could be incremented into someone else's basket.

**CSRF** — Auth.js issues and verifies its own token on every state-changing
auth request. `sameSite=lax` covers the rest; mutations are JSON POSTs with a
`Content-Type` that triggers preflight, which a cross-origin form cannot forge.

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
- **`'unsafe-inline'` in `script-src`.** Required by Next's inlined runtime;
  removing it means adopting nonces.
- **No WAF.** Rate limiting is the only application-level abuse control.

---

## Reporting

Email `security@momishop.pk`. Please do not open a public issue for a
vulnerability.
