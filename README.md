# MomiShop

Made-to-measure modest fashion e-commerce. Women's, girls' and boys' clothing,
abayas and stoles — every stitched garment cut to the customer's own
measurements rather than to a size chart.

Two services in one repository: an **Express API** (TypeScript, Prisma,
PostgreSQL) and a **Next.js 16 storefront** (App Router), with the domain logic
they share in a third workspace.

---

## What makes this different from a generic store

There are no sizes. A customer enters their own measurements, those numbers are
validated against a per-garment template, and they are **frozen onto the order
line** at purchase. Editing a saved profile afterwards can never change a
garment already being cut. That single constraint shapes the schema, the
checkout transaction, the invoice and the returns policy.

The measurement system lives in
[`shared/src/measurements.ts`](shared/src/measurements.ts): five garment
templates, per-field plausible ranges, plain-language instructions,
inch/centimetre conversion, and cross-field checks that catch the transpositions
a per-field range cannot — a sleeve longer than the shirt it attaches to, a
sleeve opening wider than its armhole. It is shared, so the browser and the API
apply exactly the same rules.

---

## Quick start

```bash
# 1. Dependencies (npm workspaces: one install covers all three)
npm install

# 2. Environment — copy and fill in. Only DATABASE_URL and AUTH_SECRET are
#    required to boot; every integration degrades gracefully without its key.
#    Both services read this one file.
cp .env.example .env

# 3. Database (Docker). Postgres is required; Redis is optional.
docker compose up -d postgres

# 4. Schema and sample data
npm run db:migrate
npm run db:seed

# 5. Run both services
npm run dev
```

The storefront is on <http://localhost:3000> and the API on
<http://localhost:4000>. Open the storefront: it proxies `/api/*` to the API, so
that is the only address you need.

Seeded accounts:

| Role     | Email                | Password         |
| -------- | -------------------- | ---------------- |
| Owner    | `admin@momishop.pk`  | `ChangeMe!2024`  |
| Staff    | `staff@momishop.pk`  | `StaffPass!2024` |
| Customer | `ayesha@example.com` | `Customer!2024`  |

Generate a real `AUTH_SECRET` with `openssl rand -base64 32`. It belongs to the
API alone — the storefront holds no secrets.

---

## Scripts

Run from the repository root. Anything workspace-specific also works with
`-w @momishop/backend` (or `frontend`, `shared`).

| Command                 | What it does                                      |
| ----------------------- | ------------------------------------------------- |
| `npm run dev`           | API and storefront together, output prefixed      |
| `npm run dev:api`       | API only                                          |
| `npm run dev:web`       | Storefront only                                   |
| `npm run build`         | Build both services                               |
| `npm run typecheck`     | `tsc --noEmit` in every workspace                 |
| `npm run lint`          | ESLint (flat config, whole repository)            |
| `npm run format`        | Prettier write                                    |
| `npm test`              | Unit tests in every workspace                     |
| `npm run test:coverage` | Tests with per-workspace coverage thresholds      |
| `npm run test:e2e`      | Playwright — starts both services and drives them |
| `npm run db:migrate`    | Create and apply a migration                      |
| `npm run db:deploy`     | Apply pending migrations (CI/production)          |
| `npm run db:seed`       | Idempotent seed                                   |
| `npm run db:studio`     | Prisma Studio                                     |

---

## Architecture

```
shared/          @momishop/shared — pure domain logic and the API contract
  src/           money, pricing, coupons, shipping, measurements, validation,
                 RBAC, the order state machine, api-types, session-contract

backend/         @momishop/backend — the Express API
  src/
    routes/      HTTP endpoints, one file per area
    services/    Catalogue, cart, checkout, jobs, email, SMS, invoices
    auth/        Sessions, password and Google sign-in, live-row guards
    http/        Error mapping, validation, rate limiting, CSRF guard
    lib/         Prisma client, Redis, cache, logger, crypto, env
  prisma/        Schema, migrations, seed

frontend/        @momishop/frontend — the Next.js storefront and admin
  src/
    app/         Routes and pages
    components/  UI, measurement form, product, cart, checkout, admin
    lib/         The API client, `cn`, public env
    proxy.ts     Session-aware redirects
  tests/e2e/     Playwright — critical path + axe audit
```

### Why two services

The storefront renders and the API decides. Splitting them means the browser
bundle cannot import a module that reaches the database, the API can be scaled
or deployed on its own, and the same API serves anything else later — a mobile
app, a partner integration — without going through Next.

The cost is a network hop and two deploy targets. It is paid back by the
boundary being enforced by the module graph rather than by discipline.

### Layering rule

`shared/**` is pure: no database, no network, no clock. Pricing, coupon
eligibility, measurement validation, shipping-zone resolution and the order
state machine all take their inputs as arguments. That is what makes them
exhaustively testable, and it is why the checkout endpoint and the browser
compute identical totals from identical inputs.

`backend/src/services/**` owns I/O — Prisma, transactions, email, PDF, jobs.
`frontend/**` owns rendering, and reaches data only through the API.

