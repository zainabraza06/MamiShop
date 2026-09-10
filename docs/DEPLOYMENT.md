# Deployment

Target stack: Vercel (app), Neon or Supabase (PostgreSQL), Upstash (Redis),
Cloudinary (media), Resend (email), Twilio (SMS).

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
# Pooled, used by the running app. Serverless functions cannot hold a pool
# across invocations, so they connect through PgBouncer.
DATABASE_URL="postgresql://…?pgbouncer=true&connection_limit=1"

# Direct, used by `prisma migrate`. Migrations take advisory locks and issue
# DDL, neither of which survives a transaction-mode pooler.
DIRECT_URL="postgresql://…"
```

Getting these the wrong way round produces migrations that appear to hang.

### 2. Secrets

Set every variable from `.env.example` in the Vercel project, per environment.
The app validates at boot and **fails the deploy** if a required one is missing.

```bash
openssl rand -base64 32   # AUTH_SECRET
openssl rand -hex 32      # CRON_SECRET
```

`AUTH_SECRET` must differ between staging and production. Sharing it means a
staging session token is valid in production.

### 3. GitHub secrets

`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `STAGING_DIRECT_URL`,
`PRODUCTION_DIRECT_URL`.

### 4. Cron

`vercel.json` registers two jobs. Vercel authenticates them with `CRON_SECRET`
as a bearer token.

| Path                        | Schedule      | Job                    |
| --------------------------- | ------------- | ---------------------- |
| `/api/cron/jobs`            | every 2 min   | Drains the outbox      |
| `/api/cron/abandoned-carts` | every 3 hours | Queues recovery emails |

### 5. Uptime monitoring

Point your monitor at `/api/health` and alert on a non-200.

The endpoint distinguishes hard from soft dependencies: a database failure
returns **503** and should page someone; Redis being down returns **200** with
`status: "degraded"`, because the app falls back to in-memory rate limiting and
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

```bash
npx prisma migrate dev --name add_something   # develop
npx prisma migrate deploy                     # CI / production
npx prisma migrate status                     # what has been applied
```

CI fails the build if `schema.prisma` has changes with no corresponding
migration — the `migrations` job runs `prisma migrate diff --exit-code` against
a scratch database.

### Reversibility

Prisma has no `down` migration. Reversibility comes from the expand/contract
discipline plus point-in-time restore, not from a rollback script. Before any
contract-phase migration, confirm PITR covers the window you would need.

---

## Rollback

**Code only** (the common case) — the previous build is still on Vercel:

```bash
vercel rollback <previous-deployment-url>
```

Safe precisely because migrations are backward-compatible. The old code runs
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
- [ ] `/api/health` returns 200 on staging
- [ ] Environment variables set for anything new
- [ ] Someone is available for the next hour

After:

- [ ] `/api/health` returns 200
- [ ] Place a real order and confirm the email arrives
- [ ] Check the job queue is draining (`jobs` where `status = 'DEAD'` is empty)
- [ ] Watch error rates for 15 minutes

---

## Scaling notes

**Connection limits bite first.** Serverless scales function instances faster
than Postgres accepts connections. This is what PgBouncer is for; if you see
"too many connections", check that `DATABASE_URL` really is the pooled one.

**Redis becomes mandatory above one instance.** Without it, rate limits are
per-process, so the effective limit is `limit × instances`. The app warns at
boot in production.

**The listing query is the one to watch.** It is indexed and cursor-paginated,
but `count()` on every request gets expensive past ~50k products. Cache the
count per filter, or drop to an estimate, before that.

**ISR does the heavy lifting.** Product pages are static and revalidated hourly,
so catalogue traffic mostly never reaches the database.
