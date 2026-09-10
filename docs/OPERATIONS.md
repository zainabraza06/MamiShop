# Operations

Monitoring, background jobs, load testing and the runbooks for the things most
likely to go wrong.

---

## Health

`GET /api/health` — unauthenticated, deliberately thin. Reports liveness and
version, never counts, configuration or connection strings.

```json
{
  "status": "ok",
  "version": "a1b2c3d",
  "environment": "production",
  "checks": {
    "database": { "status": "ok", "latencyMs": 12 },
    "cache": { "status": "ok", "latencyMs": 3 }
  }
}
```

| Response       | Meaning              | Action                          |
| -------------- | -------------------- | ------------------------------- |
| 200 `ok`       | Everything healthy   | None                            |
| 200 `degraded` | Redis unreachable    | Investigate in working hours    |
| 503 `down`     | Database unreachable | **Page.** The store cannot sell |

The hard/soft split is intentional. Redis being down means per-process rate
limits and uncached queries — slower but correct. Paging at 3am for a cache is
how on-call rotations get ignored.

---

## Background jobs

A transactional outbox. Jobs are rows written in the same transaction as the
business change, drained every two minutes by `/api/cron/jobs`.

**Delivery is at-least-once, so every handler must be idempotent.**

### Statuses

| Status       | Meaning                                      |
| ------------ | -------------------------------------------- |
| `PENDING`    | Waiting, or waiting to retry after a failure |
| `PROCESSING` | Claimed by a worker                          |
| `COMPLETED`  | Done                                         |
| `FAILED`     | Transient state during retry scheduling      |
| `DEAD`       | Retries exhausted — **needs a human**        |

Backoff is 1, 2, 4, 8, 16 minutes, capped. Slow enough to ride out a provider
blip, capped because a shipping SMS three hours late is worse than none.

A worker killed mid-job (serverless timeout) has its lock reclaimed after five
minutes, so work is never stranded.

### Runbook: DEAD jobs appearing

```sql
SELECT type, COUNT(*), MAX("lastError")
FROM jobs WHERE status = 'DEAD'
GROUP BY type;
```

`lastError` carries the provider's own message. Common causes: an expired Resend
or Twilio key, a malformed customer phone number, a Cloudinary URL that 404s.

After fixing the cause, requeue:

```sql
UPDATE jobs SET status = 'PENDING', attempts = 0, "runAfter" = NOW()
WHERE status = 'DEAD' AND type = 'email.order_confirmation';
```

Safe because handlers are idempotent — a customer whose email did send will not
get a second one, since that job would be `COMPLETED` rather than `DEAD`.

### Runbook: the queue is growing

```sql
SELECT status, COUNT(*) FROM jobs GROUP BY status;
```

If `PENDING` climbs steadily, either the cron is not firing (check Vercel's cron
log and that `CRON_SECRET` matches) or a handler is timing out. Raise
`BATCH_SIZE` in `src/app/api/cron/jobs/route.ts` only after confirming the
handlers are fast — a bigger batch that still times out just fails more work per
run.

---

## Errors

Sentry is wired into `next.config.mjs` behind `SENTRY_DSN` and tunnelled through
`/monitoring` so ad blockers do not suppress reports. The client/server/edge
config files are not yet added — see `docs/ROADMAP.md`.

Structured JSON logs go to stdout, one object per line, queryable in Vercel's
log drain. Secrets are redacted before the sink; see `src/lib/logger.ts`.

Unhandled API errors return a `requestId` to the caller and log the full error
against it, so a customer can quote a reference without us exposing a stack
trace.

---

## Load testing

Not yet written — the scripts behind `npm run load:*` are missing. The plan, for
when they are:

### Scenarios

1. **Browse** — homepage, listing, product detail. The bulk of real traffic, and
   mostly served by ISR.
2. **Search** — `/api/products?q=…`. Uncached and rate-limited.
3. **Checkout** — quote then place. The expensive path: a transaction with stock
   contention.

### Targets

| Metric              | Target  |
| ------------------- | ------- |
| p95 browse          | < 500ms |
| p95 checkout quote  | < 800ms |
| p95 order placement | < 2s    |
| Error rate          | < 0.5%  |
| Concurrent shoppers | 500     |

### What to look for

**Stock contention.** Have many virtual users buy the same variant. Order
placement reserves stock with a conditional `updateMany` whose predicate acts as
the lock, so the losers should get a clean `OutOfStockError` — never oversold
stock, never a deadlock.

**Connection exhaustion.** The first thing to break under load. If you see "too
many connections", confirm `DATABASE_URL` is the pooled string.

Run against staging with production-shaped data. Load testing an empty database
measures nothing.

---

## Common runbooks

### Orders stuck in PENDING

Expected for unpaid card orders — the gateway webhook has not arrived. Since the
gateway adapters are not implemented yet, any non-COD order will sit here.

```sql
SELECT "orderNumber", "paymentMethod", "placedAt"
FROM orders
WHERE status = 'PENDING' AND "placedAt" < NOW() - INTERVAL '1 hour';
```

### A customer says their measurements are wrong

The measurements on the order are a frozen snapshot; the profile they may have
edited since is a different record.

```sql
SELECT "productName", "measurementSnapshot", "measurementUnit"
FROM order_items
WHERE "orderId" = (SELECT id FROM orders WHERE "orderNumber" = 'MS-2026-000001');
```

That snapshot is what the workshop cut to, and it is what the invoice shows.

### Rate limit complaints

Almost always a shared NAT. Signed-in users are limited by user id specifically
to avoid this; anonymous users behind one office IP share a budget. Check
`login_attempts` grouped by `ipHash` to distinguish a real attack from an
office.

### Cache invalidation

The category tree and homepage content are cached for 10–30 minutes. After an
admin edit, `invalidateCatalogue()` clears them. If stale content persists,
confirm Redis is reachable — the read-through cache logs and falls through to
the origin on failure, so a broken cache degrades rather than breaks.
