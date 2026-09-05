import { describe, expect, it } from 'vitest';
import {
  availableRates,
  codAvailable,
  estimateDelivery,
  resolveShippingZone,
  resolveTaxRules,
  type ShippingZoneRecord,
  type TaxRuleRecord,
} from '@/lib/shipping';

function rate(id: string, over: Partial<ShippingZoneRecord['rates'][number]> = {}) {
  return {
    id,
    zoneId: 'z',
    name: 'Standard',
    description: null,
    amount: 30_000,
    freeAbove: null,
    codSurcharge: 0,
    minDays: 3,
    maxDays: 5,
    isActive: true,
    position: 0,
    ...over,
  };
}

const zones: ShippingZoneRecord[] = [
  {
    id: 'z-national',
    name: 'Pakistan (rest of country)',
    country: 'PK',
    cities: [],
    states: [],
    priority: 0,
    isActive: true,
    rates: [rate('r-national', { amount: 35_000 })],
  },
  {
    id: 'z-punjab',
    name: 'Punjab',
    country: 'PK',
    cities: [],
    states: ['Punjab'],
    priority: 0,
    isActive: true,
    rates: [rate('r-punjab', { amount: 25_000 })],
  },
  {
    id: 'z-lahore',
    name: 'Lahore metro',
    country: 'PK',
    cities: ['Lahore'],
    states: [],
    priority: 0,
    isActive: true,
    rates: [rate('r-lahore', { amount: 15_000 })],
  },
];

describe('resolveShippingZone', () => {
  it('prefers a city match over a province match', () => {
    const zone = resolveShippingZone(zones, {
      country: 'PK',
      state: 'Punjab',
      city: 'Lahore',
    });
    expect(zone?.id).toBe('z-lahore');
  });

  it('falls back to the province zone', () => {
    const zone = resolveShippingZone(zones, {
      country: 'PK',
      state: 'Punjab',
      city: 'Faisalabad',
    });
    expect(zone?.id).toBe('z-punjab');
  });

  it('falls back to the country-wide catch-all', () => {
    const zone = resolveShippingZone(zones, {
      country: 'PK',
      state: 'Sindh',
      city: 'Karachi',
    });
    expect(zone?.id).toBe('z-national');
  });

  it('matches case-insensitively and ignores surrounding spaces', () => {
    const zone = resolveShippingZone(zones, {
      country: 'pk',
      state: ' punjab ',
      city: '  LAHORE ',
    });
    expect(zone?.id).toBe('z-lahore');
  });

  it('returns null for an unserved country', () => {
    expect(
      resolveShippingZone(zones, { country: 'FR', state: 'Paris', city: 'Paris' }),
    ).toBeNull();
  });

  it('skips inactive zones', () => {
    const inactive = zones.map((z) =>
      z.id === 'z-lahore' ? { ...z, isActive: false } : z,
    );
    const zone = resolveShippingZone(inactive, {
      country: 'PK',
      state: 'Punjab',
      city: 'Lahore',
    });
    expect(zone?.id).toBe('z-punjab');
  });

  it('breaks a same-specificity tie on priority, deterministically', () => {
    const tied: ShippingZoneRecord[] = [
      { ...zones[0], id: 'a', priority: 1 },
      { ...zones[0], id: 'b', priority: 5 },
    ];
    expect(
      resolveShippingZone(tied, { country: 'PK', state: 'Sindh', city: 'Karachi' })?.id,
    ).toBe('b');
  });
});

describe('availableRates', () => {
  it('returns nothing for a null zone', () => {
    expect(availableRates(null)).toEqual([]);
  });

  it('orders by position then price, and drops inactive rates', () => {
    const zone: ShippingZoneRecord = {
      ...zones[0],
      rates: [
        rate('slow', { amount: 20_000, position: 1 }),
        rate('express', { amount: 60_000, position: 0 }),
        rate('gone', { amount: 100, position: 0, isActive: false }),
      ],
    };
    expect(availableRates(zone).map((r) => r.id)).toEqual(['express', 'slow']);
  });
});

