# Deployment

Two services deploy from this repository:

| Service    | What it is       | Target                                            |
| ---------- | ---------------- | ------------------------------------------------- |
| Storefront | Next.js 16       | Vercel (project root directory: `frontend`)       |
| API        | Express, Node 20 | Any Node host — Render, Railway, Fly, a container |

Plus PostgreSQL (Neon or Supabase), Redis (Upstash), Cloudinary (media), Resend
(email) and Twilio (SMS).

---

## How the two fit together

The storefront proxies `/api/*` to the API, so customers only ever see one
origin and cookies stay first-party. That means:

- the storefront needs **`API_URL`**, the API's address as reached from the
  storefront's servers;
- both services need the **same `AUTH_SECRET`** — the API signs session tokens,
  the storefront's proxy verifies them;
- the API needs **`APP_URL`** (for email links and sign-in redirects) and
  **`TRUST_PROXY`** set to match its hosting, or client IPs will be wrong and
  rate limits will pool every visitor into one bucket;
- the API needs `CORS_ORIGINS` **only** if a browser will call it directly on
  its own domain. Through the storefront's rewrite, it does not.

Deploy the API first and the storefront second: the API's changes are additive,
so the old storefront keeps working against the new API, while a new storefront
may depend on an endpoint the old API does not have. Roll back in the reverse
order.

---

## Environments

| Environment | Branch               | Database         | Purpose                       |
| ----------- | -------------------- | ---------------- | ----------------------------- |
| Development | local                | Docker Postgres  | Feature work                  |
| Preview     | any PR               | Staging database | Review apps, automatic per PR |
| Staging     | `main`               | Staging database | Pre-production verification   |
| Production  | `main` + manual gate | Production       | Live                          |

A merge to `main` deploys to staging automatically. Production requires an
approval on the GitHub `production` environment, so a merge never reaches
customers without a human saying yes.

---

## First-time setup

### 1. Database

Create two databases — staging and production. Both need **two** connection
strings:

```bash
# Pooled, used by the running API. Serverless and autoscaled hosts cannot hold a
# pool across instances, so they connect through PgBouncer.
DATABASE_URL="postgresql://…?pgbouncer=true&connection_limit=1"

# Direct, used by `prisma migrate`. Migrations take advisory locks and issue
# DDL, neither of which survives a transaction-mode pooler.
DIRECT_URL="postgresql://…"
```

Getting these the wrong way round produces migrations that appear to hang.

### 2. Secrets

Set them per service, from `.env.example`. Each service validates at boot and
**fails to start** if a required one is missing.

| Variable                                                | API | Storefront |
| ------------------------------------------------------- | --- | ---------- |
| `DATABASE_URL`, `DIRECT_URL`                            | ✓   |            |
| `AUTH_SECRET`                                           | ✓   | ✓          |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`                  | ✓   |            |
| `APP_URL`, `API_PUBLIC_URL`, `TRUST_PROXY`              | ✓   |            |
| `CRON_SECRET`                                           | ✓   |            |
| Stripe, JazzCash, Easypaisa, Cloudinary, Resend, Twilio | ✓   |            |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`    | ✓   |            |
| `API_URL`                                               |     | ✓          |
| `NEXT_PUBLIC_*`                                         |     | ✓          |

```bash
openssl rand -base64 32   # AUTH_SECRET
openssl rand -hex 32      # CRON_SECRET
```

`AUTH_SECRET` must differ between staging and production. Sharing it means a
staging session token is valid in production.

### 3. GitHub secrets

