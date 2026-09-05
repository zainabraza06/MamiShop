/**
 * Money handling.
 *
 * Every amount in the system is an INTEGER in the currency's minor unit
 * (paisa for PKR, cents for USD). Floating point is never used for money:
 * 0.1 + 0.2 !== 0.3, and a store that drifts by a paisa per line item
 * eventually fails reconciliation.
 */

export const SUPPORTED_CURRENCIES = ['PKR', 'USD', 'GBP', 'AED', 'SAR'] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

/** Digits after the decimal point for each supported currency. */
const MINOR_UNIT_DIGITS: Record<Currency, number> = {
  PKR: 2,
  USD: 2,
  GBP: 2,
  AED: 2,
  SAR: 2,
};

const LOCALE_BY_CURRENCY: Record<Currency, string> = {
  PKR: 'en-PK',
  USD: 'en-US',
  GBP: 'en-GB',
  AED: 'en-AE',
  SAR: 'en-SA',
};

export function isSupportedCurrency(value: string): value is Currency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

function factor(currency: Currency): number {
  return 10 ** MINOR_UNIT_DIGITS[currency];
}

function assertInteger(value: number): void {
  if (!Number.isInteger(value)) {
    throw new TypeError(`Money amounts must be integers in minor units, received ${value}`);
  }
}

/**
 * 1250.5 -> 125050 (PKR). Rounds half away from zero, like a cash register.
 *
 * This is a boundary conversion, used where a human typed a decimal price.
 * It inherits whatever imprecision the float argument already carries — 1.005
 * is really 1.00499..., so it becomes 100, not 101. That ambiguity exists
 * before this function is called; internally every amount stays an integer in
 * minor units and never round-trips through a float.
 */
export function toMinorUnits(amount: number, currency: Currency = 'PKR'): number {
  if (!Number.isFinite(amount)) throw new TypeError('Amount must be a finite number');
  const scaled = amount * factor(currency);
  return scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
}

/** 125050 -> 1250.5 (PKR). For display and gateway payloads only. */
export function fromMinorUnits(minor: number, currency: Currency = 'PKR'): number {
  assertInteger(minor);
  return minor / factor(currency);
}

/**
 * Formats minor units for display, e.g. 125050 -> "Rs 1,250.50".
 * Whole amounts drop the decimals - Pakistani retail rarely shows ".00".
 */
export function formatMoney(
  minor: number,
  currency: Currency = 'PKR',
  options: { locale?: string; showDecimals?: boolean } = {},
): string {
  assertInteger(minor);
  const digits = MINOR_UNIT_DIGITS[currency];
  const showDecimals = options.showDecimals ?? minor % factor(currency) !== 0;

  return new Intl.NumberFormat(options.locale ?? LOCALE_BY_CURRENCY[currency], {
    style: 'currency',
    currency,
    minimumFractionDigits: showDecimals ? digits : 0,
    maximumFractionDigits: showDecimals ? digits : 0,
  }).format(fromMinorUnits(minor, currency));
}

/**
 * Applies a percentage in basis points (1700 = 17%) to a minor-unit amount.
 * Integer arithmetic throughout, rounding half-up on the final division.
 */
export function applyBps(minor: number, bps: number): number {
  assertInteger(minor);
  if (!Number.isInteger(bps)) throw new TypeError('Basis points must be an integer');
  return Math.round((minor * bps) / 10_000);
}

/** Percentage discount where `percent` is 0-100. */
export function percentOf(minor: number, percent: number): number {
  return applyBps(minor, Math.round(percent * 100));
}

export function sumMinor(values: readonly number[]): number {
  return values.reduce((total, value) => {
    assertInteger(value);
    return total + value;
  }, 0);
}

/** Clamps to a non-negative amount - a discount must never create credit. */
export function clampNonNegative(minor: number): number {
  return minor < 0 ? 0 : minor;
}

/**
 * Splits an amount across parts without losing or inventing a paisa.
 * Used when apportioning an order-level discount across line items.
 * The remainder is distributed one minor unit at a time to the earliest parts,
 * so the sum of the shares always equals the input exactly.
 */
export function allocate(minor: number, weights: readonly number[]): number[] {
  assertInteger(minor);
  if (weights.length === 0) return [];

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) return weights.map(() => 0);

  const shares = weights.map((w) => Math.floor((minor * w) / totalWeight));
  let remainder = minor - shares.reduce((a, b) => a + b, 0);

  for (let i = 0; remainder > 0; i = (i + 1) % shares.length) {
    shares[i] += 1;
    remainder -= 1;
  }
  return shares;
}
