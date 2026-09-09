/**
 * Order-independent serialisation, used to decide whether two cart lines are
 * configured identically.
 *
 * The naive version of this check is `JSON.stringify(a) === JSON.stringify(b)`,
 * which is wrong here and fails in production rather than in review. Postgres
 * `jsonb` does not preserve insertion order — it stores keys sorted by length
 * then bytewise — so a measurement set read back from the database serialises
 * as `{"bust":38,"shoulder":15,...}` while the freshly-validated object
 * serialises in template order as `{"abayaLength":56,"bust":38,...}`. The two
 * are logically identical and compare unequal, so adding the same garment
 * twice creates two cart lines instead of incrementing one.
 *
 * Sorting keys at every level makes the comparison depend on content alone.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    // Array order IS meaningful, so it is preserved.
    return value.map(canonicalize);
  }

  const entries = Object.entries(value as Record<string, unknown>)
    // `undefined` disappears under JSON.stringify anyway; dropping it here
    // keeps `{a: 1}` and `{a: 1, b: undefined}` comparing equal.
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const out: Record<string, unknown> = {};
  for (const [key, item] of entries) out[key] = canonicalize(item);
  return out;
}

/** True when two values are structurally equal, ignoring key order. */
export function deepEqualIgnoringKeyOrder(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}
