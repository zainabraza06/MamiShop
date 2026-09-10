# Data retention and privacy

What is stored, for how long, and how a customer gets it out or gets it deleted.

---

## What is held

| Data                  | Where                                            | Why                                  |
| --------------------- | ------------------------------------------------ | ------------------------------------ |
| Name, email, phone    | `users`, `orders`                                | Fulfilment and contact               |
| Delivery address      | `addresses`, order snapshot                      | Delivery, and the invoice record     |
| **Body measurements** | `measurement_profiles`, order snapshot           | Making the garment                   |
| Order history         | `orders`, `order_items`                          | Fulfilment, returns, accounting      |
| Password hash         | `users.passwordHash`                             | Authentication (bcrypt, never plain) |
| Hashed IP             | `login_attempts`, `orders`, `audit_logs`         | Abuse detection                      |
| Marketing consent     | `users.marketingOptIn`, `newsletter_subscribers` | Consent record                       |

Measurements deserve particular care. For a modest-fashion retailer, both a
customer's measurements and the fact that they shop here are sensitive. Several
decisions in `docs/SECURITY.md` — the account-enumeration resistance in
particular — follow from that rather than from a generic checklist.

---

## Retention periods

| Data                    | Retained                                   | Rationale                             |
| ----------------------- | ------------------------------------------ | ------------------------------------- |
| Order records           | 7 years                                    | Tax and accounting obligations        |
| Measurement profiles    | Until deleted, or 3 years after last order | Reuse across orders                   |
| Login attempts          | 90 days                                    | Enough for abuse investigation        |
| Audit log               | 3 years                                    | Accountability for privileged actions |
| Abandoned carts         | 30 days                                    | Recovery window                       |
| Job records             | 30 days after completion                   | Debugging                             |
| Marketing subscriptions | Until unsubscribed                         | Consent-based                         |

`Order.purgeAfter` is the anchor for the 7-year rule and is set at creation.

**Orders are never hard-deleted before that**, even on an erasure request — tax
law requires the record. What happens instead is described below.

---

## Deletion request

`DataRequest` with `kind: DELETE`. The process:

1. **Anonymise the user row** — email replaced with a non-routable placeholder,
   name and phone cleared, `passwordHash` nulled, `status: DELETED`,
   `deletedAt` set.
2. **Delete measurement profiles.** Personal data with no legal retention
   requirement.
3. **Delete saved addresses.** The order snapshots remain, because an invoice
   must show where a parcel was actually sent.
4. **Keep orders**, now unlinked from an identifiable person. The
   `shippingSnapshot` on historical orders is retained under the tax obligation
   and purged at `purgeAfter`.
5. **Remove from the newsletter** and clear marketing consent.
6. **Keep audit log entries**, which record staff actions rather than customer
   data.

The customer is told plainly which data is removed immediately and which is
retained until the statutory period expires. Claiming full erasure while keeping
order records would simply be false.

---

## Export request

`DataRequest` with `kind: EXPORT` produces machine-readable JSON containing the
account, addresses, measurement profiles, orders with line items, reviews,
returns and loyalty history.

Delivered as a time-limited download link (`downloadUrl`, `expiresAt`), never as
an email attachment — an attachment sits in an inbox indefinitely.

---

## Consent

Marketing consent is opt-in and recorded with its source. Transactional email —
order confirmation, shipping, returns — is sent regardless, because it is
necessary to perform the contract rather than marketing.

Every marketing email carries a one-click unsubscribe backed by
`NewsletterSubscriber.unsubscribeToken`, which is a random value rather than a
guessable id.

---

## Cookies

| Cookie                 | Purpose                | Lifetime |
| ---------------------- | ---------------------- | -------- |
| `authjs.session-token` | Authentication         | 7 days   |
| `momishop_cart`        | Guest cart association | 30 days  |
| `authjs.csrf-token`    | CSRF protection        | Session  |

All are strictly necessary and all are `httpOnly`. The cart cookie holds an
opaque random token, not a cart id that could be incremented into someone else's
basket.

No analytics or advertising cookies are set today. Adding any means adding a
consent banner that actually gates them — a banner that sets cookies before the
choice is made is worse than no banner at all.

---

## Sub-processors

| Service       | Data shared                         | Purpose  |
| ------------- | ----------------------------------- | -------- |
| Vercel        | Request metadata                    | Hosting  |
| Neon/Supabase | Everything above                    | Database |
| Upstash       | Rate-limit counters, cached content | Cache    |
| Cloudinary    | Product and review images           | Media    |
| Resend        | Name, email, order contents         | Email    |
| Twilio        | Phone number, order number          | SMS      |
| Stripe        | Name, email, amount                 | Payments |

Card details go directly from the customer's browser to Stripe and never reach
this application.
