# Architecture

The decisions that shaped this codebase, and why each was made. Where a decision
has a real cost, that cost is stated.

---

## The constraint everything follows from

**There are no sizes.** A customer supplies their own measurements, and those
numbers are cut into fabric. That single fact drives:

- a per-garment **template system** with plausible ranges and cross-field checks,
  because a typo becomes wasted cloth rather than a wrong-size exchange;
- **frozen measurement snapshots** on `OrderItem`, so editing a saved profile can
  never alter a garment already in production;
- a **returns policy** that offers alteration rather than resale, because a
  made-to-measure piece cannot go back on the shelf;
- **cart lines keyed by measurement content**, since the same abaya in two sets
  of measurements is two different garments, not a quantity of two.

---

## Two services, one repository

```
shared/    Pure domain logic and the API contract. No I/O of any kind.
backend/   The Express API. Owns the database, the schema and every secret.
frontend/  The Next.js storefront and admin. Renders; never queries.
```

The storefront renders and the API decides. The boundary is enforced by the
module graph rather than by discipline: nothing in `frontend/` can import a
module that reaches Postgres, because those modules are not in its dependency
tree. The API can be scaled and deployed on its own, and it can serve a second
client later without going through Next.

The costs, stated plainly:

- **A network hop.** Server components call the API over HTTP instead of
  querying directly. On the same host that is a millisecond or two; across
  regions it would not be, which is why they must be deployed close together.
- **Two deploy targets**, and a version skew window between them.
- **A contract that can drift.** `shared/src/api-types.ts` describes the JSON
  the API returns, but the API builds its responses from Prisma rows rather than
  from those interfaces, so TypeScript alone does not prove they match. What
  keeps them honest is the API's HTTP tests and an end-to-end suite that drives
  both services together.

They share one repository and one lockfile, so a change that spans them is one
commit and one CI run.

---

## Layering

```
shared/src/            Pure domain logic. No database, no network, no clock.
backend/src/services/  I/O: Prisma, transactions, jobs, email, PDF.
backend/src/routes/    HTTP endpoints.
frontend/src/app/      Routes and pages.
frontend/src/components/  UI.
```

`shared/**` takes everything it needs as arguments — including `now`, so
time-window behaviour is testable without freezing global time. Pricing, coupon
eligibility, measurement validation, shipping-zone resolution and the order
state machine all live here.

The payoff is that the browser and the API compute identical totals from
identical inputs, and 239 unit tests exercise the money-critical logic without a
database.

---

## Data model

Full schema in `backend/prisma/schema.prisma`. The parts worth explaining:

### Money is always an integer

Every amount is minor units (paisa). `0.1 + 0.2 !== 0.3`, and a store that
drifts by a paisa per line eventually fails reconciliation.

`allocate()` in `shared/src/money.ts` splits an order-level discount across lines
so the shares sum to the input exactly — the remainder is distributed one paisa
at a time rather than left to rounding.

### Snapshots over references

`OrderItem` copies the product name, variant name, SKU, image, unit price and
measurements at purchase time. The catalogue can be edited, re-priced or
archived, and a year-old invoice still renders identically.

`Order.shippingSnapshot` does the same for the address, because a customer may
delete the address they used.

### Soft delete on catalogue, never on orders

Products and categories carry `archivedAt` so historical orders keep resolving.
Orders are never deleted before their retention period; see
`docs/DATA_RETENTION.md`.

### Append-only ledgers

`InventoryLedger` explains every change to `stockOnHand`. `AuditLog` records
every privileged mutation, storing only the fields that changed rather than two
full snapshots — a diff is what an investigator actually wants, and it keeps the
log readable.

---

## Request flow: placing an order

The browser posts to `/api/checkout` on the storefront's own origin; Next
rewrites that to the API, which keeps the session and cart cookies first-party.

```
POST /api/checkout                      (storefront origin → API)
  ├─ origin guard (cross-site POSTs refused)
  ├─ rate limit (checkout policy — card testing looks like this)
  ├─ validate against the shared Zod schema
  ├─ load the cart from the httpOnly cookie or session
  ├─ re-check line availability          ← clear error rather than a tx failure
  └─ placeOrder() ─ ONE TRANSACTION ─────────────────────────────
       ├─ reserve stock (conditional updateMany; predicate is the lock)
       ├─ write the inventory ledger
       ├─ debit loyalty points
       ├─ create the order + items (with frozen measurements)
       ├─ increment coupon usage
       ├─ mark the cart converted
       └─ enqueue email / SMS / invoice jobs
```

Everything inside the transaction succeeds or none of it does. Half a placed
order — stock decremented with no order row, or an order whose items were never
written — always needs a human to unpick.

**Prices are recomputed server-side.** The browser says what it wants to buy;
the server decides what it costs. `quoteOrder()` is shared between the live
checkout quote and order placement, so the total shown is computed by the same
code that charges.

**Stock reservation is a conditional update**, not read-then-write:

```ts
updateMany({
  where: { id, stockOnHand: { gte: quantity } },
  data: { stockOnHand: { decrement: quantity } },
});
```

