# Deployment

Two services deploy from this repository:

| Service    | What it is       | Target                                         |
| ---------- | ---------------- | ---------------------------------------------- |
| Storefront | Next.js 16       | Vercel — project root directory `frontend`     |
| API        | Express, Node 20 | Render — Docker, defined by `render.yaml`      |
| Database   | PostgreSQL 16    | Render Postgres, created by the same blueprint |

Optionally Redis (Upstash), Cloudinary (media), Resend (email) and Twilio
(SMS). Each degrades gracefully when unset: email and SMS log instead of
sending, and without Redis the API falls back to per-process rate limiting.

Nothing about the code is Render- or Vercel-specific. The API is a container
that needs a Postgres URL and a port, so any host that runs one will do; the
storefront is a stock Next.js app.

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

**Keep them in the same region.** The storefront calls the API while rendering
every page, so a cross-region hop is paid on each one. Render's nearest region
to Pakistan is Singapore, so `frontend/vercel.json` pins the storefront's
functions to `sin1` to sit beside it. Moving the API elsewhere means moving
that too.

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

### 1. The API and its database, on Render

In Render: **New → Blueprint**, point it at this repository. `render.yaml`
creates two things and wires the connection string between them:

- `momishop-db` — Postgres 16, Singapore
- `momishop-api` — the container built from `backend/Dockerfile`, health-checked
  at `/api/health`, with auto-deploy **off** (the GitHub workflow triggers it
  after migrations)

Then, in the service's **Environment** tab, fill in the values marked
`sync: false`:

| Variable         | Value                                                         |
| ---------------- | ------------------------------------------------------------- |
| `AUTH_SECRET`    | `openssl rand -base64 32` — the storefront needs the same one |
| `APP_URL`        | the storefront's URL, e.g. `https://momishop.vercel.app`      |
| `API_PUBLIC_URL` | this service's URL, e.g. `https://momishop-api.onrender.com`  |
| `CRON_SECRET`    | `openssl rand -hex 32`                                        |

Finally, **Settings → Deploy Hook**: copy that URL into the GitHub secret
`API_DEPLOY_HOOK_URL`.

On the free plan the service sleeps after about fifteen minutes idle, so the
first request afterwards waits for a cold start, and Render's free Postgres is
time-limited — check the current terms and move to a paid instance before real
orders depend on it.

**If you use a pooled Postgres instead** (Neon, Supabase, or Render with
PgBouncer in front), the two URLs differ and both are needed:

```bash
# Pooled, used by the running API.
DATABASE_URL="postgresql://…?pgbouncer=true&connection_limit=1"

# Direct, used by `prisma migrate`: migrations take advisory locks and issue
# DDL, neither of which survives a transaction-mode pooler.
DIRECT_URL="postgresql://…"
```

Getting those the wrong way round produces migrations that appear to hang.

### 1b. The storefront, on Vercel

Import the repository, then set:

- **Root Directory** `frontend` — and leave "Include files outside the root
  directory" on, because the build compiles `shared/` and installs from the
  root lockfile.
- **Environment variables**: `API_URL` (the Render service URL), `AUTH_SECRET`
  (the same value as the API), and the `NEXT_PUBLIC_*` set from `.env.example`.

`API_URL` is what the storefront's server uses to reach the API; browsers never
see it, because they call `/api/*` on the storefront's own origin and Next
rewrites it.

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

| Secret                                               | Where it comes from                                 |
| ---------------------------------------------------- | --------------------------------------------------- |
| `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | Vercel account settings and the project's `.vercel` |
| `PRODUCTION_DIRECT_URL`                              | Render database → **External** connection string    |
| `STAGING_DIRECT_URL`                                 | the staging database, if you run one                |
| `API_DEPLOY_HOOK_URL`                                | Render service → Settings → Deploy Hook             |

The migration step runs from a GitHub runner, outside Render's network, so it
needs the **external** connection string — the internal one only resolves
between Render services.

Without `API_DEPLOY_HOOK_URL` the workflow warns and skips the API deploy
rather than silently shipping only half the release. With no secrets at all it
skips the whole job, so a repository that is not deploying anywhere yet does
not show a permanently red workflow.

Running a single environment is fine to start: leave `STAGING_DIRECT_URL`
unset, the staging job skips itself, and production still runs behind its
approval gate.

Until the database and Vercel secrets are set, the deploy workflow **skips with
a warning naming what is missing** rather than failing. That keeps a repository
without deployment configured from showing a permanently red workflow, and it
stops the run before it reaches a confusing error further in — an unset
`STAGING_DIRECT_URL` otherwise surfaces as Prisma complaining that `DIRECT_URL`
resolved to an empty string.

### 4. Cron

`.github/workflows/cron.yml` calls the API's cron endpoints on a schedule,
authenticating with `CRON_SECRET` as a bearer token.

| Path                        | Schedule      | Job                    |
| --------------------------- | ------------- | ---------------------- |
| `/api/cron/jobs`            | every 5 min   | Drains the outbox      |
| `/api/cron/abandoned-carts` | every 3 hours | Queues recovery emails |

It needs two things on the repository: the variable `API_BASE_URL` (the API's
public URL) and the secret `CRON_SECRET` (the same value the API has). Without
them the workflow warns and skips rather than failing every five minutes.

**Why not Vercel Cron.** It was, until Vercel's Hobby plan turned out to allow
only daily schedules — and an outbox drained once a day means a customer's
order confirmation sits unsent for hours. GitHub's scheduler is free at
five-minute intervals, which is close enough to the original two.

Its limits are worth knowing: runs are best-effort and can be delayed when
GitHub is busy, and scheduled workflows are disabled automatically after 60
days without repository activity. If the queue becomes load-bearing, move it to
a **Render Cron Job** beside the API — same endpoint, same bearer token — or to
Vercel Pro, which restores the original `vercel.json` block.

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
