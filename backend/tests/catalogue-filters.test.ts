import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Storefront filtering.
 *
 * What matters: a colour filter that actually narrows by the product's live
 * colour options, a query string that works whether one value or several are
 * sent, and a facet list that only offers choices which can return something.
 */

const prismaMock = vi.hoisted(() => ({
  product: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
    aggregate: vi.fn(),
  },
  productVariant: { groupBy: vi.fn() },
}));

vi.mock('../src/lib/db', () => ({ prisma: prismaMock }));

import { createApp } from '../src/app';
import { __setStoreForTesting } from '../src/lib/redis';

const app = createApp({ appUrl: 'http://localhost:3000', corsOrigins: [], trustProxy: 'false' });

beforeEach(() => {
  vi.clearAllMocks();
  __setStoreForTesting(null);
  prismaMock.product.findMany.mockResolvedValue([]);
  prismaMock.product.count.mockResolvedValue(0);
});

function lastWhere() {
  return prismaMock.product.findMany.mock.calls[0][0].where;
}

describe('filtering the listing', () => {
  it('narrows by any of the ticked colours, among live colour options only', async () => {
    const response = await request(app).get('/api/products?colors=Black&colors=Navy');

    expect(response.status).toBe(200);
    const { some } = lastWhere().variants;
    expect(some).toMatchObject({ kind: 'COLOR', isActive: true });
    expect(some.OR).toEqual([
      { name: { equals: 'Black', mode: 'insensitive' } },
      { name: { equals: 'Navy', mode: 'insensitive' } },
    ]);
  });

  it('accepts a single colour sent as a plain value', async () => {
    const response = await request(app).get('/api/products?colors=Black');

    expect(response.status).toBe(200);
    expect(lastWhere().variants.some.OR).toHaveLength(1);
  });

  it('combines fabrics and fit without clobbering a search', async () => {
    const response = await request(app).get(
      '/api/products?fabrics=Georgette&fabrics=Raw%20silk&fit=ready-made&q=stole',
    );

    expect(response.status).toBe(200);
    const where = lastWhere();
    expect(where.AND[0].OR).toHaveLength(2);
    expect(where.requiresMeasurements).toBe(false);
    // The search keeps its own OR; fabrics live under AND so neither overwrites the other.
    expect(where.OR).toBeDefined();
  });

  it('never lets a filter reveal a draft or archived product', async () => {
    await request(app).get('/api/products?colors=Black&fit=made-to-measure');

    expect(lastWhere()).toMatchObject({ status: 'ACTIVE', archivedAt: null });
  });
});

describe('the facet list', () => {
  beforeEach(() => {
    prismaMock.productVariant.groupBy.mockResolvedValue([
      { name: 'Black', colorHex: '#14110F', _count: { _all: 3 } },
      { name: 'black', colorHex: null, _count: { _all: 1 } },
      { name: 'Navy', colorHex: '#1B2A3A', _count: { _all: 2 } },
    ]);
    prismaMock.product.groupBy.mockImplementation(async (args: { by: string[] }) =>
      args.by[0] === 'fabric'
        ? [
            { fabric: 'Georgette', _count: { _all: 2 } },
            { fabric: null, _count: { _all: 1 } },
          ]
        : [
            { requiresMeasurements: true, _count: { _all: 4 } },
            { requiresMeasurements: false, _count: { _all: 2 } },
          ],
    );
    prismaMock.product.aggregate.mockResolvedValue({
      _min: { basePrice: 150_000 },
      _max: { basePrice: 1_250_000 },
    });
  });

  it('is served by its own route rather than read as a product slug', async () => {
    const response = await request(app).get('/api/products/facets');

    expect(response.status).toBe(200);
    expect(prismaMock.product.findFirst).not.toHaveBeenCalled();
  });

  it('merges one colour spelled two ways, and drops products with no fabric', async () => {
    const response = await request(app).get('/api/products/facets?category=abayas');

    expect(response.body.colors).toEqual([
      { name: 'Black', hex: '#14110F', count: 4 },
      { name: 'Navy', hex: '#1B2A3A', count: 2 },
    ]);
    expect(response.body.fabrics).toEqual([{ name: 'Georgette', count: 2 }]);
    expect(response.body.price).toEqual({ min: 150_000, max: 1_250_000 });
    expect(response.body.fits).toEqual({ madeToMeasure: 4, readyMade: 2 });
  });

  it('is scoped to the category, not to the filters already applied', async () => {
    await request(app).get('/api/products/facets?category=abayas&colors=Black');

    // Ticking Black must not make every other colour vanish from the panel.
    const where = prismaMock.productVariant.groupBy.mock.calls[0][0].where.product;
    expect(where.category).toBeDefined();
    expect(where.variants).toBeUndefined();
  });
});
