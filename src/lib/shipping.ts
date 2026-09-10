/**
 * Shipping zone resolution and tax rule selection.
 *
 * Pure functions over records the caller has already loaded (usually from the
 * cache in `src/lib/cache.ts`). Zone matching is intentionally simple and
 * explicit rather than clever: a store owner has to be able to reason about
 * why a customer in Hyderabad got a particular rate.
 */

export interface ShippingZoneRecord {
  id: string;
  name: string;
  country: string;
  cities: string[];
  states: string[];
  priority: number;
  isActive: boolean;
  rates: ShippingRateRecord[];
}

export interface ShippingRateRecord {
  id: string;
  zoneId: string;
  name: string;
  description: string | null;
  amount: number;
  freeAbove: number | null;
  codSurcharge: number;
  minDays: number;
  maxDays: number;
  isActive: boolean;
  position: number;
}

export interface ShippingDestination {
  country: string;
  state: string;
  city: string;
}

function normalise(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Picks the zone for a destination.
 *
 * Specificity wins over configured priority: a city rule beats a state rule,
 * which beats a country-wide catch-all. Within the same specificity, the
 * higher `priority` wins, then the first configured zone, so the result is
 * deterministic rather than dependent on database ordering.
 */
export function resolveShippingZone(
  zones: ShippingZoneRecord[],
  destination: ShippingDestination,
): ShippingZoneRecord | null {
  const country = normalise(destination.country);
  const state = normalise(destination.state);
  const city = normalise(destination.city);

  const candidates = zones
    .filter((z) => z.isActive && normalise(z.country) === country)
    .map((zone) => {
      const cityMatch = zone.cities.some((c) => normalise(c) === city);
      const stateMatch = zone.states.some((s) => normalise(s) === state);
      const isCatchAll = zone.cities.length === 0 && zone.states.length === 0;

      let specificity = -1;
      if (cityMatch) specificity = 3;
      else if (stateMatch) specificity = 2;
      else if (isCatchAll) specificity = 1;

      return { zone, specificity };
    })
    .filter((c) => c.specificity > 0);

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.specificity - a.specificity || b.zone.priority - a.zone.priority);

  return candidates[0].zone;
}

/** Active rates for a zone, cheapest-first within the configured order. */
export function availableRates(zone: ShippingZoneRecord | null): ShippingRateRecord[] {
  if (!zone) return [];
  return zone.rates
    .filter((r) => r.isActive)
    .sort((a, b) => a.position - b.position || a.amount - b.amount);
}

/**
 * Delivery window for a made-to-order garment: stitching time first, then
 * transit. Both ends are quoted so the customer sees a range, not a promise.
 */
export function estimateDelivery(
  rate: Pick<ShippingRateRecord, 'minDays' | 'maxDays'>,
  stitchingDays: number,
  from: Date,
): { earliest: Date; latest: Date } {
  const addBusinessDays = (start: Date, days: number): Date => {
    const d = new Date(start);
    let added = 0;
    while (added < days) {
      d.setDate(d.getDate() + 1);
      // Sunday is the only non-working day for Pakistani couriers.
      if (d.getDay() !== 0) added++;
    }
    return d;
  };

  return {
    earliest: addBusinessDays(from, stitchingDays + rate.minDays),
    latest: addBusinessDays(from, stitchingDays + rate.maxDays),
  };
}

// ── Tax ──────────────────────────────────────────────────────────────────────

export interface TaxRuleRecord {
  id: string;
  name: string;
  country: string;
  state: string | null;
  taxClass: string;
  rateBps: number;
  isInclusive: boolean;
  priority: number;
  isActive: boolean;
}

/**
 * Selects the applicable tax rules for a destination, one per tax class.
 *
 * A state-specific rule overrides the country-wide rule for the same class.
 * Anything else would mean a province with its own rate silently stacking on
 * top of the federal one.
 */
export function resolveTaxRules(
  rules: TaxRuleRecord[],
  destination: Pick<ShippingDestination, 'country' | 'state'>,
): TaxRuleRecord[] {
  const country = normalise(destination.country);
  const state = normalise(destination.state);

  const applicable = rules.filter(
    (r) =>
      r.isActive &&
      normalise(r.country) === country &&
      (r.state === null || normalise(r.state) === state),
  );

  const bestByClass = new Map<string, TaxRuleRecord>();

  for (const rule of applicable) {
    const current = bestByClass.get(rule.taxClass);
    if (!current) {
      bestByClass.set(rule.taxClass, rule);
      continue;
    }

    const ruleIsMoreSpecific = rule.state !== null && current.state === null;
    const sameSpecificity = (rule.state === null) === (current.state === null);

    if (ruleIsMoreSpecific || (sameSpecificity && rule.priority > current.priority)) {
      bestByClass.set(rule.taxClass, rule);
    }
  }

  return [...bestByClass.values()];
}

/**
 * Whether cash on delivery may be offered.
 *
 * COD carries real risk (refused parcels, cash handling), so it is restricted
 * to domestic orders under a configurable ceiling.
 */
export function codAvailable(
  destination: ShippingDestination,
  orderTotal: number,
  settings: { enabled: boolean; maxOrderTotal: number; countries: string[] },
): boolean {
  if (!settings.enabled) return false;
  if (orderTotal > settings.maxOrderTotal) return false;
  return settings.countries.map(normalise).includes(normalise(destination.country));
}
