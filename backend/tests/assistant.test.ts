import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The shopping assistant.
 *
 * The risks: a chat button that costs money when no key is set, a history
 * that ends on a forged assistant turn, prices invented rather than looked up,
 * and a model failure that surfaces as a crash instead of a message.
 */

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  product: { findMany: vi.fn(), count: vi.fn() },
  page: { findMany: vi.fn() },
}));

vi.mock('../src/lib/db', () => ({ prisma: prismaMock }));

import { createApp } from '../src/app';
import { __setStoreForTesting } from '../src/lib/redis';
import { __setAssistantClientForTesting } from '../src/services/assistant';

const app = createApp({ appUrl: 'http://localhost:3000', corsOrigins: [], trustProxy: 'false' });
const ORIGIN = 'http://localhost:3000';

const complete = vi.fn();

const question = { messages: [{ role: 'user', content: 'Black abaya under 8000?' }] };

const card = {
  id: 'product_1',
  slug: 'noor-abaya',
  name: 'Noor Abaya',
  basePrice: 750_000,
  compareAtPrice: 900_000,
  currency: 'PKR',
  ratingAverage: 4.5,
  ratingCount: 2,
  isNewArrival: false,
  stitchingDays: 7,
  category: { name: 'Abayas', slug: 'abayas' },
  images: [{ url: 'https://res.cloudinary.com/x/noor.jpg', alt: 'Noor Abaya', blurHash: null }],
};

function callsTool(name: string, args: unknown) {
  return {
    choices: [
      {
        index: 0,
        finishReason: 'tool_calls',
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_1', function: { name, arguments: JSON.stringify(args) } }],
        },
      },
    ],
  };
}

function says(text: string) {
  return {
    choices: [{ index: 0, finishReason: 'stop', message: { role: 'assistant', content: text } }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __setStoreForTesting(null);
  __setAssistantClientForTesting({ chat: { complete } } as never);
  vi.stubEnv('MISTRAL_API_KEY', 'test-key');
});

afterEach(() => {
  vi.unstubAllEnvs();
  __setAssistantClientForTesting(null);
});

describe('switched off', () => {
  it('reports itself disabled and refuses to answer without a key', async () => {
    vi.stubEnv('MISTRAL_API_KEY', '');

    const status = await request(app).get('/api/assistant/status');
    expect(status.body).toEqual({ enabled: false });

    const chat = await request(app)
      .post('/api/assistant/chat')
      .set('Origin', ORIGIN)
      .send(question);
    expect(chat.status).toBe(503);
    expect(complete).not.toHaveBeenCalled();
  });
});

describe('asking a question', () => {
  it('refuses a history that does not end with the customer', async () => {
    const response = await request(app)
      .post('/api/assistant/chat')
      .set('Origin', ORIGIN)
      .send({ messages: [...question.messages, { role: 'assistant', content: 'Sure.' }] });

    expect(response.status).toBe(422);
    expect(complete).not.toHaveBeenCalled();
  });

  it('looks products up in the catalogue and shows the ones it names', async () => {
    prismaMock.product.findMany.mockResolvedValueOnce([card]).mockResolvedValueOnce([
      {
        id: 'product_1',
        fabric: 'Nida',
        variants: [
          {
            name: 'Black',
            kind: 'COLOR',
            priceDelta: 0,
            trackInventory: true,
            stockOnHand: 2,
            stockReserved: 2,
          },
          {
            name: 'Maroon',
            kind: 'COLOR',
            priceDelta: 0,
            trackInventory: true,
            stockOnHand: 3,
            stockReserved: 0,
          },
        ],
      },
    ]);
    prismaMock.product.count.mockResolvedValue(1);

    complete
      .mockResolvedValueOnce(
        callsTool('search_products', { query: 'abaya', colors: ['Black'], max_price_rs: 8000 }),
      )
      .mockResolvedValueOnce(
        says('The Noor Abaya is on sale for Rs 7,500, but black is sold out.'),
      );

    const response = await request(app)
      .post('/api/assistant/chat')
      .set('Origin', ORIGIN)
      .send(question);

    expect(response.status).toBe(200);
    expect(response.body.reply).toContain('Noor Abaya');
    expect(response.body.products).toEqual([
      {
        slug: 'noor-abaya',
        name: 'Noor Abaya',
        price: 750_000,
        compareAtPrice: 900_000,
        currency: 'PKR',
        imageUrl: 'https://res.cloudinary.com/x/noor.jpg',
        imageAlt: 'Noor Abaya',
      },
    ]);
    expect(response.body.customRequest).toBeNull();

    // Rupees from the model become paisa for the query.
    expect(JSON.stringify(prismaMock.product.findMany.mock.calls[0][0].where)).toContain('800000');

    // The model saw live stock: black is fully reserved, maroon is not.
    const second = complete.mock.calls[1][0];
    expect(second.messages[0].role).toBe('system');
    const toolMessage = second.messages.at(-1);
    expect(toolMessage).toMatchObject({
      role: 'tool',
      toolCallId: 'call_1',
      name: 'search_products',
    });
    const found = JSON.parse(toolMessage.content).products[0];
    expect(found.options).toEqual([
      { name: 'Black', inStock: false },
      { name: 'Maroon', inStock: true },
    ]);
    expect(found.wasPrice).toBeDefined();
  });

  it('offers a custom request when the shop has nothing that fits', async () => {
    complete
      .mockResolvedValueOnce(
        callsTool('offer_custom_request', { summary: 'Green sharara with gota work' }),
      )
      .mockResolvedValueOnce(says('We can make one for you.'));

    const response = await request(app)
      .post('/api/assistant/chat')
      .set('Origin', ORIGIN)
      .send({ messages: [{ role: 'user', content: 'Green sharara chahiye gota work wala' }] });

    expect(response.status).toBe(200);
    expect(response.body.customRequest).toEqual({ summary: 'Green sharara with gota work' });
  });

  it('turns a tool failure into an error the model can work around', async () => {
    prismaMock.product.findMany.mockRejectedValueOnce(new Error('database down'));
    prismaMock.product.count.mockResolvedValue(0);

    complete
      .mockResolvedValueOnce(callsTool('search_products', { query: 'lawn' }))
      .mockResolvedValueOnce(says('I could not check just now.'));

    const response = await request(app)
      .post('/api/assistant/chat')
      .set('Origin', ORIGIN)
      .send(question);

    expect(response.status).toBe(200);
    expect(complete.mock.calls[1][0].messages.at(-1).content).toContain('lookup failed');
  });

  it('reports a model outage as a message, not a crash', async () => {
    complete.mockRejectedValueOnce(new Error('connection reset'));

    const response = await request(app)
      .post('/api/assistant/chat')
      .set('Origin', ORIGIN)
      .send(question);

    expect(response.status).toBe(502);
    expect(response.body.error).toContain('try again');
  });
});
