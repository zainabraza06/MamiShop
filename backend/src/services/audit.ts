import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { hashIp } from '../lib/crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Audit logging.
 *
 * Every privileged mutation writes a row here: who did it, to what, and what
 * changed. This exists for three reasons — settling "who changed this price",
 * investigating a compromised staff account, and satisfying the retention and
 * accountability expectations that come with holding customer data.
 *
 * The log is append-only by convention. Nothing in the app updates or deletes
 * an AuditLog row, and no admin screen offers to.
 */

export type AuditAction =
  | 'product.create'
  | 'product.update'
  | 'product.archive'
  | 'product.import'
  | 'category.create'
  | 'category.update'
  | 'category.delete'
  | 'filter.create'
  | 'filter.update'
  | 'filter.delete'
  | 'filter.reorder'
  | 'inventory.adjust'
  | 'order.create_manual'
  | 'order.status_change'
  | 'order.cancel'
  | 'order.refund'
  | 'order.note'
  | 'return.create'
  | 'return.status_change'
  | 'return.refund'
  | 'coupon.create'
  | 'coupon.update'
  | 'coupon.delete'
  | 'review.moderate'
  | 'customer.update'
  | 'customer.suspend'
  | 'customer.reinstate'
  | 'customer.loyalty_adjust'
  | 'staff.create'
  | 'staff.update'
  | 'staff.role_change'
  | 'staff.delete'
  | 'content.update'
  | 'page.update'
  | 'settings.update'
  | 'shipping.update'
  | 'tax.update'
  | 'data_request.handle'
  | 'auth.password_change';

export interface AuditActor {
  id: string;
  email: string;
  role: string;
}

export interface AuditEntry {
  actor: AuditActor | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  summary?: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Fields never written to the audit log, even inside a `before`/`after` blob.
 *
 * The log is widely readable inside the business and gets exported during
 * investigations, so it must not become a second place secrets live.
 */
const SENSITIVE_FIELDS = new Set([
  'passwordHash',
  'password',
  'token',
  'sessionToken',
  'accessToken',
  'refreshToken',
  'id_token',
  'access_token',
  'refresh_token',
  'unsubscribeToken',
  'paymentRawPayload',
  'gatewayResponse',
]);

function redactEntity(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[max-depth]';
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => redactEntity(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_FIELDS.has(k) ? '[redacted]' : redactEntity(v, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Reduces a before/after pair to only the fields that actually changed.
 *
 * A full snapshot of both states makes the log unreadable and enormous. What
 * an investigator wants is "basePrice: 450000 -> 380000", not two hundred
 * unchanged columns.
 */
export function diffOf(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): Prisma.InputJsonValue | undefined {
  if (!before && !after) return undefined;

  if (!before) return { created: redactEntity(after) } as Prisma.InputJsonValue;
  if (!after) return { deleted: redactEntity(before) } as Prisma.InputJsonValue;

  const changed: Record<string, { before: unknown; after: unknown }> = {};

  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (SENSITIVE_FIELDS.has(key)) continue;

    const a = before[key];
    const b = after[key];

    // JSON comparison keeps Date and nested-object equality honest without
    // pulling in a deep-equal dependency.
    if (JSON.stringify(a) === JSON.stringify(b)) continue;

    changed[key] = { before: redactEntity(a), after: redactEntity(b) };
  }

  if (Object.keys(changed).length === 0) return undefined;
  return changed as Prisma.InputJsonValue;
}

/** A Prisma client or an interactive transaction — both accept `.auditLog`. */
type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Writes one audit row.
 *
 * Pass the transaction client when the audit belongs to the same atomic unit
 * as the change it records, so a rolled-back refund cannot leave a log entry
 * claiming it happened.
 *
 * Outside a transaction, a logging failure is swallowed: losing an audit row
 * is bad, but failing the customer's refund because the log write timed out is
 * worse. Inside a transaction the caller gets the error and the whole thing
 * rolls back.
 */
export async function recordAudit(entry: AuditEntry, db: Db = prisma): Promise<void> {
  const data = {
    actorId: entry.actor?.id ?? null,
    actorEmail: entry.actor?.email ?? null,
    actorRole: entry.actor?.role ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    summary: entry.summary ?? null,
    diff: diffOf(
      entry.before as Record<string, unknown> | null,
      entry.after as Record<string, unknown> | null,
    ),
    ipHash: entry.ip ? hashIp(entry.ip) : null,
    userAgent: entry.userAgent?.slice(0, 500) ?? null,
  };

  const isTransactional = db !== prisma;

  if (isTransactional) {
    await db.auditLog.create({ data });
    return;
  }

  try {
    await db.auditLog.create({ data });
  } catch (error) {
    logger.error('Failed to write audit log', {
      error,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
    });
  }
}

/** Convenience wrapper that reads actor details straight off a session user. */
export function actorFrom(
  user: { id: string; email: string; role: string } | null,
): AuditActor | null {
  return user ? { id: user.id, email: user.email, role: user.role } : null;
}
