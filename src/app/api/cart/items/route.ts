import { prisma } from '@/lib/db';
import { addToCartSchema, updateCartItemSchema } from '@/lib/validation';
import { validateMeasurements, type MeasurementTemplateKey } from '@/lib/measurements';
import { getOrCreateCart, getCart } from '@/server/cart';
import {
  jsonOk,
  jsonError,
  parseJsonBody,
  rateLimit,
  withErrorHandling,
} from '@/server/api';
import { NotFoundError, OutOfStockError, ValidationError } from '@/lib/errors';
import { getSessionUserId } from '@/server/session';
import { Prisma } from '@prisma/client';

/**
 * Cart line management.
 *
 * The measurement values submitted here are re-validated server-side against
 * the product's own sizing template. The client validates too, for fast
 * feedback, but that check is a convenience — anyone can POST straight to this
 * endpoint, and a garment cut from unvalidated numbers is wasted fabric.
 */

export const POST = withErrorHandling(async (request) => {
  const userId = await getSessionUserId();
  await rateLimit(request, 'api', userId);

  const input = await parseJsonBody(request, addToCartSchema);

  const product = await prisma.product.findFirst({
    where: { id: input.productId, status: 'ACTIVE', archivedAt: null },
    select: {
      id: true,
      name: true,
      requiresMeasurements: true,
      sizingTemplate: true,
      category: { select: { sizingTemplate: true } },
    },
  });

  if (!product) throw new NotFoundError('Product');

  // Variant must belong to this product — otherwise a crafted request could
  // pair a cheap product with an unrelated variant.
  let variant = null;
  if (input.variantId) {
    variant = await prisma.productVariant.findFirst({
      where: { id: input.variantId, productId: product.id, isActive: true },
      select: {
        id: true,
        name: true,
        trackInventory: true,
        stockOnHand: true,
        stockReserved: true,
      },
    });
    if (!variant) throw new NotFoundError('Product option');
  }

  if (variant?.trackInventory) {
    const available = variant.stockOnHand - variant.stockReserved;
    if (available < input.quantity) {
      throw new OutOfStockError(`${product.name} (${variant.name})`);
    }
  }

  // Re-validate measurements against the authoritative template.
  let measurementValues: Record<string, number> | null = null;
  let measurementUnit = input.measurementUnit ?? null;

  if (product.requiresMeasurements) {
    const template = (product.sizingTemplate ??
      product.category.sizingTemplate ??
      'WOMENS_STITCHED') as MeasurementTemplateKey;

    // A saved profile is trusted only after confirming it belongs to the
    // caller; otherwise a profile id could be used to read someone else's
    // measurements into an order.
    if (input.measurementProfileId) {
      if (!userId) throw new ValidationError('Sign in to use a saved measurement profile.');

      const profile = await prisma.measurementProfile.findFirst({
        where: { id: input.measurementProfileId, userId, deletedAt: null },
        select: { unit: true, values: true },
      });
      if (!profile) throw new NotFoundError('Measurement profile');

      measurementUnit = profile.unit;
      measurementValues = profile.values as Record<string, number>;
    } else {
      if (!input.measurementValues || !measurementUnit) {
        throw new ValidationError('Measurements are required for this item.');
      }
      measurementValues = input.measurementValues as Record<string, number>;
    }

    const result = validateMeasurements(template, measurementValues, measurementUnit);
    if (!result.ok) {
      return jsonError(
        'Please check your measurements.',
        422,
        'MEASUREMENT_INVALID',
        result.issues,
      );
    }
    measurementValues = result.normalised;
  }

  const cart = await getOrCreateCart();

  /**
   * Merge into an existing line only when the configuration is identical.
   * The measurement snapshot is part of that identity: the same abaya in two
   * different sets of measurements is two garments, not a quantity of two.
   */
  const existing = cart.items.find(
    (item) =>
      item.productId === product.id &&
      item.variantId === (input.variantId ?? null) &&
      JSON.stringify(item.measurementValues) === JSON.stringify(measurementValues) &&
      (item.customNote ?? '') === (input.customNote ?? ''),
  );

  if (existing) {
    const quantity = Math.min(existing.quantity + input.quantity, 20);
    await prisma.cartItem.update({ where: { id: existing.id }, data: { quantity } });
  } else {
    await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        productId: product.id,
        variantId: input.variantId ?? null,
        quantity: input.quantity,
        measurementProfileId: input.measurementProfileId ?? null,
        measurementUnit,
        measurementValues: measurementValues ?? Prisma.JsonNull,
        customNote: input.customNote ?? null,
      },
    });
  }

  // Touch the cart so abandoned-cart timing is based on real activity.
  await prisma.cart.update({ where: { id: cart.id }, data: { updatedAt: new Date() } });

  const updated = await getCart();
  const count = updated?.items.reduce((total, item) => total + item.quantity, 0) ?? 0;

  return jsonOk({ ok: true, cartCount: count }, { status: 201 });
});

/** Updates a line quantity. Quantity 0 removes the line. */
export const PATCH = withErrorHandling(async (request) => {
  const userId = await getSessionUserId();
  await rateLimit(request, 'api', userId);

  const input = await parseJsonBody(request, updateCartItemSchema);
  const cart = await getCart();
  if (!cart) throw new NotFoundError('Cart');

  // Scoping the lookup to the caller's own cart is what prevents editing
  // someone else's basket by guessing an item id.
  const item = cart.items.find((i) => i.id === input.itemId);
  if (!item) throw new NotFoundError('Cart item');

  if (input.quantity === 0) {
    await prisma.cartItem.delete({ where: { id: item.id } });
  } else {
    if (item.variant?.trackInventory) {
      const available = item.variant.stockOnHand - item.variant.stockReserved;
      if (available < input.quantity) throw new OutOfStockError(item.product.name);
    }
    await prisma.cartItem.update({
      where: { id: item.id },
      data: { quantity: input.quantity },
    });
  }

  const updated = await getCart();
  const count = updated?.items.reduce((total, i) => total + i.quantity, 0) ?? 0;

  return jsonOk({ ok: true, cartCount: count });
});

export const DELETE = withErrorHandling(async (request) => {
  const userId = await getSessionUserId();
  await rateLimit(request, 'api', userId);

  const url = new URL(request.url);
  const itemId = url.searchParams.get('itemId');
  if (!itemId) throw new ValidationError('An item id is required.');

  const cart = await getCart();
  if (!cart) throw new NotFoundError('Cart');

  const item = cart.items.find((i) => i.id === itemId);
  if (!item) throw new NotFoundError('Cart item');

  await prisma.cartItem.delete({ where: { id: item.id } });

  const updated = await getCart();
  const count = updated?.items.reduce((total, i) => total + i.quantity, 0) ?? 0;

  return jsonOk({ ok: true, cartCount: count });
});
