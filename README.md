# MomiShop

Made-to-measure modest fashion e-commerce. Women's, girls' and boys' clothing,
abayas and stoles — every stitched garment cut to the customer's own
measurements rather than to a size chart.

Built with Next.js 15 (App Router), TypeScript, Prisma and PostgreSQL.

---

## What makes this different from a generic store

There are no sizes. A customer enters their own measurements, those numbers are
validated against a per-garment template, and they are **frozen onto the order
line** at purchase. Editing a saved profile afterwards can never change a
garment already being cut. That single constraint shapes the schema, the
checkout transaction, the invoice and the returns policy.

The measurement system lives in [`src/lib/measurements.ts`](src/lib/measurements.ts):
five garment templates, per-field plausible ranges, plain-language instructions,
inch/centimetre conversion, and cross-field checks that catch the transpositions
a per-field range cannot — a sleeve longer than the shirt it attaches to, a
sleeve opening wider than its armhole.

---

## Quick start

```bash
# 1. Dependencies
npm install

# 2. Environment — copy and fill in. Only DATABASE_URL and AUTH_SECRET are
#    required to boot; every integration degrades gracefully without its key.
cp .env.example .env

# 3. Database (Docker). Postgres is required; Redis is optional.
docker compose up -d postgres

# 4. Schema and sample data
npx prisma migrate dev
npm run db:seed

# 5. Run
npm run dev
```

Then open <http://localhost:3000>.

Seeded accounts:

| Role     | Email                | Password         |
| -------- | -------------------- | ---------------- |
| Owner    | `admin@momishop.pk`  | `ChangeMe!2024`  |
| Staff    | `staff@momishop.pk`  | `StaffPass!2024` |
| Customer | `ayesha@example.com` | `Customer!2024`  |

Generate a real `AUTH_SECRET` with `openssl rand -base64 32`.

---

## Scripts

| Command                 | What it does                                    |
| ----------------------- | ----------------------------------------------- |
| `npm run dev`           | Development server                              |
| `npm run build`         | Generate the Prisma client, then build          |
| `npm run typecheck`     | `tsc --noEmit`                                  |
| `npm run lint`          | ESLint (flat config)                            |
| `npm run format`        | Prettier write                                  |
| `npm test`              | Unit and integration tests (Vitest)             |
| `npm run test:coverage` | Tests with coverage thresholds                  |
| `npm run test:e2e`      | End-to-end and accessibility tests (Playwright) |
| `npm run db:migrate`    | Create and apply a migration                    |
| `npm run db:deploy`     | Apply pending migrations (CI/production)        |
| `npm run db:seed`       | Idempotent seed                                 |
| `npm run db:studio`     | Prisma Studio                                   |

---

## Architecture

```
src/
  app/
    (storefront)/      Customer-facing pages
      products/
        (list)/        Listing + its loading skeleton  ← route group, see note
        [slug]/        Product detail (ISR)
    (auth)/            Sign-in and registration
    admin/             Staff dashboard
    api/               Route handlers
  components/
    ui/                Primitives (button, input, dialog, …)
    measurements/      The measurement form and its SVG guide
    product/ cart/ checkout/ admin/ layout/
  lib/                 Pure, testable domain logic — no I/O
  server/              Data access, transactions, jobs, email, PDF
prisma/                Schema, migrations, seed
tests/
  unit/                Vitest — domain logic
  e2e/                 Playwright — critical path + axe audit
```

### Layering rule

`src/lib/**` is pure: no database, no network, no clock. Pricing, coupon
eligibility, measurement validation, shipping-zone resolution and the order
state machine all take their inputs as arguments. That is what makes them
exhaustively testable, and it means the checkout API and the admin's
manual-order screen compute identical totals from identical inputs.

`src/server/**` owns I/O — Prisma, transactions, email, PDF, jobs.

### Money

Every amount is an **integer in minor units** (paisa). Floating point is never
used for money. `src/lib/money.ts` has the arithmetic, including `allocate()`,
which apportions a discount across lines without losing or inventing a paisa.

### Two-layer authorisation

`src/proxy.ts` gives a fast redirect from the session JWT.
`src/server/session.ts` **decides**, by re-reading the live user row.

The distinction matters: a JWT carries the role as of sign-in, so a staff member
demoted five minutes ago still presents an `ADMIN` token. Deleting the proxy
would leave the app secure, only less pleasant to use. That
redundancy is deliberate — a matcher bug should not become a privilege
escalation.

### Background work

A transactional outbox, not an in-memory queue. Jobs are rows written in the
**same transaction** as the business change, drained by `/api/cron/jobs`. A
crash between "order committed" and "email queued" is therefore impossible, and
a rolled-back order cannot send a confirmation. Workers claim batches with
`FOR UPDATE SKIP LOCKED`, so overlapping cron runs never double-send.

Delivery is at-least-once, so **every handler must be idempotent**.

---

## Notes worth reading before you change things

**`products/(list)/loading.tsx` placement is load-bearing.** A `loading.tsx` at
`products/` would wrap `products/[slug]` in the same Suspense boundary. The
product page suspends on its database query, so Next flushes 200 response
headers before reaching `notFound()` — and every dead product URL answers 200
with 404 content. That is a soft 404, which search engines index as a real page.
The route group scopes the boundary to the listing without changing the URL.
This was caught by an end-to-end test asserting the status code, not the body.

**Cart lines are compared by measurement _content_, not key order.** Postgres
`jsonb` does not preserve insertion order, so `JSON.stringify` comparison made
"add the same abaya twice" create two lines instead of incrementing one. See
`src/lib/canonical-json.ts`.

**Order items snapshot everything.** Product name, price, image and measurements
are copied onto `OrderItem` at purchase. The catalogue can be edited or archived
and a year-old invoice still renders identically.

---

## Testing

```bash
npm test                 # domain logic
npm run test:e2e         # critical path + accessibility
```

Unit tests cover the logic that is expensive to get wrong: money arithmetic,
pricing and discount apportionment, coupon eligibility, measurement validation,
shipping-zone resolution and the order state machine.

End-to-end tests run against a real build and a seeded database. They assert
**status codes and accessible names**, not CSS classes — a test that breaks when
a class is renamed is noise, one that breaks when a button loses its accessible
name has found a real regression.

`tests/e2e/accessibility.spec.ts` runs axe-core against every key page. axe
catches roughly a third of WCAG issues, so it is a floor rather than a
certificate; the keyboard tests alongside it cover things axe structurally
cannot.

---

## Deployment

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the full runbook, including
the expand/contract migration rule, rollback, and the backup/restore procedure.

Short version: migrations run **before** the new code goes live, which is only
safe because every migration is backward-compatible with the previous release.

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