describe('estimateDelivery', () => {
  it('adds stitching time before transit time', () => {
    // Monday 1 June 2026.
    const from = new Date('2026-06-01T00:00:00Z');
    const { earliest, latest } = estimateDelivery({ minDays: 3, maxDays: 5 }, 7, from);
    expect(earliest.getTime()).toBeGreaterThan(from.getTime());
    expect(latest.getTime()).toBeGreaterThan(earliest.getTime());
  });

  it('never lands a delivery estimate on a Sunday', () => {
    const from = new Date('2026-06-01T00:00:00Z');
    for (let days = 1; days <= 20; days++) {
      const { earliest, latest } = estimateDelivery({ minDays: days, maxDays: days + 2 }, 3, from);
      expect(earliest.getDay()).not.toBe(0);
      expect(latest.getDay()).not.toBe(0);
    }
  });
});

describe('resolveTaxRules', () => {
  const rules: TaxRuleRecord[] = [
    {
      id: 't-country',
      name: 'GST',
      country: 'PK',
      state: null,
      taxClass: 'STANDARD',
      rateBps: 1700,
      isInclusive: true,
      priority: 0,
      isActive: true,
    },
    {
      id: 't-sindh',
      name: 'Sindh GST',
      country: 'PK',
      state: 'Sindh',
      taxClass: 'STANDARD',
      rateBps: 1500,
      isInclusive: true,
      priority: 0,
      isActive: true,
    },
    {
      id: 't-zero',
      name: 'Zero rated',
      country: 'PK',
      state: null,
      taxClass: 'ZERO',
      rateBps: 0,
      isInclusive: true,
      priority: 0,
      isActive: true,
    },
  ];

  it('lets a province rule override the national rule', () => {
    const resolved = resolveTaxRules(rules, { country: 'PK', state: 'Sindh' });
    const standard = resolved.find((r) => r.taxClass === 'STANDARD');
    expect(standard?.id).toBe('t-sindh');
  });

  it('does not stack the province rule on top of the national one', () => {
    const resolved = resolveTaxRules(rules, { country: 'PK', state: 'Sindh' });
    expect(resolved.filter((r) => r.taxClass === 'STANDARD')).toHaveLength(1);
  });

  it('uses the national rule elsewhere', () => {
    const resolved = resolveTaxRules(rules, { country: 'PK', state: 'Punjab' });
    expect(resolved.find((r) => r.taxClass === 'STANDARD')?.id).toBe('t-country');
  });

  it('returns one rule per tax class', () => {
    const resolved = resolveTaxRules(rules, { country: 'PK', state: 'Punjab' });
    expect(new Set(resolved.map((r) => r.taxClass)).size).toBe(resolved.length);
    expect(resolved).toHaveLength(2);
  });

  it('ignores inactive rules', () => {
    const disabled = rules.map((r) => ({ ...r, isActive: false }));
    expect(resolveTaxRules(disabled, { country: 'PK', state: 'Sindh' })).toEqual([]);
  });

  it('returns nothing for an unconfigured country', () => {
    expect(resolveTaxRules(rules, { country: 'GB', state: 'London' })).toEqual([]);
  });
});

describe('codAvailable', () => {
  const settings = { enabled: true, maxOrderTotal: 5_000_000, countries: ['PK'] };
  const destination = { country: 'PK', state: 'Punjab', city: 'Lahore' };

  it('permits COD for a domestic order under the ceiling', () => {
    expect(codAvailable(destination, 1_000_000, settings)).toBe(true);
  });

  it('refuses COD above the ceiling', () => {
    expect(codAvailable(destination, 6_000_000, settings)).toBe(false);
  });

  it('refuses COD for an unsupported country', () => {
    expect(codAvailable({ ...destination, country: 'AE' }, 100_000, settings)).toBe(false);
  });

  it('respects the global switch', () => {
    expect(codAvailable(destination, 100_000, { ...settings, enabled: false })).toBe(false);
  });
});
