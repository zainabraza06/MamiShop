import { Router } from 'express';
import type { Request } from 'express';
import { shippingRateSchema, shippingZoneSchema, taxRuleSchema } from '@momishop/shared/validation';
import { hasPermission, type Principal, type UserRole } from '@momishop/shared/rbac';
import { prisma } from '../lib/db';
import { CACHE_KEYS, invalidate } from '../lib/cache';
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from '../lib/errors';
import { requirePermission, requireStaff } from '../auth/current-user';
import { ipHash } from '../http/request';
import { parseBody } from '../http/validate';
import { actorFrom, recordAudit } from '../services/audit';

/**
 * Delivery and tax — the store settings checkout actually reads.
 *
 * Two rules protect the checkout: the last switched-on delivery zone cannot be
 * switched off or deleted, and neither can a zone's last delivery option.
 * Either would leave shoppers unable to finish an order, and the first anyone
 * would hear of it is a drop in sales.
 *
 * Every write clears checkout's cached copy of the rules, so the next quote
 * uses what was just saved.
 */
export const adminSettingsRouter = Router();

const auditContext = (req: Request) => ({
  ip: ipHash(req),
  userAgent: req.get('user-agent') ?? null,
});

const atLeastOneField = (value: Record<string, unknown>) =>
  Object.values(value).some((field) => field !== undefined);

const daysInOrder = (value: { minDays?: number; maxDays?: number }) =>
  value.minDays === undefined || value.maxDays === undefined || value.minDays <= value.maxDays;

const DAYS_MESSAGE = {
  message: 'The longest delivery time cannot be shorter than the quickest.',
  path: ['maxDays'],
};

async function assertAnotherActiveZone(zoneId: string, name: string): Promise<void> {
  const others = await prisma.shippingZone.count({
    where: { id: { not: zoneId }, isActive: true },
  });
  if (others === 0) {
    throw new ConflictError(
      `${name} is the only delivery zone switched on. Shoppers could not check out without one, so switch on or add another zone first.`,
    );
  }
}

async function assertZoneKeepsAnOption(rate: { id: string; zoneId: string; name: string }) {
  const zone = await prisma.shippingZone.findUnique({
    where: { id: rate.zoneId },
    select: { name: true, isActive: true },
  });
  // A zone that is switched off offers nothing anyway.
  if (!zone?.isActive) return;

  const others = await prisma.shippingRate.count({
    where: { zoneId: rate.zoneId, id: { not: rate.id }, isActive: true },
  });
  if (others === 0) {
    throw new ConflictError(
      `${rate.name} is the only delivery option in ${zone.name}, so shoppers there could not check out. Add another option first, or switch the zone off.`,
    );
  }
}

adminSettingsRouter.get('/admin/settings', async (req, res) => {
  const actor = await requireStaff(req);
  const principal: Principal = { role: actor.role as UserRole, permissions: actor.permissions };

  const canShipping = hasPermission(principal, 'shipping.write');
  const canTax = hasPermission(principal, 'tax.write');
  if (!canShipping && !canTax && !hasPermission(principal, 'settings.write')) {
    throw new AuthorizationError();
  }

  const [zones, taxRules] = await Promise.all([
    prisma.shippingZone.findMany({
      orderBy: [{ priority: 'desc' }, { name: 'asc' }],
      include: { rates: { orderBy: [{ position: 'asc' }, { name: 'asc' }] } },
    }),
    prisma.taxRule.findMany({
      orderBy: [{ country: 'asc' }, { state: 'asc' }, { priority: 'desc' }],
    }),
  ]);

  res.json({ zones, taxRules, canShipping, canTax });
});

// ── Delivery zones ─────────────────────────────────────────────────────────

adminSettingsRouter.post('/admin/shipping-zones', async (req, res) => {
  const actor = await requirePermission(req, 'shipping.write');
  const input = parseBody(req, shippingZoneSchema);

  const zone = await prisma.shippingZone.create({ data: input, select: { id: true, name: true } });
  await invalidate(CACHE_KEYS.shippingRules);

  await recordAudit({
    actor: actorFrom(actor),
    action: 'shipping.update',
    entityType: 'ShippingZone',
    entityId: zone.id,
    summary: `Added the ${zone.name} delivery zone`,
    after: input,
    ...auditContext(req),
  });

  res.status(201).json({ zone });
});

