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

## Layering

```
src/lib/     Pure domain logic. No database, no network, no clock.
src/server/  I/O: Prisma, transactions, jobs, email, PDF.
src/app/     Routes and pages.
src/components/  UI.
```

`src/lib/**` takes everything it needs as arguments — including `now`, so
time-window behaviour is testable without freezing global time. Pricing, coupon
eligibility, measurement validation, shipping-zone resolution and the order
state machine all live here.

The payoff is that the checkout API and the admin's manual-order screen compute
identical totals from identical inputs, and 146 unit tests can exercise the
money-critical logic without a database.

---

## Data model

Full schema in `prisma/schema.prisma`. The parts worth explaining:

### Money is always an integer

Every amount is minor units (paisa). `0.1 + 0.2 !== 0.3`, and a store that
drifts by a paisa per line eventually fails reconciliation.

`allocate()` in `src/lib/money.ts` splits an order-level discount across lines
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

```
POST /api/checkout
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

---

## Rendering strategy

| Route                | Strategy         | Why                                           |
| -------------------- | ---------------- | --------------------------------------------- |
| `/`                  | Dynamic + cached | Per-visitor cart badge; queries are cached    |
| `/products`          | Dynamic          | Filter permutations are effectively unbounded |
| `/products/[slug]`   | ISR, 1 hour      | Highest traffic, editorial-pace content       |
| `/cart`, `/checkout` | Dynamic          | Inherently per-visitor                        |
| `/admin/**`          | `force-dynamic`  | Must never be cached across staff             |

### The Suspense boundary that mattered

`loading.tsx` lives in `products/(list)/`, not `products/`, and that placement is
load-bearing.

A `loading.tsx` at the segment root wraps the whole subtree — including
`products/[slug]` — in one Suspense boundary. The product page suspends on its
database query, so Next begins streaming and flushes **200** response headers
before the page reaches `notFound()`. Every dead product URL then answered 200
with 404 content: a soft 404, which search engines index as a real page.

A route group moves the boundary without changing the URL, so the listing still
streams a skeleton and the detail page still returns a true 404.

This was found by an end-to-end test asserting the **status code**, not the body.
A test checking for "not found" text would have passed.

---

## Authorisation

Two layers, and the redundancy is deliberate. Full detail in `docs/SECURITY.md`.

The short version: `src/proxy.ts` gives a fast redirect from the session JWT,
which reflects the user's role _as of sign-in_. `src/server/session.ts` decides,
by re-reading the live row. Delete the proxy and the app is still secure, only
less pleasant — a matcher bug must not become a privilege escalation.

---

## Background work

A **transactional outbox**, not an in-memory queue.

Serverless functions are frozen the moment a response returns, so `setTimeout`
silently loses work. Enqueueing to Redis is not part of the database
transaction, so a crash between "order committed" and "email queued" loses the
confirmation — or worse, a rolled-back order still sends one.

Jobs are rows, written in the same transaction as the business change and
drained by `/api/cron/jobs`. Workers claim batches with `FOR UPDATE SKIP
LOCKED`, which is why `claimJobs` is raw SQL: it lets concurrent cron
invocations pull disjoint batches without blocking, which a read-then-update in
Prisma cannot express.

Delivery is at-least-once. **Every handler must be idempotent.**

---

## Caching

| Layer                | Holds                          | TTL       |
| -------------------- | ------------------------------ | --------- |
| Next full route      | Product pages                  | 1 hour    |
| Redis (read-through) | Category tree, homepage, rules | 10–30 min |
| Browser              | Static assets                  | Long      |

Cache failures are never fatal: `cached()` logs and falls through to the origin.
A slow store beats a broken one.

Redis is optional. Without it the app falls back to a bounded in-memory map,
which is correct on one instance and explicitly not safe across several — the
effective rate limit becomes `limit × instances`. It warns loudly at boot in
production.

---

## Trade-offs made knowingly

**JWT sessions rather than database sessions.** Required by the credentials
provider, and avoids a query per request. The cost is that a revoked session
stays valid until it expires, which is precisely why privileged paths re-read
the user row.

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