`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `STAGING_DIRECT_URL`,
`PRODUCTION_DIRECT_URL`, and `API_DEPLOY_HOOK_URL` — the deploy hook of whatever
host runs the API. Without the last one the workflow warns and skips the API
deploy rather than silently shipping only half the release.

### 4. Cron

`frontend/vercel.json` registers two jobs against the storefront, which proxies
them to the API. Vercel authenticates them with `CRON_SECRET` as a bearer token.
If the API is hosted somewhere with its own scheduler, point that at the API
directly instead and delete the block.

| Path                        | Schedule      | Job                    |
| --------------------------- | ------------- | ---------------------- |
| `/api/cron/jobs`            | every 2 min   | Drains the outbox      |
| `/api/cron/abandoned-carts` | every 3 hours | Queues recovery emails |

### 5. Uptime monitoring

Point your monitor at the storefront's `/api/health` and alert on a non-200.
Going through the storefront exercises both services and the rewrite between
them in one check. Monitor the API's own `/api/health` too if it has a public
address.

The endpoint distinguishes hard from soft dependencies: a database failure
returns **503** and should page someone; Redis being down returns **200** with
`status: "degraded"`, because the API falls back to in-memory rate limiting and
uncached queries — slower but correct. Paging at 3am for a cache is how on-call
rotations get ignored.

---

## Migrations

### The expand/contract rule

CI and the deploy workflow both run migrations **before** the new code goes
live. That ordering is only safe if every migration is backward-compatible with
the **currently running** release — during a deploy, old and new code hit the
same schema.

So a destructive change is split across two releases:

**Release 1 — expand.** Add the new column as nullable, or add the new table.
Write to both old and new. Backfill. Ship.

**Release 2 — contract.** Once nothing reads the old column, drop it. Ship.

Never do both in one release. Dropping a column the running code still selects
takes the site down for the length of the deploy.

### Commands

All run from the repository root and delegate to the backend workspace, which
owns `prisma/`.

```bash
npm run db:migrate        # develop: create and apply
npm run db:deploy         # CI / production: apply pending
npm run db:check-drift    # fail if schema.prisma has no matching migration
```

CI fails the build if `schema.prisma` has changes with no corresponding
migration — the `migrations` job runs the same drift check against a scratch
database. That check refuses to run unless `SHADOW_DATABASE_URL` is demonstrably
a different database from `DATABASE_URL`, because Prisma **wipes** the shadow to
replay history into it.

### Reversibility

Prisma has no `down` migration. Reversibility comes from the expand/contract
discipline plus point-in-time restore, not from a rollback script. Before any
contract-phase migration, confirm PITR covers the window you would need.

---

## Rollback

**Code only** (the common case) — roll the storefront back first, then the API:

```bash
vercel rollback <previous-deployment-url>   # storefront
# then redeploy the API's previous image or commit on its host
```

That order matters for the same reason the deploy order does: a new storefront
may call an endpoint an older API lacks, so the storefront goes back first.

Safe precisely because migrations are backward-compatible: the old code runs
against the newer schema.

**Code and schema** — much more serious:

1. Roll the code back first (above). Confirm the site is up.
2. Only then consider the schema. If the migration was expand-phase, leave it —
   it is compatible by construction.
3. If it was contract-phase and dropped something, restore from PITR to just
   before the migration, and accept losing writes since that point.

Step 3 loses customer orders. This is why contract migrations ship separately,
after their expand phase has been live long enough to be trusted.

---

## Backups

**Database** — the managed provider's automated backups plus PITR. Verify the
retention window covers your slowest deploy cadence. **Test a restore
quarterly.** An untested backup is a hypothesis.

**Media** — Cloudinary stores the originals. `ProductImage.publicId` is the link
between a database row and its asset, which is what makes a rebuild possible.

**What is not backed up** — Redis. Everything in it is a cache or a rate-limit
counter, both of which rebuild themselves. Losing it costs a brief latency spike.

---

## Deploy checklist

Before the production gate:

- [ ] CI green: quality, unit, e2e, migration-drift, audit
- [ ] Migration reviewed and confirmed expand-phase
- [ ] Staging smoke-tested: place a COD order end to end
- [ ] `/api/health` returns 200 on staging, through the storefront
- [ ] Environment variables set for anything new, on **both** services
- [ ] Someone is available for the next hour

After:

- [ ] `/api/health` returns 200
- [ ] Place a real order and confirm the email arrives
- [ ] Check the job queue is draining (`jobs` where `status = 'DEAD'` is empty)
- [ ] Watch error rates for 15 minutes

---

## Scaling notes

**Connection limits bite first.** Autoscaled instances scale faster than
Postgres accepts connections. This is what PgBouncer is for; if you see "too
many connections", check that `DATABASE_URL` really is the pooled one. Only the
API connects, which makes the ceiling easier to reason about than it was when
every rendered page held a connection.

**Redis becomes mandatory above one API instance.** Without it, rate limits are
per-process, so the effective limit is `limit × instances`. The API warns at
boot in production.

**The listing query is the one to watch.** It is indexed and cursor-paginated,
but `count()` on every request gets expensive past ~50k products. Cache the
count per filter, or drop to an estimate, before that.

**Catalogue reads are cached in the API**, not in the page layer: the category
tree, homepage content and shipping rules come from Redis, and the public
product endpoints are marked cacheable at the CDN. Storefront pages themselves
are per-visitor and always render.
