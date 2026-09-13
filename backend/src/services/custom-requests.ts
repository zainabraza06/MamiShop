import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { ChatMessage } from '@momishop/shared/api-types';
import { prisma } from '../lib/db';
import { ValidationError } from '../lib/errors';
import { isUniqueViolation } from '../lib/prisma-errors';

/**
 * Shared pieces of the custom request conversation: photo checks, reference
 * numbers, and how a message is shown to each side.
 */

/** The Cloudinary folder every chat photo is uploaded into. */
export const ATTACHMENT_FOLDER = 'momishop/custom-requests';

/** Signed into every upload, so Cloudinary refuses anything but a photo. */
export const ALLOWED_FORMATS = 'jpg,jpeg,png,webp,heic';

export function uploadsConfigured(): boolean {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET,
  );
}

/**
 * Cloudinary's signed-upload signature: the parameters sorted by name, joined
 * as key=value pairs, then the secret appended and hashed with SHA-1. The
 * browser sends the same parameters, so Cloudinary can recompute it; the
 * secret itself never leaves the API.
 */
export function cloudinarySignature(
  params: Record<string, string | number>,
  secret: string,
): string {
  const payload = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return createHash('sha1')
    .update(payload + secret)
    .digest('hex');
}

/**
 * Refuses any photo that is not one of ours.
 *
 * A message could otherwise carry any https address — a tracking pixel, or a
 * picture that later changes into something else — and it would render in
 * the owner's admin. Only uploads to this shop's Cloudinary folder are kept.
 */
export function assertOwnAttachments(urls: string[]): void {
  if (urls.length === 0) return;

  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  const prefix = cloud ? `https://res.cloudinary.com/${cloud}/image/upload/` : null;

  const foreign = urls.filter(
    (url) => !prefix || !url.startsWith(prefix) || !url.includes(`/${ATTACHMENT_FOLDER}/`),
  );

  if (foreign.length > 0) {
    throw new ValidationError(
      'Photos have to be uploaded here rather than linked from elsewhere.',
      [{ field: 'attachments', message: 'Upload the photo instead of linking to it.' }],
    );
  }
}

/**
 * Creates something that needs the next reference number, retrying if two
 * requests arrive at once and compute the same one. The unique constraint on
 * `number` is the real guarantee; this is the loser's second try.
 */
export async function withRequestNumber<T>(work: (number: string) => Promise<T>): Promise<T> {
  const year = new Date().getFullYear();

  for (let attempt = 1; ; attempt++) {
    const count = await prisma.customRequest.count({
      where: { createdAt: { gte: new Date(year, 0, 1) } },
    });
    const number = `CR-${year}-${String(count + attempt).padStart(6, '0')}`;

    try {
      return await work(number);
    } catch (error) {
      if (attempt >= 4 || !isUniqueViolation(error, 'number')) throw error;
    }
  }
}

export const messageSelect = {
  id: true,
  authorRole: true,
  body: true,
  attachments: true,
  createdAt: true,
  author: { select: { name: true } },
} satisfies Prisma.CustomRequestMessageSelect;

type SelectedMessage = Prisma.CustomRequestMessageGetPayload<{ select: typeof messageSelect }>;

/**
 * A message as a customer sees it. Replies come from "MomiShop", so the name
 * of whichever employee wrote them is not sent to the customer at all.
 */
export function forCustomer(message: SelectedMessage): ChatMessage {
  return {
    id: message.id,
    authorRole: message.authorRole,
    authorName: null,
    body: message.body,
    attachments: message.attachments,
    createdAt: message.createdAt.toISOString(),
  };
}

/** A message as staff see it, with the author's name. */
export function forStaff(message: SelectedMessage): ChatMessage {
  return { ...forCustomer(message), authorName: message.author?.name ?? null };
}

/**
 * The key that turns a burst of messages into one email.
 *
 * Every message enqueues a notification, but jobs sharing a key are only
 * stored once, so everything written in the same 15 minutes produces a single
 * email. The job also runs a couple of minutes later, and is skipped if the
 * other side has read the conversation by then.
 */
export function notificationKey(kind: 'staff' | 'customer', requestId: string, now = new Date()) {
  return `custom-request-${kind}:${requestId}:${Math.floor(now.getTime() / (15 * 60_000))}`;
}
