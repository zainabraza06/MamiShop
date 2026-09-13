import { Router } from 'express';
import { assistantChatSchema } from '@momishop/shared/validation';
import { AppError } from '../lib/errors';
import { rateLimit, sessionUserId } from '../http/request';
import { parseBody } from '../http/validate';
import { askAssistant, assistantConfigured } from '../services/assistant';

/**
 * The shopping assistant: open to every visitor, signed in or not, because
 * "do you have this in maroon?" is asked before anyone makes an account.
 */
export const assistantRouter = Router();

/** Lets the storefront hide the chat button when no API key is configured. */
assistantRouter.get('/assistant/status', (_req, res) => {
  res.json({ enabled: assistantConfigured() });
});

assistantRouter.post('/assistant/chat', async (req, res) => {
  if (!assistantConfigured()) {
    throw new AppError('The shopping assistant is switched off.', {
      status: 503,
      code: 'ASSISTANT_DISABLED',
      expose: true,
    });
  }

  const { messages } = parseBody(req, assistantChatSchema);
  // Checked after validation so a malformed request does not use up a turn.
  await rateLimit(req, 'assistant', sessionUserId(req));

  res.json(await askAssistant(messages));
});
