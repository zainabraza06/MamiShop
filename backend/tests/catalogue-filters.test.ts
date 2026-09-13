import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Storefront filtering.
 *
 * What matters: a colour filter that actually narrows by the product's live
 * colour options, custom filters that widen within a filter and narrow across
 * filters, and a panel that follows the order and names staff set while only
 * offering choices which can return something.
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
  storefrontFilter: { findMany: vi.fn() },
  productFilterValue: { groupBy: vi.fn() },
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

  it('widens within a custom filter and narrows across custom filters', async () => {
    const response = await request(app).get(
      '/api/products?attrs=occasion:eid&attrs=occasion:wedding&attrs=work:embroidered',
    );

    expect(response.status).toBe(200);
    // Eid or Wedding, and Embroidered.
    expect(lastWhere().AND).toEqual([
      {
        filterValues: {
          some: { option: { slug: { in: ['eid', 'wedding'] }, filter: { slug: 'occasion' } } },
        },
      },
      {
        filterValues: {
          some: { option: { slug: { in: ['embroidered'] }, filter: { slug: 'work' } } },
        },
      },
    ]);
  });

  it('rejects a custom filter value that is not a filter:option pair', async () => {
    const response = await request(app).get('/api/products?attrs=occasion');

    expect(response.status).toBe(422);
    expect(prismaMock.product.findMany).not.toHaveBeenCalled();
  });

  it('never lets a filter reveal a draft or archived product', async () => {
    await request(app).get('/api/products?colors=Black&fit=made-to-measure&attrs=occasion:eid');

    expect(lastWhere()).toMatchObject({ status: 'ACTIVE', archivedAt: null });
  });
});

describe('the filter panel', () => {
  beforeEach(() => {
    // The order and names staff chose, deliberately not the default.
    prismaMock.storefrontFilter.findMany.mockResolvedValue([
      { kind: 'FABRIC', label: 'Fabric', slug: 'fabric', options: [] },
      { kind: 'COLOR', label: 'Shade', slug: 'color', options: [] },
      { kind: 'PRICE', label: 'Price (Rs)', slug: 'price', options: [] },
      { kind: 'FIT', label: 'Fit', slug: 'fit', options: [] },
      {
        kind: 'ATTRIBUTE',
        label: 'Occasion',
        slug: 'occasion',
        options: [
          { id: 'opt_eid', label: 'Eid', slug: 'eid' },
          { id: 'opt_wedding', label: 'Wedding', slug: 'wedding' },
        ],
      },
    ]);
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
    prismaMock.productFilterValue.groupBy.mockResolvedValue([
      { optionId: 'opt_eid', _count: { _all: 3 } },
    ]);
  });

  it('is served by its own route rather than read as a product slug', async () => {
    const response = await request(app).get('/api/products/facets');

    expect(response.status).toBe(200);
    expect(prismaMock.product.findFirst).not.toHaveBeenCalled();
  });

  it('follows the order and names staff set, and asks only for visible filters', async () => {
    const response = await request(app).get('/api/products/facets?category=abayas');

    expect(response.body.filters.map((group: { label: string }) => group.label)).toEqual([
      'Fabric',
      'Shade',
      'Price (Rs)',
      'Fit',
      'Occasion',
    ]);
    expect(prismaMock.storefrontFilter.findMany.mock.calls[0][0].where).toEqual({
      isVisible: true,
    });
  });

  it('merges one colour spelled two ways, and drops products with no fabric', async () => {
    const response = await request(app).get('/api/products/facets');
    const [fabric, colour, price, fit] = response.body.filters;

    expect(fabric).toEqual({
      kind: 'FABRIC',
      label: 'Fabric',
      fabrics: [{ name: 'Georgette', count: 2 }],
    });
    expect(colour.colors).toEqual([
      { name: 'Black', hex: '#14110F', count: 4 },
      { name: 'Navy', hex: '#1B2A3A', count: 2 },
    ]);
    expect(price).toMatchObject({ min: 150_000, max: 1_250_000 });
    expect(fit).toMatchObject({ madeToMeasure: 4, readyMade: 2 });
  });

  it('offers only the custom options some product in view carries', async () => {
    const response = await request(app).get('/api/products/facets');
    const occasion = response.body.filters.at(-1);

    expect(occasion).toEqual({
      kind: 'ATTRIBUTE',
      label: 'Occasion',
      slug: 'occasion',
      options: [{ label: 'Eid', slug: 'eid', count: 3 }],
    });
  });

  it('leaves out a group with nothing to offer', async () => {
    prismaMock.productFilterValue.groupBy.mockResolvedValue([]);
    prismaMock.product.groupBy.mockImplementation(async (args: { by: string[] }) =>
      args.by[0] === 'fabric' ? [] : [{ requiresMeasurements: true, _count: { _all: 6 } }],
    );

    const response = await request(app).get('/api/products/facets');
    const kinds = response.body.filters.map((group: { kind: string }) => group.kind);

    // No tagged products, no fabrics, and no choice to make between fits.
    expect(kinds).toEqual(['COLOR', 'PRICE']);
  });

  it('is scoped to the category, not to the filters already applied', async () => {
    await request(app).get('/api/products/facets?category=abayas&colors=Black');

    // Ticking Black must not make every other colour vanish from the panel.
    const where = prismaMock.productVariant.groupBy.mock.calls[0][0].where.product;
    expect(where.category).toBeDefined();
    expect(where.variants).toBeUndefined();
  });
});
