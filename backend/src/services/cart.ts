import { Prisma } from '@prisma/client';
import { canonicalJson } from '@momishop/shared/canonical-json';
import { CART_COOKIE_MAX_AGE_SECONDS } from '@momishop/shared/session-contract';
import { prisma } from '../lib/db';
import { randomToken } from '../lib/crypto';

/**
 * Cart resolution.
 *
 * A cart is keyed either to a signed-in user or to an anonymous cookie token,
 * which is what makes guest checkout and abandoned-cart recovery work without
 * forcing an account.
 *
 * These functions take the caller's identity explicitly and report any token
 * they issue; the HTTP layer owns the cookie. Keeping requests and responses
 * out of the service is what lets it be called from a route, a job or a test
 * alike.
 */

export interface CartOwner {
  userId: string | null;
  /** The anonymous cart token from the caller's cookie, if any. */
  token: string | null;
}

export const cartItemInclude = {
  items: {
    orderBy: { createdAt: 'asc' },
    include: {
      product: {
        select: {
          id: true,
          slug: true,
          name: true,
          basePrice: true,
          currency: true,
          taxClass: true,
          categoryId: true,
          stitchingDays: true,
          requiresMeasurements: true,
          sizingTemplate: true,
          status: true,
          archivedAt: true,
          // Needed to resolve the sizing template, which most products inherit
          // from their category rather than setting themselves.
          category: { select: { sizingTemplate: true } },
          images: {
            where: { variantId: null },
            orderBy: { position: 'asc' },
            take: 1,
            select: { url: true, alt: true },
          },
        },
      },
      variant: {
        select: {
          id: true,
          name: true,
          sku: true,
          priceDelta: true,
          trackInventory: true,
          stockOnHand: true,
          stockReserved: true,
          isActive: true,
        },
      },
    },
  },
  coupon: true,
} satisfies Prisma.CartInclude;

export type CartWithItems = Prisma.CartGetPayload<{ include: typeof cartItemInclude }>;

/** Reads the caller's open cart without creating one. */
export async function getCart(owner: CartOwner): Promise<CartWithItems | null> {
  if (owner.userId) {
    const existing = await prisma.cart.findFirst({
      where: { userId: owner.userId, convertedOrderId: null },
      orderBy: { updatedAt: 'desc' },
      include: cartItemInclude,
    });
    if (existing) return existing;
  }

  if (!owner.token) return null;

  return prisma.cart.findFirst({
    where: { token: owner.token, convertedOrderId: null },
    include: cartItemInclude,
  });
}

/**
 * Gets the caller's open cart, creating one if needed.
 *
 * A new cart always gets a fresh token, returned as `issuedToken` for the
 * caller to write to the cart cookie. Reusing the token already in the cookie
 * is not safe: after checkout that token still belongs to the converted cart,
 * and `token` is unique, so a guest adding to a new bag after ordering would
 * hit a constraint violation.
 */
export async function getOrCreateCart(
  owner: CartOwner,
): Promise<{ cart: CartWithItems; issuedToken: string | null }> {
  const existing = await getCart(owner);
  if (existing) return { cart: existing, issuedToken: null };

  const token = randomToken(24);
  const cart = await prisma.cart.create({
    data: {
      token,
      userId: owner.userId,
      expiresAt: new Date(Date.now() + CART_COOKIE_MAX_AGE_SECONDS * 1000),
    },
    include: cartItemInclude,
  });

  return { cart, issuedToken: token };
}

/**
 * Merges a guest cart into the user's cart at sign-in.
 *
 * Called after authentication so a basket assembled before logging in is not
 * silently lost — one of the most common causes of checkout abandonment.
 *
 * Quantities are summed for identical lines. "Identical" includes the
 * measurement snapshot: the same abaya in two different sets of measurements
 * is genuinely two different garments and must stay two lines.
 */
export async function mergeGuestCart(userId: string, token: string | null): Promise<void> {
  if (!token) return;

  const guestCart = await prisma.cart.findFirst({
    where: { token, userId: null, convertedOrderId: null },
    include: { items: true },
  });

  if (!guestCart || guestCart.items.length === 0) return;

  const userCart = await prisma.cart.findFirst({
    where: { userId, convertedOrderId: null },
    orderBy: { updatedAt: 'desc' },
    include: { items: true },
  });

  // No existing cart: simply claim the guest one.
  if (!userCart) {
    await prisma.cart.update({ where: { id: guestCart.id }, data: { userId } });
    return;
  }

  // Canonical (key-sorted) serialisation, because both sides of this
  // comparison were read back from Postgres jsonb, which does not preserve
  // the key order they were written in.
  const lineKey = (item: {
    productId: string;
    variantId: string | null;
    measurementValues: Prisma.JsonValue | null;
  }) => `${item.productId}:${item.variantId ?? ''}:${canonicalJson(item.measurementValues)}`;

  const existingByKey = new Map(userCart.items.map((item) => [lineKey(item), item]));

  await prisma.$transaction(async (tx) => {
    for (const item of guestCart.items) {
      const match = existingByKey.get(lineKey(item));

      if (match) {
        await tx.cartItem.update({
          where: { id: match.id },
          data: { quantity: Math.min(match.quantity + item.quantity, 20) },
        });
      } else {
        await tx.cartItem.create({
          data: {
            cartId: userCart.id,
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity,
            measurementProfileId: item.measurementProfileId,
            measurementUnit: item.measurementUnit,
            measurementValues: item.measurementValues ?? Prisma.JsonNull,
            customNote: item.customNote,
          },
        });
      }
    }

    await tx.cart.delete({ where: { id: guestCart.id } });
  });
}

/** Total units in a cart, for the header badge. */
export function countItems(cart: CartWithItems | null): number {
  return cart?.items.reduce((total, item) => total + item.quantity, 0) ?? 0;
}

/**
 * Flags lines that can no longer be fulfilled as configured.
 *
 * A basket can sit for days: a product may be archived, a variant deactivated,
 * or stock sold to someone faster. Surfacing that on the cart page is far
 * better than failing at the payment step.
 */
export interface CartLineIssue {
  itemId: string;
  productName: string;
  reason: 'UNAVAILABLE' | 'OUT_OF_STOCK' | 'QUANTITY_REDUCED';
  message: string;
  availableQuantity?: number;
}

export function validateCartLines(cart: CartWithItems): CartLineIssue[] {
  const issues: CartLineIssue[] = [];

  for (const item of cart.items) {
    const name = item.product.name;

    if (item.product.status !== 'ACTIVE' || item.product.archivedAt) {
      issues.push({
        itemId: item.id,
        productName: name,
        reason: 'UNAVAILABLE',
        message: `${name} is no longer available.`,
      });
      continue;
    }

    if (item.variant && !item.variant.isActive) {
      issues.push({
        itemId: item.id,
        productName: name,
        reason: 'UNAVAILABLE',
        message: `The selected option for ${name} is no longer available.`,
      });
      continue;
    }

    if (item.variant?.trackInventory) {
      const available = item.variant.stockOnHand - item.variant.stockReserved;

      if (available <= 0) {
        issues.push({
          itemId: item.id,
          productName: name,
          reason: 'OUT_OF_STOCK',
          message: `${name} has sold out.`,
          availableQuantity: 0,
        });
      } else if (available < item.quantity) {
        issues.push({
          itemId: item.id,
          productName: name,
          reason: 'QUANTITY_REDUCED',
          message: `Only ${available} of ${name} left — your quantity has been reduced.`,
          availableQuantity: available,
        });
      }
    }
  }

  return issues;
}
