import 'server-only';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { randomToken } from '@/lib/crypto';
import { canonicalJson } from '@/lib/canonical-json';
import { getSessionUserId } from '@/server/session';
// `Prisma` is used as a value too (Prisma.JsonNull), so it cannot be a type-only import.
import { Prisma } from '@prisma/client';

/**
 * Cart resolution.
 *
 * A cart is keyed either to a signed-in user or to an anonymous cookie token,
 * which is what makes guest checkout and abandoned-cart recovery work without
 * forcing an account.
 *
 * The cookie is httpOnly so client JavaScript cannot read or forge it, and
 * carries only an opaque random token — never a cart id that could be
 * incremented to walk into someone else's basket.
 */

const CART_COOKIE = 'momishop_cart';
const CART_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

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

/** Reads the current cart without creating one. Safe in server components. */
export async function getCart(): Promise<CartWithItems | null> {
  const userId = await getSessionUserId();
  const token = (await cookies()).get(CART_COOKIE)?.value;

  if (userId) {
    const existing = await prisma.cart.findFirst({
      where: { userId, convertedOrderId: null },
      orderBy: { updatedAt: 'desc' },
      include: cartItemInclude,
    });
    if (existing) return existing;
  }

  if (!token) return null;

  return prisma.cart.findFirst({
    where: { token, convertedOrderId: null },
    include: cartItemInclude,
  });
}

/**
 * Gets or creates the cart, setting the cookie when a new one is made.
 *
 * Must only be called from a route handler or server action — a server
 * component cannot set cookies, and Next.js throws if you try.
 */
export async function getOrCreateCart(): Promise<CartWithItems> {
  const existing = await getCart();
  if (existing) return existing;

  const userId = await getSessionUserId();
  const jar = await cookies();
  const token = jar.get(CART_COOKIE)?.value ?? randomToken(24);

  const cart = await prisma.cart.create({
    data: {
      token,
      userId: userId ?? null,
      expiresAt: new Date(Date.now() + CART_COOKIE_MAX_AGE * 1000),
    },
    include: cartItemInclude,
  });

  jar.set(CART_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: CART_COOKIE_MAX_AGE,
  });

  return cart;
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
export async function mergeGuestCart(userId: string): Promise<void> {
  const jar = await cookies();
  const token = jar.get(CART_COOKIE)?.value;
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

/** Item count for the header badge. Cheap enough to run on every page. */
export async function getCartCount(): Promise<number> {
  const cart = await getCart();
  if (!cart) return 0;
  return cart.items.reduce((total, item) => total + item.quantity, 0);
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

export { CART_COOKIE };
