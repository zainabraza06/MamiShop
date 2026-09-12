import { Router } from 'express';
import { contactSchema } from '@momishop/shared/validation';
import { logger } from '../lib/logger';
import { rateLimit } from '../http/request';
import { parseBody } from '../http/validate';
import { contactEnquiryEmail, sendEmail } from '../services/email';

/**
 * The contact form.
 *
 * Rate limited under the `contact` policy, because this endpoint sends mail on
 * a stranger's behalf — the thing every spam script looks for.
 */
export const contactRouter = Router();

const ACCEPTED = { ok: true, message: 'Thanks — we will reply within one working day.' };

/** Where enquiries land. Falls back to the from-address so mail is never lost. */
function shopInbox(): string {
  return process.env.EMAIL_REPLY_TO ?? process.env.EMAIL_FROM ?? 'hello@momishop.pk';
}

contactRouter.post('/contact', async (req, res) => {
  await rateLimit(req, 'contact');

  // Honeypot: a hidden field humans never fill. A bot that filled it gets the
  // normal response, so it learns nothing, and no mail is sent.
  const website = (req.body as { website?: unknown } | undefined)?.website;
  if (typeof website === 'string' && website.length > 0) {
    res.status(201).json(ACCEPTED);
    return;
  }

  const input = parseBody(req, contactSchema);

  const email = contactEnquiryEmail({
    name: input.name,
    email: input.email,
    phone: input.phone ?? null,
    orderNumber: input.orderNumber ?? null,
    subject: input.subject,
    message: input.message,
  });

  // Sent inline rather than queued: the customer is waiting on this response,
  // and a failure should tell them to try again rather than disappear into a
  // retry they cannot see.
  await sendEmail({ to: shopInbox(), ...email, replyTo: input.email });

  logger.info('Contact enquiry received', { subject: input.subject });

  res.status(201).json(ACCEPTED);
});
