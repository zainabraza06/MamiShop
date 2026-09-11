import { describe, expect, it } from 'vitest';
import {
  allocate,
  applyBps,
  clampNonNegative,
  formatMoney,
  fromMinorUnits,
  percentOf,
  sumMinor,
  toMinorUnits,
} from '../src/money';

describe('minor unit conversion', () => {
  it('converts major to minor units', () => {
    expect(toMinorUnits(1250.5)).toBe(125050);
    expect(toMinorUnits(0)).toBe(0);
    expect(toMinorUnits(0.01)).toBe(1);
  });

  it('rounds half away from zero, symmetrically for negatives', () => {
    // 0.125 is exactly representable in binary floating point, so this
    // genuinely exercises the half-way rounding rule rather than an artefact
    // of the literal's imprecision.
    expect(toMinorUnits(1.125)).toBe(113);
    expect(toMinorUnits(-1.125)).toBe(-113);
  });

  it('inherits the imprecision of a float argument, and rounds what it is given', () => {
    // 1.005 is really 1.00499...; Math.round therefore yields 100, not 101.
    // Documented rather than "fixed": the caller supplies a float, so the
    // ambiguity exists before this function is reached. Amounts that must be
    // exact are stored and passed as minor units and never round-trip here.
    expect(toMinorUnits(1.005)).toBe(100);
  });

  it('round-trips without drift', () => {
    for (const amount of [0, 1, 19.99, 1250.5, 99999.99]) {
      expect(fromMinorUnits(toMinorUnits(amount))).toBeCloseTo(amount, 2);
    }
  });

  it('rejects non-integer minor amounts', () => {
    expect(() => fromMinorUnits(10.5)).toThrow(TypeError);
    expect(() => sumMinor([1, 2.5])).toThrow(TypeError);
  });

  it('rejects non-finite input', () => {
    expect(() => toMinorUnits(Number.NaN)).toThrow(TypeError);
    expect(() => toMinorUnits(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});

describe('formatMoney', () => {
  it('omits decimals for whole amounts', () => {
    expect(formatMoney(125000)).not.toContain('.00');
  });

  it('shows decimals when there is a fractional part', () => {
    expect(formatMoney(125050)).toContain('.5');
  });

  it('can be forced to show decimals', () => {
    expect(formatMoney(125000, 'PKR', { showDecimals: true })).toContain('.00');
  });
});

describe('percentage arithmetic', () => {
  it('applies basis points', () => {
    expect(applyBps(100000, 1700)).toBe(17000);
    expect(applyBps(0, 1700)).toBe(0);
  });

  it('applies a percentage', () => {
    expect(percentOf(100000, 20)).toBe(20000);
    expect(percentOf(99999, 10)).toBe(10000);
  });

  it('never returns a fractional paisa', () => {
    for (let amount = 1; amount < 500; amount++) {
      expect(Number.isInteger(percentOf(amount, 33))).toBe(true);
    }
  });
});

describe('allocate', () => {
  it('distributes exactly, never losing or inventing a paisa', () => {
    const shares = allocate(1000, [1, 1, 1]);
    expect(sumMinor(shares)).toBe(1000);
    expect(shares).toEqual([334, 333, 333]);
  });

  it('respects weights', () => {
    const shares = allocate(1000, [3, 1]);
    expect(shares).toEqual([750, 250]);
    expect(sumMinor(shares)).toBe(1000);
  });

  it('handles zero weights without dividing by zero', () => {
    expect(allocate(1000, [0, 0])).toEqual([0, 0]);
  });

  it('handles an empty weight list', () => {
    expect(allocate(1000, [])).toEqual([]);
  });

  it('always sums back to the input across many shapes', () => {
    const cases: [number, number[]][] = [
      [1, [1, 1, 1]],
      [7, [2, 3, 5]],
      [99999, [1, 7, 13, 29]],
      [123456, [5, 5, 5, 5, 5, 5, 5]],
    ];
    for (const [total, weights] of cases) {
      expect(sumMinor(allocate(total, weights))).toBe(total);
    }
  });
});

describe('clampNonNegative', () => {
  it('floors at zero so a discount never creates credit', () => {
    expect(clampNonNegative(-500)).toBe(0);
    expect(clampNonNegative(500)).toBe(500);
  });
});