const zoneUpdateSchema = shippingZoneSchema.partial().refine(atLeastOneField, 'Nothing to change.');

adminSettingsRouter.patch('/admin/shipping-zones/:id', async (req, res) => {
  const actor = await requirePermission(req, 'shipping.write');
  const input = parseBody(req, zoneUpdateSchema);

  const before = await prisma.shippingZone.findUnique({ where: { id: req.params.id } });
  if (!before) throw new NotFoundError('Delivery zone');

  if (before.isActive && input.isActive === false) {
    await assertAnotherActiveZone(before.id, before.name);
  }

  const after = await prisma.shippingZone.update({ where: { id: before.id }, data: input });
  await invalidate(CACHE_KEYS.shippingRules);

  await recordAudit({
    actor: actorFrom(actor),
    action: 'shipping.update',
    entityType: 'ShippingZone',
    entityId: before.id,
    summary: `Updated the ${after.name} delivery zone`,
    before,
    after,
    ...auditContext(req),
  });

  res.json({ zone: after });
});

adminSettingsRouter.delete('/admin/shipping-zones/:id', async (req, res) => {
  const actor = await requirePermission(req, 'shipping.write');

  const zone = await prisma.shippingZone.findUnique({
    where: { id: req.params.id },
    select: { id: true, name: true, isActive: true },
  });
  if (!zone) throw new NotFoundError('Delivery zone');

  if (zone.isActive) await assertAnotherActiveZone(zone.id, zone.name);

  // Orders keep their own delivery total, so nothing past points at a zone.
  await prisma.shippingZone.delete({ where: { id: zone.id } });
  await invalidate(CACHE_KEYS.shippingRules);

  await recordAudit({
    actor: actorFrom(actor),
    action: 'shipping.update',
    entityType: 'ShippingZone',
    entityId: zone.id,
    summary: `Deleted the ${zone.name} delivery zone`,
    before: zone,
    ...auditContext(req),
  });

  res.json({ ok: true });
});

// ── Delivery options within a zone ─────────────────────────────────────────

const rateCreateSchema = shippingRateSchema.refine(daysInOrder, DAYS_MESSAGE);

adminSettingsRouter.post('/admin/shipping-zones/:id/rates', async (req, res) => {
  const actor = await requirePermission(req, 'shipping.write');
  const input = parseBody(req, rateCreateSchema);

  const zone = await prisma.shippingZone.findUnique({
    where: { id: req.params.id },
    select: { id: true, name: true, rates: { select: { position: true } } },
  });
  if (!zone) throw new NotFoundError('Delivery zone');

  const position = zone.rates.reduce((max, rate) => Math.max(max, rate.position), -1) + 1;

  const rate = await prisma.shippingRate.create({
    data: { ...input, position, zoneId: zone.id },
    select: { id: true, name: true },
  });
  await invalidate(CACHE_KEYS.shippingRules);

  await recordAudit({
    actor: actorFrom(actor),
    action: 'shipping.update',
    entityType: 'ShippingRate',
    entityId: rate.id,
    summary: `Added ${rate.name} to the ${zone.name} delivery zone`,
    after: input,
    ...auditContext(req),
  });

  res.status(201).json({ rate });
});

const rateUpdateSchema = shippingRateSchema.partial().refine(atLeastOneField, 'Nothing to change.');

