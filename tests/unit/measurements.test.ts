import { describe, expect, it } from 'vitest';
import {
  cmToInch,
  convertValues,
  describeMeasurements,
  fieldsFor,
  inchToCm,
  requiresMeasurements,
  TEMPLATES,
  validateMeasurements,
  type MeasurementTemplateKey,
} from '@/lib/measurements';

/** Every required field on the women's template: shirt group plus trouser group. */
const validWomens = {
  shirtLength: 38,
  bust: 36,
  waist: 30,
  hips: 38,
  shoulder: 14,
  sleeveLength: 21,
  trouserLength: 38,
  trouserWaist: 32,
};

describe('unit conversion', () => {
  it('converts inches to centimetres and back', () => {
    expect(inchToCm(10)).toBe(25.4);
    expect(cmToInch(25.4)).toBe(10);
  });

  it('round-trips within a tenth', () => {
    for (const inches of [12, 24, 36.5, 56]) {
      expect(cmToInch(inchToCm(inches))).toBeCloseTo(inches, 1);
    }
  });

  it('converts a whole measurement set', () => {
    const cm = convertValues({ bust: 36, waist: 30 }, 'INCH', 'CM');
    expect(cm).toEqual({ bust: 91.4, waist: 76.2 });
  });

  it('returns a copy unchanged when units match', () => {
    const values = { bust: 36 };
    const result = convertValues(values, 'INCH', 'INCH');
    expect(result).toEqual(values);
    expect(result).not.toBe(values);
  });
});

