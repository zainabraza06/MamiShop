import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { deepEqualIgnoringKeyOrder } from '@momishop/shared/canonical-json';
import { validateMeasurements, type MeasurementTemplateKey } from '@momishop/shared/measurements';
import { addToCartSchema, updateCartItemSchema } from '@momishop/shared/validation';
import { prisma } from '../lib/db';
import { NotFoundError, OutOfStockError, ValidationError } from '../lib/errors';
import { cartOwner, rateLimit, setCartCookie } from '../http/request';
import { parseBody } from '../http/validate';
import { countItems, getCart, getOrCreateCart, validateCartLines } from '../services/cart';

/**
 * The cart.
 *
 * The measurement values submitted here are re-validated server-side against
 * the product's own sizing template. The storefront validates too, for fast
 * feedback, but that check is a convenience — anyone can POST straight to this
 * endpoint, and a garment cut from unvalidated numbers is wasted fabric.
 */
export const cartRouter = Router();

/**
 * The cart page's view of the bag.
 *
 * Line availability is re-checked on every read, so a basket left open for
 * days surfaces its problems on the cart page rather than failing at the
 * payment step, which is where an abandoned checkout usually comes from.
 */
cartRouter.get('/cart', async (req, res) => {
  const cart = await getCart(cartOwner(req));

  if (!cart || cart.items.length === 0) {
    res.json({ lines: [], couponCode: null, itemCount: 0 });
    return;
  }

  const issues = validateCartLines(cart);

  res.json({
    lines: cart.items.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      productName: item.product.name,
      productSlug: item.product.slug,
      variantName: item.variant?.name ?? null,
      unitPrice: item.product.basePrice + (item.variant?.priceDelta ?? 0),
      currency: item.product.currency,
      imageUrl: item.product.images[0]?.url ?? null,
      imageAlt: item.product.images[0]?.alt ?? item.product.name,
      stitchingDays: item.product.stitchingDays,
      measurementUnit: item.measurementUnit,
      measurementValues: item.measurementValues as Record<string, number> | null,
      // Same product -> category -> default chain as the product page; most
      // products inherit their template rather than setting one.
      measurementTemplate:
        item.product.sizingTemplate ?? item.product.category.sizingTemplate ?? 'WOMENS_STITCHED',
      customNote: item.customNote,
      issue: issues.find((i) => i.itemId === item.id) ?? null,
    })),
    couponCode: cart.coupon?.code ?? null,
    itemCount: countItems(cart),
  });
});

cartRouter.post('/cart/items', async (req, res) => {
  const owner = cartOwner(req);
  await rateLimit(req, 'api', owner.userId);

  const input = parseBody(req, addToCartSchema);

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

  // The variant must belong to this product — otherwise a crafted request
  // could pair a cheap product with an unrelated variant.
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
      if (!owner.userId) throw new ValidationError('Sign in to use a saved measurement profile.');

      const profile = await prisma.measurementProfile.findFirst({
        where: { id: input.measurementProfileId, userId: owner.userId, deletedAt: null },
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
      res.status(422).json({
        error: 'Please check your measurements.',
        code: 'MEASUREMENT_INVALID',
        details: result.issues,
      });
      return;
    }
    measurementValues = result.normalised;
  }

  const { cart, issuedToken } = await getOrCreateCart(owner);
  if (issuedToken) setCartCookie(res, issuedToken);

  /**
   * Merge into an existing line only when the configuration is identical.
   * The measurement snapshot is part of that identity: the same abaya in two
   * different sets of measurements is two garments, not a quantity of two.
   */
  const existing = cart.items.find(
    (item) =>
      item.productId === product.id &&
      item.variantId === (input.variantId ?? null) &&
      // Key order must not matter: the stored value comes back from Postgres
      // jsonb in its own key order, not the order it was written in.
      deepEqualIgnoringKeyOrder(item.measurementValues, measurementValues) &&
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

  const updated = await getCart({ ...owner, token: issuedToken ?? owner.token });
  res.status(201).json({ ok: true, cartCount: countItems(updated) });
});

/** Updates a line quantity. Quantity 0 removes the line. */
cartRouter.patch('/cart/items', async (req, res) => {
  const owner = cartOwner(req);
  await rateLimit(req, 'api', owner.userId);

  const input = parseBody(req, updateCartItemSchema);
  const cart = await getCart(owner);
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

  res.json({ ok: true, cartCount: countItems(await getCart(owner)) });
});

cartRouter.delete('/cart/items', async (req, res) => {
  const owner = cartOwner(req);
  await rateLimit(req, 'api', owner.userId);

  const itemId = req.query.itemId;
  if (typeof itemId !== 'string' || itemId.length === 0) {
    throw new ValidationError('An item id is required.');
  }

  const cart = await getCart(owner);
  if (!cart) throw new NotFoundError('Cart');

  const item = cart.items.find((i) => i.id === itemId);
  if (!item) throw new NotFoundError('Cart item');

  await prisma.cartItem.delete({ where: { id: item.id } });

  res.json({ ok: true, cartCount: countItems(await getCart(owner)) });
});
