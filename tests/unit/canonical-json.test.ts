import { describe, expect, it } from 'vitest';
import { canonicalJson, deepEqualIgnoringKeyOrder } from '@/lib/canonical-json';

describe('canonicalJson', () => {
  it('sorts object keys so serialisation depends only on content', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it('sorts nested objects too', () => {
    const a = { outer: { z: 1, a: 2 }, first: true };
    const b = { first: true, outer: { a: 2, z: 1 } };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('preserves array order, which is meaningful', () => {
    expect(canonicalJson([1, 2, 3])).not.toBe(canonicalJson([3, 2, 1]));
  });

  it('treats an explicitly undefined field as absent', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it('distinguishes null from undefined', () => {
    expect(canonicalJson({ a: null })).not.toBe(canonicalJson({}));
  });

  it('handles primitives and null', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(42)).toBe('42');
    expect(canonicalJson('abaya')).toBe('"abaya"');
  });
});

describe('deepEqualIgnoringKeyOrder', () => {
  /**
   * Regression test for a bug found by exercising the live API.
   *
   * Adding the same abaya twice created two cart lines instead of incrementing
   * one, because the merge check compared `JSON.stringify` of the stored value
   * against the freshly-validated one. Postgres jsonb returns keys in its own
   * order (shortest first, then bytewise), so the two strings differed even
   * though the measurements were identical.
   */
  it('matches a measurement set regardless of the key order jsonb returns', () => {
    // Order as written by the measurement template.
    const submitted = { abayaLength: 56, bust: 38, shoulder: 15, sleeveLength: 23 };
    // Order as Postgres jsonb hands it back: shorter keys first.
    const fromDatabase = { bust: 38, shoulder: 15, abayaLength: 56, sleeveLength: 23 };

    expect(JSON.stringify(submitted)).not.toBe(JSON.stringify(fromDatabase));
    expect(deepEqualIgnoringKeyOrder(submitted, fromDatabase)).toBe(true);
  });

  it('still separates genuinely different measurements', () => {
    const a = { abayaLength: 56, bust: 38 };
    const b = { abayaLength: 58, bust: 38 };
    expect(deepEqualIgnoringKeyOrder(a, b)).toBe(false);
  });

  it('separates a subset from a superset', () => {
    expect(deepEqualIgnoringKeyOrder({ bust: 38 }, { bust: 38, waist: 30 })).toBe(false);
  });

  it('treats two nulls as equal', () => {
    expect(deepEqualIgnoringKeyOrder(null, null)).toBe(true);
  });

  it('distinguishes a null snapshot from an empty one', () => {
    expect(deepEqualIgnoringKeyOrder(null, {})).toBe(false);
  });
});