Matching zero rows means someone else won the race, and the loser gets a clean
`OutOfStockError`. Two shoppers cannot both buy the last piece.

**Order numbers are derived from a count inside the transaction**, so numbering
restarts cleanly each year. The unique constraint is the real guarantee: two
concurrent checkouts can compute the same number, and the loser is retried.

---

## Rendering strategy

Every storefront page is rendered per request, because the shell around it shows
the visitor's own bag.

| Route                | Strategy        | Why                                            |
| -------------------- | --------------- | ---------------------------------------------- |
| `/`                  | Dynamic         | Per-visitor bag; content cached in the API     |
| `/products`          | Dynamic         | Filter permutations are effectively unbounded  |
| `/products/[slug]`   | `force-dynamic` | Shows the visitor's saved measurement profiles |
| `/cart`, `/checkout` | Dynamic         | Inherently per-visitor                         |
| `/admin/**`          | `force-dynamic` | Must never be cached across staff              |

The work that used to justify caching pages now happens in the API, which caches
the category tree, homepage content and shipping rules in Redis and marks its
public catalogue responses cacheable at the CDN.

`/products/[slug]` says `force-dynamic` explicitly. It was once configured for
ISR, but that never cached anything — the page reads per-visitor data, so Next
15 rendered it dynamically anyway. Next 16 stopped papering over the
contradiction, and whether the route came out static or dynamic then depended on
whether the _build_ could reach a populated catalogue. A build against an empty
one left the route marked static, and every product page failed at request time
with `DYNAMIC_SERVER_USAGE` — a 500 in production from a build-time condition.

### The Suspense boundary that mattered

`loading.tsx` lives in `products/(list)/`, not `products/`, and that placement is
load-bearing.

A `loading.tsx` at the segment root wraps the whole subtree — including
`products/[slug]` — in one Suspense boundary. The product page suspends on its
data, so Next begins streaming and flushes **200** response headers before the
page reaches `notFound()`. Every dead product URL then answered 200 with 404
content: a soft 404, which search engines index as a real page.

A route group moves the boundary without changing the URL, so the listing still
streams a skeleton and the detail page still returns a true 404.

This was found by an end-to-end test asserting the **status code**, not the body.
A test checking for "not found" text would have passed.

---

## Authorisation

Two layers, and the redundancy is deliberate. Full detail in `docs/SECURITY.md`.

The short version: the API issues a signed session token in an httpOnly cookie.
`frontend/src/proxy.ts` verifies it for a fast redirect, using the role claim,
which reflects the user's role _as of sign-in_. The API's guards in
`backend/src/auth/current-user.ts` decide, by re-reading the live row. Delete the
proxy and the store is still secure, only less pleasant — a matcher bug must not
become a privilege escalation.

The proxy deliberately does not run on `/api`: those requests are the API's to
authorise, and it does so on every one.

---

## Background work

A **transactional outbox**, not an in-memory queue.

Enqueueing to Redis is not part of the database transaction, so a crash between
"order committed" and "email queued" loses the confirmation — or worse, a
rolled-back order still sends one.

Jobs are rows, written in the same transaction as the business change and
drained by the API's `/api/cron/jobs`. Workers claim batches with `FOR UPDATE
SKIP LOCKED`, which is why `claimJobs` is raw SQL: it lets concurrent cron
invocations pull disjoint batches without blocking, which a read-then-update in
Prisma cannot express.

Delivery is at-least-once. **Every handler must be idempotent.**

---

## Caching

| Layer                     | Holds                             | TTL       |
| ------------------------- | --------------------------------- | --------- |
| Redis (read-through, API) | Category tree, homepage, rules    | 10–30 min |
| CDN (public API GETs)     | Product listing, homepage content | 1–10 min  |
| Browser                   | Static assets                     | Long      |

Cache failures are never fatal: `cached()` logs and falls through to the origin.
A slow store beats a broken one.

Redis is optional. Without it the API falls back to a bounded in-memory map,
which is correct on one instance and explicitly not safe across several — the
effective rate limit becomes `limit × instances`. It warns loudly at boot in
production.

---

## Trade-offs made knowingly

**Stateless sessions rather than database sessions.** Verifying a signed token
costs no query, and every storefront request checks one. The cost is that a
session cannot be revoked before it expires, which is precisely why privileged
paths re-read the user row. Tokens last a week and slide: one more than a day old
is reissued, so a regular customer is never signed out mid-visit.

**Postgres `contains` search rather than a search service.** Adequate for a few
hundred products, and it removes an entire piece of infrastructure. It will need
`tsvector` + a GIN index before it becomes slow.

**Invoices generated on demand, not stored.** No object storage to secure,
expire or back up, and an invoice always matches the current order. Costs CPU
per download, which is fine at this volume.

**Content-based recommendations rather than collaborative filtering.** With this
catalogue size there is not enough co-purchase data for behavioural
recommendations to beat "same category, similar price, well reviewed".

**Optimistic cart updates.** The quantity changes immediately and rolls back if
the server rejects it. Waiting a round-trip to redraw a number the user just
clicked feels broken, and the failure case is rare and recoverable.
