import 'server-only';
import twilio from 'twilio';
import { logger } from '@/lib/logger';
import { normalizePhonePK } from '@/lib/utils';

/**
 * Transactional SMS.
 *
 * SMS costs real money per message and lands in a channel people cannot mute,
 * so it is reserved for the three moments that genuinely matter: order
 * confirmed, shipped, delivered. Marketing never goes out this way.
 *
 * Messages are kept under 160 GSM-7 characters so a single segment is billed.
 */

let client: ReturnType<typeof twilio> | null = null;

function sms() {
  if (client) return client;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  client = twilio(sid, token);
  return client;
}

export async function sendSms(to: string, body: string): Promise<void> {
  const api = sms();
  const from = process.env.TWILIO_FROM_NUMBER;

  const normalised = normalizePhonePK(to) ?? to;

  if (!api || !from) {
    logger.info('SMS not sent: Twilio is not configured', { to: normalised });
    return;
  }

  if (body.length > 160) {
    // Not fatal, but worth knowing about: this doubles the per-message cost.
    logger.warn('SMS body exceeds one segment', { length: body.length });
  }

  try {
    await api.messages.create({ to: normalised, from, body });
  } catch (error) {
    // Rethrown so the job queue retries with backoff.
    throw new Error(
      `Twilio rejected the message: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export const smsTemplates = {
  orderConfirmed: (orderNumber: string) =>
    `MomiShop: order ${orderNumber} confirmed. We'll start stitching and message you when it ships.`,

  orderShipped: (orderNumber: string, courier: string, tracking: string) =>
    `MomiShop: order ${orderNumber} has shipped via ${courier}. Tracking: ${tracking}`,

  orderDelivered: (orderNumber: string) =>
    `MomiShop: order ${orderNumber} has been delivered. We hope you love it.`,
};
