import { Router } from 'express';
import { newsletterSchema } from '@momishop/shared/validation';
import { prisma } from '../lib/db';
import { randomToken } from '../lib/crypto';
import { rateLimit } from '../http/request';
import { parseBody } from '../http/validate';

/**
 * Newsletter signup.
 *
 * The response is identical whether the address is new, already subscribed,
 * or was submitted by a bot, so the form cannot be used to test whether an
 * email is on the list.
 */
export const newsletterRouter = Router();

const ACCEPTED = { ok: true, message: 'Thanks — you are on the list.' };

newsletterRouter.post('/newsletter', async (req, res) => {
  await rateLimit(req, 'contact');

  // Honeypot: a hidden field humans never fill. A bot that filled it gets the
  // normal success response, so it learns nothing, and nothing is stored.
  const website = (req.body as { website?: unknown } | undefined)?.website;
  if (typeof website === 'string' && website.length > 0) {
    res.status(201).json(ACCEPTED);
    return;
  }

  const input = parseBody(req, newsletterSchema);

  await prisma.newsletterSubscriber.upsert({
    where: { email: input.email },
    create: {
      email: input.email,
      name: input.name ?? null,
      source: input.source,
      // Left unconfirmed: an address typed into a public form proves nothing
      // about who owns the mailbox, unlike one attached to an account.
      unsubscribeToken: randomToken(24),
    },
    // An existing row is left alone. In particular this form never
    // resubscribes an address that unsubscribed: anyone can type anyone's
    // email here, and that choice belongs to the mailbox owner.
    update: {},
  });

  res.status(201).json(ACCEPTED);
});
