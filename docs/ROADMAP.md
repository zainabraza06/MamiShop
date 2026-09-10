# Status and roadmap

An honest account of what is finished, what is partial, and what has not been
built. Written so nobody has to discover a gap by hitting it in production.

---

## Working and verified end to end

Verified against PostgreSQL 16 on a production build, not just typechecked.

| Area                    | Evidence                                                                     |
| ----------------------- | ---------------------------------------------------------------------------- |
| Catalogue browsing      | Listing, filters, cursor pagination, category tree, search                   |
| Product detail          | ISR, structured data, related products, reviews, true 404 on unknown slug    |
| Made-to-measure capture | 5 templates, range + cross-field validation, inch/cm conversion, SVG guide   |
| Cart                    | Guest cookie cart, merge on sign-in, stock revalidation, content-based merge |
| Checkout                | Live server-side quoting, coupons, shipping zones, inclusive GST, COD        |
| Order placement         | Single transaction: stock, order, coupon, loyalty, cart, jobs                |
| Order confirmation      | Measurement snapshot echoed back to the customer                             |
| Authentication          | Credentials + lockout, enumeration-resistant registration, Google provider   |
| Authorisation           | Two-layer (edge redirect + live DB re-check), granular permissions           |
| Admin dashboard         | Live revenue, orders needing action, low stock, permission-filtered nav      |
| Background jobs         | Outbox drained by cron, `FOR UPDATE SKIP LOCKED`, retries, DEAD letters      |
| Transactional email     | Order confirmation, shipped, welcome, abandoned cart                         |
| PDF invoices            | pdf-lib, WinAnsi sanitising, measurements printed                            |
| Health check            | Hard/soft dependency split, 503 only when the database is down               |
| Accessibility           | Zero axe WCAG A/AA violations on every key page                              |

**Test coverage:** 146 unit tests, 15 end-to-end, 13 accessibility.

---

## Partial — usable, but not finished

### Payment gateways

**COD is the only fully working payment path.** `PaymentMethod` and
`PaymentTransaction` model the others, checkout accepts them, and the order is
created correctly with `paymentStatus: UNPAID` and a redirect to
`/checkout/pay/[orderNumber]`.

What is missing is the adapter behind that redirect:

- **Stripe** — PaymentIntent creation, Elements on the pay page, and the
  `/api/webhooks/stripe` handler that flips `paymentStatus` to `PAID` and the
  order to `CONFIRMED`. The webhook must verify the signature with
  `stripe.webhooks.constructEvent`, and must be idempotent on `event.id`.
- **JazzCash** — the redirect form is a POST with an HMAC-SHA256 `pp_SecureHash`
  over the sorted field values, salted with `JAZZCASH_INTEGRITY_SALT`. The
  return callback must recompute and compare that hash in constant time before
  trusting anything in it.
- **Easypaisa** — same shape, different field names and hash key.

`next.config.mjs` already allowlists all three in `form-action`, and
`src/lib/crypto.ts` has `hmacSha256Hex` and `safeEqual` for exactly this.

**Do not ship card payments until the webhook is the only thing that marks an
order paid.** A client-side "payment succeeded" callback is trivially forged.

### Admin CRUD

The dashboard, shell, and permission model are complete. The list/detail/edit
screens under `/admin/products`, `/admin/orders`, `/admin/customers`,
`/admin/returns`, `/admin/coupons`, `/admin/content`, `/admin/staff`,
`/admin/settings` and `/admin/audit` are routed but not built. The server-side
pieces they need already exist: `recordAudit`, `requirePermission`, the order
state machine, and validation schemas for every entity in `src/lib/validation.ts`.

### Customer account area

`/account` is protected by middleware and the layout, but the sub-pages
(orders, measurement profiles, addresses, wishlist, returns, privacy/data
export) are not built. The data layer is there.

---

## Not started

- **Returns and refunds workflow** — schema, state machine and validation exist;
  no UI on either side, and no Stripe refund call.
- **Reviews submission** — reading, moderation status and aggregates work;
  there is no write endpoint or form, and no verified-purchase check on write.
- **Bulk product import/export** — `papaparse` is a dependency and
  `product.import` is a permission; the parser and column mapping are not written.
- **Loyalty and referrals UI** — accrual, redemption and referral crediting all
  work server-side; nothing surfaces them to the customer.
- **Search beyond Postgres `contains`** — adequate for a few hundred products.
  Add `tsvector` + a GIN index before it becomes slow; Meilisearch only if
  typo tolerance is actually needed.
- **Multi-currency** — the money layer supports five currencies and every amount
  is stored with its currency, but there is no conversion, no price book, and no
  currency switcher. PKR only in practice.
- **Analytics** — `NEXT_PUBLIC_GA_MEASUREMENT_ID` and `NEXT_PUBLIC_META_PIXEL_ID`
  are validated and CSP-allowlisted; no script is injected and no events fire.
- **A/B testing** — `ContentBlock.experimentKey` and `bucketVariant()` exist;
  nothing reads them yet.
- **Load testing** — `docs/OPERATIONS.md` has the plan and thresholds; the k6
  scripts referenced by `npm run load:*` are not written.
- **Sentry** — `@sentry/nextjs` is installed and wired into `next.config.mjs`
  behind `SENTRY_DSN`; the client/server/edge config files are not added.

---

## Known limitations worth stating plainly

**Redis is optional and the fallback is per-process.** Without
`UPSTASH_REDIS_REST_URL`, rate limits and caches live in one process's memory.
On a single instance that is correct. On several it means the effective rate
limit is `limit × instances`. The app warns loudly at boot in production.

**Guest order confirmation is reachable by order number alone.** A guest has to
be able to see what they just bought. The page shows no payment details, and
the richer tracking page additionally requires the email address. Orders
attached to an account are restricted to that account.

**Sessions are JWTs with a 7-day lifetime.** A revoked session stays
cryptographically valid until it expires, which is why every privileged entry
point re-reads the user's live role and status rather than trusting the token.

**Invoices are generated on demand, not stored.** No object storage to secure or
expire, and an invoice always matches the current order record. The trade-off is
CPU per download, which is fine at this volume.

**`next lint` is deprecated**, so `npm run lint` calls ESLint directly. The
Next-specific rules still run via `eslint-config-next` in the flat config.