describe('templates', () => {
  it('defines every template referenced by the enum', () => {
    const keys: MeasurementTemplateKey[] = [
      'WOMENS_STITCHED',
      'GIRLS_STITCHED',
      'BOYS_STITCHED',
      'ABAYA',
      'STOLE',
    ];
    for (const key of keys) expect(TEMPLATES[key]).toBeDefined();
  });

  it('gives stoles no measurement fields', () => {
    expect(fieldsFor('STOLE')).toHaveLength(0);
    expect(requiresMeasurements('STOLE')).toBe(false);
  });

  it('requires measurements for every stitched template', () => {
    for (const key of ['WOMENS_STITCHED', 'GIRLS_STITCHED', 'BOYS_STITCHED', 'ABAYA'] as const) {
      expect(requiresMeasurements(key)).toBe(true);
    }
  });

  it('gives every field a sane range, help text and diagram anchor', () => {
    for (const template of Object.values(TEMPLATES)) {
      for (const field of template.groups.flatMap((g) => g.fields)) {
        // growthAllowance legitimately starts at 0 ("add no extra length").
        expect(field.minInch).toBeGreaterThanOrEqual(0);
        expect(field.maxInch).toBeGreaterThan(field.minInch);
        expect(field.placeholderInch).toBeGreaterThanOrEqual(field.minInch);
        expect(field.placeholderInch).toBeLessThanOrEqual(field.maxInch);
        expect(field.help.length).toBeGreaterThan(10);
        expect(field.diagramRef).toBeTruthy();
      }
    }
  });

  it('uses unique field keys within a template', () => {
    for (const template of Object.values(TEMPLATES)) {
      const keys = template.groups.flatMap((g) => g.fields).map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe('validateMeasurements', () => {
  it('accepts a complete valid set', () => {
    const result = validateMeasurements('WOMENS_STITCHED', validWomens, 'INCH');
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.normalised.bust).toBe(36);
  });

  it('reports every missing required field at once', () => {
    const result = validateMeasurements('WOMENS_STITCHED', {}, 'INCH');
    expect(result.ok).toBe(false);
    // Eight required fields: six on the shirt, two on the trouser.
    expect(result.issues).toHaveLength(8);
  });

  it('allows optional fields to be omitted', () => {
    const result = validateMeasurements('WOMENS_STITCHED', validWomens, 'INCH');
    expect(result.ok).toBe(true);
    expect(result.normalised.armhole).toBeUndefined();
  });

  it('catches the classic 36 -> 360 typo', () => {
    const result = validateMeasurements(
      'WOMENS_STITCHED',
      { ...validWomens, bust: 360 },
      'INCH',
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.field === 'bust')).toBe(true);
  });

  it('rejects zero and negative values', () => {
    for (const bad of [0, -5]) {
      const result = validateMeasurements(
        'WOMENS_STITCHED',
        { ...validWomens, bust: bad },
        'INCH',
      );
      expect(result.ok).toBe(false);
    }
  });

  it('rejects non-numeric input', () => {
    const result = validateMeasurements(
      'WOMENS_STITCHED',
      { ...validWomens, bust: 'thirty-six' },
      'INCH',
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('must be a number'))).toBe(true);
  });

  it('coerces numeric strings from HTML inputs', () => {
    const result = validateMeasurements(
      'WOMENS_STITCHED',
      { ...validWomens, bust: '36' },
      'INCH',
    );
    expect(result.ok).toBe(true);
    expect(result.normalised.bust).toBe(36);
  });

  it('applies inch ranges correctly to centimetre input', () => {
    const cmValues = convertValues(validWomens, 'INCH', 'CM');
    const result = validateMeasurements('WOMENS_STITCHED', cmValues, 'CM');
    expect(result.ok).toBe(true);
  });

  it('rejects a centimetre value entered as if it were inches', () => {
    // The whole set has to be in one unit, so convert first and then vary bust.
    const inCm = convertValues(validWomens, 'INCH', 'CM');

    // A 91cm bust is an ordinary measurement.
    expect(validateMeasurements('WOMENS_STITCHED', { ...inCm, bust: 91 }, 'CM').ok).toBe(true);

    // The same number read as 91 *inches* is not a human bust measurement,
    // which is exactly the mistake the unit toggle is there to prevent.
    const asInches = validateMeasurements(
      'WOMENS_STITCHED',
      { ...validWomens, bust: 91 },
      'INCH',
    );
    expect(asInches.ok).toBe(false);
    expect(asInches.issues.some((i) => i.field === 'bust')).toBe(true);
  });

  it('rounds stored values to one decimal', () => {
    const result = validateMeasurements(
      'WOMENS_STITCHED',
      { ...validWomens, bust: 36.26 },
      'INCH',
    );
    expect(result.normalised.bust).toBe(36.3);
  });

  it('accepts a stole with no values at all', () => {
    expect(validateMeasurements('STOLE', {}, 'INCH').ok).toBe(true);
  });
});

describe('cross-field checks', () => {
  it('flags a sleeve longer than the shirt', () => {
    const result = validateMeasurements(
      'WOMENS_STITCHED',
      { ...validWomens, shirtLength: 20, sleeveLength: 30 },
      'INCH',
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.field === 'sleeveLength')).toBe(true);
  });

  it('flags a sleeve opening wider than the armhole', () => {
    const result = validateMeasurements(
      'WOMENS_STITCHED',
      { ...validWomens, armhole: 16, sleeveOpening: 19 },
      'INCH',
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.field === 'sleeveOpening')).toBe(true);
  });

  it('flags a waist implausibly larger than the hips', () => {
    const result = validateMeasurements(
      'WOMENS_STITCHED',
      { ...validWomens, waist: 52, hips: 38 },
      'INCH',
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.field === 'waist')).toBe(true);
  });

  it('permits a waist modestly larger than the hips', () => {
    const result = validateMeasurements(
      'WOMENS_STITCHED',
      { ...validWomens, waist: 42, hips: 38 },
      'INCH',
    );
    expect(result.ok).toBe(true);
  });

  it('applies the waist/hip tolerance in centimetres too', () => {
    const cm = convertValues({ ...validWomens, waist: 42, hips: 38 }, 'INCH', 'CM');
    expect(validateMeasurements('WOMENS_STITCHED', cm, 'CM').ok).toBe(true);
  });

  it('flags an abaya sleeve longer than the abaya', () => {
    const result = validateMeasurements(
      'ABAYA',
      { abayaLength: 44, bust: 38, shoulder: 15, sleeveLength: 45 },
      'INCH',
    );
    expect(result.ok).toBe(false);
  });
});

describe('describeMeasurements', () => {
  it('summarises a set for the tailor worksheet', () => {
    const summary = describeMeasurements('WOMENS_STITCHED', validWomens, 'INCH');
    expect(summary).toContain('Bust 36in');
    expect(summary).toContain('Shirt length 38in');
  });

  it('uses the correct unit suffix', () => {
    expect(describeMeasurements('WOMENS_STITCHED', { bust: 91.4 }, 'CM')).toContain('91.4cm');
  });

  it('omits fields that were not supplied', () => {
    expect(describeMeasurements('WOMENS_STITCHED', { bust: 36 }, 'INCH')).toBe('Bust 36in');
  });
});
