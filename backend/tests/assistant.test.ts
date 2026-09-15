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
  product: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
  productVariant: { groupBy: vi.fn() },
  page: { findMany: vi.fn() },
}));

vi.mock('../src/lib/db', () => ({ prisma: prismaMock }));

import { MistralError } from '@mistralai/mistralai/models/errors';
import { createApp } from '../src/app';
import { __setStoreForTesting } from '../src/lib/redis';
import { __setAssistantClientForTesting, matchColours } from '../src/services/assistant';

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
  // What is on sale: the words customers use get matched against these.
  prismaMock.productVariant.groupBy.mockResolvedValue([
    { name: 'Black' },
    { name: 'Navy' },
    { name: 'Midnight' },
    { name: 'Dusty rose' },
  ]);
  prismaMock.product.groupBy.mockResolvedValue([
    { fabric: 'Korean Nida matte' },
    { fabric: 'Georgette' },
  ]);
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

  it('moves to the next model when Mistral rate limits one', async () => {
    const rateLimited = new MistralError('Rate limit exceeded', {
      response: new Response('{"message":"Rate limit exceeded"}', { status: 429 }),
      request: new Request('https://api.mistral.ai/v1/chat/completions', { method: 'POST' }),
      body: '{"message":"Rate limit exceeded"}',
    });
    complete.mockRejectedValueOnce(rateLimited).mockResolvedValueOnce(says('Hello!'));

    const response = await request(app)
      .post('/api/assistant/chat')
      .set('Origin', ORIGIN)
      .send(question);

    expect(response.status).toBe(200);
    expect(response.body.reply).toBe('Hello!');
    expect(complete.mock.calls.map(([params]) => params.model)).toEqual([
      'ministral-14b-latest',
      'ministral-8b-latest',
    ]);
  });

  it('says it is busy only when every model is rate limited', async () => {
    const rateLimited = () =>
      new MistralError('Rate limit exceeded', {
        response: new Response('{}', { status: 429 }),
        request: new Request('https://api.mistral.ai/v1/chat/completions', { method: 'POST' }),
        body: '{}',
      });
    complete.mockRejectedValueOnce(rateLimited()).mockRejectedValueOnce(rateLimited());

    const response = await request(app)
      .post('/api/assistant/chat')
      .set('Origin', ORIGIN)
      .send(question);

    expect(response.status).toBe(503);
    expect(response.body.error).toContain('busy');
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

describe('understanding how customers describe what they want', () => {
  const shopColours = ['Black', 'Navy', 'Midnight', 'Dusty rose'];

  it('maps everyday and Roman Urdu colour words to the shop colours', () => {
    expect(matchColours('navy blue', shopColours)).toEqual(['Navy', 'Midnight']);
    expect(matchColours('neela', shopColours)).toEqual(['Navy', 'Midnight']);
    expect(matchColours('pink', shopColours)).toEqual(['Dusty rose']);
    expect(matchColours('kala', shopColours)).toEqual(['Black']);
    expect(matchColours('emerald', shopColours)).toEqual([]);
  });

  const navyCard = {
    ...card,
    id: 'product_2',
    slug: 'noor-nida-everyday-abaya',
    name: 'Noor Nida Everyday Abaya',
  };
  const navyDetails = [
    {
      id: 'product_2',
      fabric: 'Korean Nida matte',
      variants: [
        {
          name: 'Navy',
          kind: 'COLOR',
          priceDelta: 0,
          trackInventory: true,
          stockOnHand: 4,
          stockReserved: 0,
        },
      ],
    },
  ];

  it('finds navy pieces when asked for a "navy blue dress"', async () => {
    prismaMock.product.findMany
      .mockResolvedValueOnce([navyCard])
      .mockResolvedValueOnce(navyDetails);
    prismaMock.product.count.mockResolvedValue(1);
    complete
      .mockResolvedValueOnce(callsTool('search_products', { query: 'navy blue dress' }))
      .mockResolvedValueOnce(says('Yes! The Noor Nida Everyday Abaya comes in Navy.'));

    const response = await request(app)
      .post('/api/assistant/chat')
      .set('Origin', ORIGIN)
      .send({ messages: [{ role: 'user', content: 'if you have navy blue dress in stock?' }] });

    expect(response.status).toBe(200);
    const where = JSON.stringify(prismaMock.product.findMany.mock.calls[0][0].where);
    expect(where).toContain('"Navy"');
    expect(where).toContain('"Midnight"');
    // "dress" is not searched for as if it were part of a product name.
    expect(where).not.toContain('dress');
    expect(response.body.products.map((p: { slug: string }) => p.slug)).toEqual([
      'noor-nida-everyday-abaya',
    ]);
    const result = JSON.parse(complete.mock.calls[1][0].messages.at(-1).content);
    expect(result.matchedColours).toEqual(['Midnight', 'Navy']);
  });

  it('broadens the search and says so when the words match nothing', async () => {
    prismaMock.product.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([navyCard])
      .mockResolvedValueOnce(navyDetails);
    prismaMock.product.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    complete
      .mockResolvedValueOnce(callsTool('search_products', { query: 'bridal', colors: ['navy'] }))
      .mockResolvedValueOnce(says('No bridal pieces, but the Noor Nida Everyday Abaya is navy.'));

    const response = await request(app)
      .post('/api/assistant/chat')
      .set('Origin', ORIGIN)
      .send(question);

    expect(response.status).toBe(200);
    const result = JSON.parse(complete.mock.calls[1][0].messages.at(-1).content);
    expect(result.note).toContain('Nothing matched "bridal"');
    expect(result.products).toHaveLength(1);
  });

  it('offers the real colours instead of searching for one the shop does not have', async () => {
    complete
      .mockResolvedValueOnce(callsTool('search_products', { query: 'emerald abaya' }))
      .mockResolvedValueOnce(says('We have no emerald, but we do have Black and Navy.'));

    const response = await request(app)
      .post('/api/assistant/chat')
      .set('Origin', ORIGIN)
      .send(question);

    expect(response.status).toBe(200);
    expect(prismaMock.product.findMany).not.toHaveBeenCalled();
    const result = JSON.parse(complete.mock.calls[1][0].messages.at(-1).content);
    expect(result.total).toBe(0);
    expect(result.coloursInStock).toEqual(['Black', 'Dusty rose', 'Midnight', 'Navy']);
  });
});