### How the storefront talks to the API

Server components call the API directly through
[`frontend/src/lib/api.ts`](frontend/src/lib/api.ts), forwarding the visitor's
cookies and address so the API sees the request as it would from the browser.

The browser calls `/api/*` on the storefront's own origin, which Next rewrites
to the API. Session and cart cookies therefore stay first-party, `SameSite=Lax`
protects them without exceptions, and no CORS is involved.

### Money

Every amount is an **integer in minor units** (paisa). Floating point is never
used for money. [`shared/src/money.ts`](shared/src/money.ts) has the arithmetic,
including `allocate()`, which apportions a discount across lines without losing
or inventing a paisa.

### Two-layer authorisation

The API issues a session as a signed JWT in an httpOnly cookie.
`frontend/src/proxy.ts` verifies it for a fast redirect; the API's
`requireStaff()` / `requirePermission()` **decide**, by re-reading the live user
row.

The distinction matters: a JWT carries the role as of sign-in, so a staff member
demoted five minutes ago still presents an `ADMIN` token. Deleting the proxy
would leave the store secure, only less pleasant to use. That redundancy is
deliberate — a matcher bug should not become a privilege escalation.

### Background work

A transactional outbox, not an in-memory queue. Jobs are rows written in the
**same transaction** as the business change, drained by the API's
`/api/cron/jobs`. A crash between "order committed" and "email queued" is
therefore impossible, and a rolled-back order cannot send a confirmation.
Workers claim batches with `FOR UPDATE SKIP LOCKED`, so overlapping cron runs
never double-send.

Delivery is at-least-once, so **every handler must be idempotent**.

---

## Notes worth reading before you change things

**`products/(list)/loading.tsx` placement is load-bearing.** A `loading.tsx` at
`products/` would wrap `products/[slug]` in the same Suspense boundary. The
product page suspends on its data, so Next flushes 200 response headers before
reaching `notFound()` — and every dead product URL answers 200 with 404 content.
That is a soft 404, which search engines index as a real page. The route group
scopes the boundary to the listing without changing the URL. This was caught by
an end-to-end test asserting the status code, not the body.

**Cart lines are compared by measurement _content_, not key order.** Postgres
`jsonb` does not preserve insertion order, so `JSON.stringify` comparison made
"add the same abaya twice" create two lines instead of incrementing one. See
[`shared/src/canonical-json.ts`](shared/src/canonical-json.ts).

**Order items snapshot everything.** Product name, price, image and measurements
are copied onto `OrderItem` at purchase. The catalogue can be edited or archived
and a year-old invoice still renders identically.

**A new cart always gets a fresh token.** Reusing the cookie's token after
checkout collides with the converted cart's unique token, which is what stopped
a guest starting a second bag.

---

## Testing

```bash
npm test                 # domain logic, API, storefront
npm run test:e2e         # critical path + accessibility, against both services
```

Unit tests cover the logic that is expensive to get wrong: money arithmetic,
pricing and discount apportionment, coupon eligibility, measurement validation,
shipping-zone resolution and the order state machine. The API's tests drive the
real Express app through supertest with the database mocked, so they need no
Postgres.

End-to-end tests run against real builds of both services and a seeded database.
They assert **status codes and accessible names**, not CSS classes — a test that
breaks when a class is renamed is noise, one that breaks when a button loses its
accessible name has found a real regression.

`frontend/tests/e2e/accessibility.spec.ts` runs axe-core against every key page.
axe catches roughly a third of WCAG issues, so it is a floor rather than a
certificate; the keyboard tests alongside it cover things axe structurally
cannot.

---

## Deployment

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the full runbook, including
the expand/contract migration rule, rollback, and the backup/restore procedure.

Short version: migrations run **before** the new code goes live, which is only
safe because every migration is backward-compatible with the previous release.
The API and the storefront deploy separately, and the storefront needs
`API_URL` pointing at the API.

---

## Documentation

| Document                                           | Covers                                         |
| -------------------------------------------------- | ---------------------------------------------- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)     | Data model, request flow, design decisions     |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)         | Environments, migrations, rollback, backups    |
| [`docs/SECURITY.md`](docs/SECURITY.md)             | Threat model and every control, with rationale |
| [`docs/ACCESSIBILITY.md`](docs/ACCESSIBILITY.md)   | WCAG AA commitments and how they are tested    |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md)         | Monitoring, jobs, load testing, runbooks       |
| [`docs/DATA_RETENTION.md`](docs/DATA_RETENTION.md) | Retention policy and GDPR-style requests       |

---

## Status

The customer journey is complete and verified end to end against PostgreSQL:
browse → measure → cart → checkout → order confirmation, with stock
reservation, coupons, tax, shipping zones and job dispatch all inside one
transaction.

What is scaffolded but not finished is listed honestly in
[`docs/ROADMAP.md`](docs/ROADMAP.md) — chiefly the payment-gateway adapters
(Stripe/JazzCash/Easypaisa), which currently have COD as the working path.