adminSettingsRouter.patch('/admin/shipping-rates/:id', async (req, res) => {
  const actor = await requirePermission(req, 'shipping.write');
  const input = parseBody(req, rateUpdateSchema);

  const before = await prisma.shippingRate.findUnique({ where: { id: req.params.id } });
  if (!before) throw new NotFoundError('Delivery option');

  // Checked against the saved values too, so changing only one end still has to make sense.
  const minDays = input.minDays ?? before.minDays;
  const maxDays = input.maxDays ?? before.maxDays;
  if (minDays > maxDays) {
    throw new ValidationError(DAYS_MESSAGE.message, [
      { field: 'maxDays', message: DAYS_MESSAGE.message },
    ]);
  }

  if (before.isActive && input.isActive === false) await assertZoneKeepsAnOption(before);

  const after = await prisma.shippingRate.update({ where: { id: before.id }, data: input });
  await invalidate(CACHE_KEYS.shippingRules);

  await recordAudit({
    actor: actorFrom(actor),
    action: 'shipping.update',
    entityType: 'ShippingRate',
    entityId: before.id,
    summary: `Updated the ${after.name} delivery option`,
    before,
    after,
    ...auditContext(req),
  });

  res.json({ rate: after });
});

adminSettingsRouter.delete('/admin/shipping-rates/:id', async (req, res) => {
  const actor = await requirePermission(req, 'shipping.write');

  const rate = await prisma.shippingRate.findUnique({
    where: { id: req.params.id },
    select: { id: true, zoneId: true, name: true, isActive: true },
  });
  if (!rate) throw new NotFoundError('Delivery option');

  if (rate.isActive) await assertZoneKeepsAnOption(rate);

  await prisma.shippingRate.delete({ where: { id: rate.id } });
  await invalidate(CACHE_KEYS.shippingRules);

  await recordAudit({
    actor: actorFrom(actor),
    action: 'shipping.update',
    entityType: 'ShippingRate',
    entityId: rate.id,
    summary: `Deleted the ${rate.name} delivery option`,
    before: rate,
    ...auditContext(req),
  });

  res.json({ ok: true });
});

// ── Tax ────────────────────────────────────────────────────────────────────

adminSettingsRouter.post('/admin/tax-rules', async (req, res) => {
  const actor = await requirePermission(req, 'tax.write');
  const input = parseBody(req, taxRuleSchema);

  const rule = await prisma.taxRule.create({ data: input, select: { id: true, name: true } });
  await invalidate(CACHE_KEYS.taxRules);

  await recordAudit({
    actor: actorFrom(actor),
    action: 'tax.update',
    entityType: 'TaxRule',
    entityId: rule.id,
    summary: `Added the ${rule.name} tax rule at ${(input.rateBps / 100).toFixed(2)}%`,
    after: input,
    ...auditContext(req),
  });

  res.status(201).json({ rule });
});

const taxUpdateSchema = taxRuleSchema.partial().refine(atLeastOneField, 'Nothing to change.');

adminSettingsRouter.patch('/admin/tax-rules/:id', async (req, res) => {
  const actor = await requirePermission(req, 'tax.write');
  const input = parseBody(req, taxUpdateSchema);

  const before = await prisma.taxRule.findUnique({ where: { id: req.params.id } });
  if (!before) throw new NotFoundError('Tax rule');

  const after = await prisma.taxRule.update({ where: { id: before.id }, data: input });
  await invalidate(CACHE_KEYS.taxRules);

  await recordAudit({
    actor: actorFrom(actor),
    action: 'tax.update',
    entityType: 'TaxRule',
    entityId: before.id,
    summary: `Updated the ${after.name} tax rule`,
    before,
    after,
    ...auditContext(req),
  });

  res.json({ rule: after });
});

adminSettingsRouter.delete('/admin/tax-rules/:id', async (req, res) => {
  const actor = await requirePermission(req, 'tax.write');

  const rule = await prisma.taxRule.findUnique({
    where: { id: req.params.id },
    select: { id: true, name: true, rateBps: true },
  });
  if (!rule) throw new NotFoundError('Tax rule');

  // Orders store the tax they charged, so removing a rule rewrites nothing past.
  await prisma.taxRule.delete({ where: { id: rule.id } });
  await invalidate(CACHE_KEYS.taxRules);

  await recordAudit({
    actor: actorFrom(actor),
    action: 'tax.update',
    entityType: 'TaxRule',
    entityId: rule.id,
    summary: `Deleted the ${rule.name} tax rule`,
    before: rule,
    ...auditContext(req),
  });

  res.json({ ok: true });
});
