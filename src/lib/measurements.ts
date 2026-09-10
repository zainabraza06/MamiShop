import { z } from 'zod';

/**
 * Made-to-measure sizing.
 *
 * MomiShop sells no S/M/L. Every stitched garment is cut to a customer's own
 * measurements, so this module is the single source of truth for:
 *   - which fields each garment type needs,
 *   - the plausible range for each field (a typo here becomes wasted fabric),
 *   - how a measurement is explained to a shopper who has never used a tape,
 *   - unit conversion between inches and centimetres.
 *
 * Ranges are stored in INCHES and converted on demand. They are deliberately
 * wide: the goal is to catch "36" typed as "360", not to police body size.
 * Rejecting a real customer's real measurement is a much worse failure than
 * letting an unusual-but-possible value through to a human tailor.
 */

export const MEASUREMENT_TEMPLATES = [
  'WOMENS_STITCHED',
  'GIRLS_STITCHED',
  'BOYS_STITCHED',
  'ABAYA',
  'STOLE',
] as const;

export type MeasurementTemplateKey = (typeof MEASUREMENT_TEMPLATES)[number];

export type MeasurementUnitKey = 'INCH' | 'CM';

export interface MeasurementField {
  key: string;
  label: string;
  /** Plain-language instruction shown under the input. */
  help: string;
  /** Anchor into the on-page measuring diagram (see MeasurementGuide). */
  diagramRef: string;
  minInch: number;
  maxInch: number;
  required: boolean;
  /** Typical starting value, used as a placeholder rather than a default. */
  placeholderInch: number;
}

export interface MeasurementTemplate {
  key: MeasurementTemplateKey;
  label: string;
  /** Bumped when fields change, so stored profiles can be migrated knowingly. */
  version: number;
  description: string;
  groups: { title: string; fields: MeasurementField[] }[];
}

const CM_PER_INCH = 2.54;

export function inchToCm(inches: number): number {
  return Math.round(inches * CM_PER_INCH * 10) / 10;
}

export function cmToInch(cm: number): number {
  return Math.round((cm / CM_PER_INCH) * 10) / 10;
}

export function convertValue(value: number, from: MeasurementUnitKey, to: MeasurementUnitKey) {
  if (from === to) return value;
  return from === 'INCH' ? inchToCm(value) : cmToInch(value);
}

/** Converts a whole measurement set between units, rounding to 1 decimal. */
export function convertValues(
  values: Record<string, number>,
  from: MeasurementUnitKey,
  to: MeasurementUnitKey,
): Record<string, number> {
  if (from === to) return { ...values };
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, convertValue(value, from, to)]),
  );
}

// ── Field definitions ────────────────────────────────────────────────────────

const womensFields: MeasurementTemplate['groups'] = [
  {
    title: 'Shirt / Kameez',
    fields: [
      {
        key: 'shirtLength',
        label: 'Shirt length',
        help: 'From the highest point of your shoulder straight down to where you want the shirt to end.',
        diagramRef: 'shirt-length',
        minInch: 20,
        maxInch: 60,
        required: true,
        placeholderInch: 38,
      },
      {
        key: 'bust',
        label: 'Bust',
        help: 'Around the fullest part of your chest, keeping the tape level and relaxed.',
        diagramRef: 'bust',
        minInch: 24,
        maxInch: 66,
        required: true,
        placeholderInch: 36,
      },
      {
        key: 'waist',
        label: 'Waist',
        help: 'Around your natural waistline — the narrowest part, usually just above the navel.',
        diagramRef: 'waist',
        minInch: 20,
        maxInch: 66,
        required: true,
        placeholderInch: 30,
      },
      {
        key: 'hips',
        label: 'Hips',
        help: 'Around the fullest part of your hips, roughly 8 inches below the waist.',
        diagramRef: 'hips',
        minInch: 26,
        maxInch: 72,
        required: true,
        placeholderInch: 38,
      },
      {
        key: 'shoulder',
        label: 'Shoulder',
        help: 'Straight across your back, from the tip of one shoulder to the other.',
        diagramRef: 'shoulder',
        minInch: 10,
        maxInch: 26,
        required: true,
        placeholderInch: 14,
      },
      {
        key: 'sleeveLength',
        label: 'Sleeve length',
        help: 'From the shoulder tip down the arm to where you want the sleeve to finish.',
        diagramRef: 'sleeve-length',
        minInch: 4,
        maxInch: 30,
        required: true,
        placeholderInch: 21,
      },
      {
        key: 'armhole',
        label: 'Armhole',
        help: 'Around the top of your arm where it meets the shoulder, with the tape comfortably loose.',
        diagramRef: 'armhole',
        minInch: 10,
        maxInch: 28,
        required: false,
        placeholderInch: 16,
      },
      {
        key: 'sleeveOpening',
        label: 'Sleeve opening',
        help: 'Around your wrist or forearm, wherever the sleeve ends.',
        diagramRef: 'sleeve-opening',
        minInch: 6,
        maxInch: 20,
        required: false,
        placeholderInch: 9,
      },
      {
        key: 'neckDepthFront',
        label: 'Front neck depth',
        help: 'From the base of your throat down to how low you want the neckline at the front.',
        diagramRef: 'neck-front',
        minInch: 2,
        maxInch: 20,
        required: false,
        placeholderInch: 7,
      },
      {
        key: 'neckDepthBack',
        label: 'Back neck depth',
        help: 'Measured the same way, down the back.',
        diagramRef: 'neck-back',
        minInch: 1,
        maxInch: 20,
        required: false,
        placeholderInch: 6,
      },
    ],
  },
  {
    title: 'Trouser / Shalwar',
    fields: [
      {
        key: 'trouserLength',
        label: 'Trouser length',
        help: 'From your waist down to the ankle, or wherever you want the hem to sit.',
        diagramRef: 'trouser-length',
        minInch: 24,
        maxInch: 50,
        required: true,
        placeholderInch: 38,
      },
      {
        key: 'trouserWaist',
        label: 'Trouser waist',
        help: 'Around where the trouser will actually sit, which is often a little below the natural waist.',
        diagramRef: 'trouser-waist',
        minInch: 20,
        maxInch: 66,
        required: true,
        placeholderInch: 32,
      },
      {
        key: 'thigh',
        label: 'Thigh',
        help: 'Around the fullest part of your thigh.',
        diagramRef: 'thigh',
        minInch: 14,
        maxInch: 44,
        required: false,
        placeholderInch: 22,
      },
      {
        key: 'bottomOpening',
        label: 'Bottom opening',
        help: 'Around the hem of the trouser leg — this sets how narrow or wide the ankle is.',
        diagramRef: 'bottom-opening',
        minInch: 8,
        maxInch: 40,
        required: false,
        placeholderInch: 14,
      },
    ],
  },
];

const childFields = (kind: 'girls' | 'boys'): MeasurementTemplate['groups'] => [
  {
    title: kind === 'girls' ? 'Frock / Kurta' : 'Kurta / Shirt',
    fields: [
      {
        key: 'shirtLength',
        label: kind === 'girls' ? 'Frock / kurta length' : 'Kurta length',
        help: 'From the top of the shoulder straight down to the desired hem.',
        diagramRef: 'shirt-length',
        minInch: 12,
        maxInch: 48,
        required: true,
        placeholderInch: 26,
      },
      {
        key: 'chest',
        label: 'Chest',
        help: 'Around the fullest part of the chest, tape level and relaxed.',
        diagramRef: 'bust',
        minInch: 16,
        maxInch: 44,
        required: true,
        placeholderInch: 26,
      },
      {
        key: 'waist',
        label: 'Waist',
        help: 'Around the natural waistline.',
        diagramRef: 'waist',
        minInch: 14,
        maxInch: 44,
        required: true,
        placeholderInch: 24,
      },
      {
        key: 'shoulder',
        label: 'Shoulder',
        help: 'Across the back, shoulder tip to shoulder tip.',
        diagramRef: 'shoulder',
        minInch: 7,
        maxInch: 20,
        required: true,
        placeholderInch: 11,
      },
      {
        key: 'sleeveLength',
        label: 'Sleeve length',
        help: 'From shoulder tip to where the sleeve should end.',
        diagramRef: 'sleeve-length',
        minInch: 3,
        maxInch: 26,
        required: true,
        placeholderInch: 14,
      },
    ],
  },
  {
    title: kind === 'girls' ? 'Trouser / Pyjama' : 'Shalwar / Trouser',
    fields: [
      {
        key: 'trouserLength',
        label: 'Trouser length',
        help: 'From the waist down to the ankle.',
        diagramRef: 'trouser-length',
        minInch: 14,
        maxInch: 44,
        required: true,
        placeholderInch: 28,
      },
      {
        key: 'trouserWaist',
        label: 'Trouser waist',
        help: 'Around where the trouser sits.',
        diagramRef: 'trouser-waist',
        minInch: 16,
        maxInch: 44,
        required: true,
        placeholderInch: 24,
      },
      {
        key: 'bottomOpening',
        label: 'Bottom opening',
        help: 'Around the hem of the leg.',
        diagramRef: 'bottom-opening',
        minInch: 6,
        maxInch: 28,
        required: false,
        placeholderInch: 11,
      },
    ],
  },
  {
    title: 'Growing room',
    fields: [
      {
        key: 'growthAllowance',
        label: 'Extra length to add',
        help: 'Children grow. We can add hidden hem allowance so the outfit lasts another season.',
        diagramRef: 'growth',
        minInch: 0,
        maxInch: 4,
        required: false,
        placeholderInch: 1,
      },
    ],
  },
];

const abayaFields: MeasurementTemplate['groups'] = [
  {
    title: 'Abaya',
    fields: [
      {
        key: 'abayaLength',
        label: 'Abaya length',
        help: 'From the shoulder straight down to the floor, wearing the shoes you would normally wear.',
        diagramRef: 'abaya-length',
        minInch: 40,
        maxInch: 70,
        required: true,
        placeholderInch: 56,
      },
      {
        key: 'bust',
        label: 'Bust',
        help: 'Around the fullest part of the chest. The abaya is cut loose over this.',
        diagramRef: 'bust',
        minInch: 28,
        maxInch: 70,
        required: true,
        placeholderInch: 38,
      },
      {
        key: 'shoulder',
        label: 'Shoulder',
        help: 'Across the back, shoulder tip to shoulder tip.',
        diagramRef: 'shoulder',
        minInch: 12,
        maxInch: 24,
        required: true,
        placeholderInch: 15,
      },
      {
        key: 'sleeveLength',
        label: 'Sleeve length',
        help: 'From the shoulder tip to the wrist bone.',
        diagramRef: 'sleeve-length',
        minInch: 15,
        maxInch: 32,
        required: true,
        placeholderInch: 23,
      },
      {
        key: 'sleeveOpening',
        label: 'Sleeve opening',
        help: 'Around the wrist, plus room to move comfortably.',
        diagramRef: 'sleeve-opening',
        minInch: 6,
        maxInch: 24,
        required: false,
        placeholderInch: 10,
      },
      {
        key: 'hips',
        label: 'Hips',
        help: 'Around the fullest part of the hips — only needed for fitted or semi-fitted cuts.',
        diagramRef: 'hips',
        minInch: 28,
        maxInch: 76,
        required: false,
        placeholderInch: 40,
      },
    ],
  },
];

export const TEMPLATES: Record<MeasurementTemplateKey, MeasurementTemplate> = {
  WOMENS_STITCHED: {
    key: 'WOMENS_STITCHED',
    label: "Women's stitched",
    version: 1,
    description:
      'Measurements for a stitched three-piece or two-piece. Measure over light clothing, standing relaxed.',
    groups: womensFields,
  },
  GIRLS_STITCHED: {
    key: 'GIRLS_STITCHED',
    label: "Girls' stitched",
    version: 1,
    description:
      'Measurements for girls. Ask her to stand straight with arms relaxed at her sides.',
    groups: childFields('girls'),
  },
  BOYS_STITCHED: {
    key: 'BOYS_STITCHED',
    label: "Boys' stitched",
    version: 1,
    description: 'Measurements for boys. Ask him to stand straight with arms relaxed at his sides.',
    groups: childFields('boys'),
  },
  ABAYA: {
    key: 'ABAYA',
    label: 'Abaya',
    version: 1,
    description:
      'Abayas are cut loose. We only need a few key numbers to get the drape and length right.',
    groups: abayaFields,
  },
  STOLE: {
    key: 'STOLE',
    label: 'Stole',
    version: 1,
    description: 'Stoles come in fixed sizes — no measurements needed.',
    groups: [],
  },
};

/** Flat field list for a template, in display order. */
export function fieldsFor(template: MeasurementTemplateKey): MeasurementField[] {
  return TEMPLATES[template].groups.flatMap((g) => g.fields);
}

export function requiresMeasurements(template: MeasurementTemplateKey): boolean {
  return fieldsFor(template).length > 0;
}

// ── Validation ───────────────────────────────────────────────────────────────

export interface MeasurementIssue {
  field: string;
  label: string;
  message: string;
}

/**
 * Validates a submitted measurement set against its template.
 *
 * Values arrive in `unit`; ranges are defined in inches, so centimetre input
 * is converted before comparison rather than maintaining two range tables.
 * Returns every problem at once — a form that reveals errors one at a time is
 * miserable to fill in.
 */
export function validateMeasurements(
  template: MeasurementTemplateKey,
  values: Record<string, unknown>,
  unit: MeasurementUnitKey,
): { ok: boolean; issues: MeasurementIssue[]; normalised: Record<string, number> } {
  const issues: MeasurementIssue[] = [];
  const normalised: Record<string, number> = {};
  const fields = fieldsFor(template);

  for (const field of fields) {
    const raw = values[field.key];

    if (raw === undefined || raw === null || raw === '') {
      if (field.required) {
        issues.push({
          field: field.key,
          label: field.label,
          message: `${field.label} is required.`,
        });
      }
      continue;
    }

    const value = typeof raw === 'string' ? Number(raw) : (raw as number);

    if (typeof value !== 'number' || !Number.isFinite(value)) {
      issues.push({
        field: field.key,
        label: field.label,
        message: `${field.label} must be a number.`,
      });
      continue;
    }

    if (value <= 0) {
      issues.push({
        field: field.key,
        label: field.label,
        message: `${field.label} must be greater than zero.`,
      });
      continue;
    }

    const valueInInches = unit === 'CM' ? cmToInch(value) : value;
    const min = unit === 'CM' ? inchToCm(field.minInch) : field.minInch;
    const max = unit === 'CM' ? inchToCm(field.maxInch) : field.maxInch;

    if (valueInInches < field.minInch || valueInInches > field.maxInch) {
      const suffix = unit === 'CM' ? 'cm' : 'in';
      issues.push({
        field: field.key,
        label: field.label,
        message: `${field.label} should be between ${min}${suffix} and ${max}${suffix}. Please double-check the tape.`,
      });
      continue;
    }

    // Store to one decimal: tailors do not work to finer precision, and
    // free-floating decimals make the tailor's worksheet noisy.
    normalised[field.key] = Math.round(value * 10) / 10;
  }

  issues.push(...crossFieldIssues(template, normalised, unit));

  return { ok: issues.length === 0, issues, normalised };
}

/**
 * Relationship checks that a per-field range cannot catch — for example a
 * sleeve longer than the shirt it attaches to. These usually mean two numbers
 * were entered in the wrong boxes.
 */
function crossFieldIssues(
  template: MeasurementTemplateKey,
  values: Record<string, number>,
  unit: MeasurementUnitKey,
): MeasurementIssue[] {
  const issues: MeasurementIssue[] = [];
  const has = (k: string) => typeof values[k] === 'number';

  if (has('sleeveLength') && has('shirtLength') && values.sleeveLength > values.shirtLength) {
    issues.push({
      field: 'sleeveLength',
      label: 'Sleeve length',
      message: 'Sleeve length is longer than the shirt length. These may have been swapped.',
    });
  }

  if (has('sleeveOpening') && has('armhole') && values.sleeveOpening > values.armhole) {
    issues.push({
      field: 'sleeveOpening',
      label: 'Sleeve opening',
      message: 'The sleeve opening is wider than the armhole, which cannot be stitched.',
    });
  }

  // A waist wildly larger than the hips is nearly always a transposition.
  if (has('waist') && has('hips')) {
    const gap = unit === 'CM' ? inchToCm(10) : 10;
    if (values.waist > values.hips + gap) {
      issues.push({
        field: 'waist',
        label: 'Waist',
        message: 'Waist is much larger than hips. Please check these two values.',
      });
    }
  }

  if (template === 'ABAYA' && has('abayaLength') && has('sleeveLength')) {
    if (values.sleeveLength > values.abayaLength) {
      issues.push({
        field: 'sleeveLength',
        label: 'Sleeve length',
        message: 'Sleeve length cannot exceed the abaya length.',
      });
    }
  }

  return issues;
}

/**
 * Zod schema for a measurement submission. The deep field validation happens
 * in `validateMeasurements` because it is template-dependent; this guards the
 * envelope shape at the API boundary.
 */
export const measurementPayloadSchema = z.object({
  template: z.enum(MEASUREMENT_TEMPLATES),
  unit: z.enum(['INCH', 'CM']),
  values: z.record(z.string(), z.union([z.number(), z.string()])),
  notes: z.string().max(500).optional(),
});

export type MeasurementPayload = z.infer<typeof measurementPayloadSchema>;

/**
 * Human-readable summary for the tailor's worksheet and order emails,
 * e.g. "Shirt length 38in · Bust 36in · Waist 30in".
 */
export function describeMeasurements(
  template: MeasurementTemplateKey,
  values: Record<string, number>,
  unit: MeasurementUnitKey,
): string {
  const suffix = unit === 'CM' ? 'cm' : 'in';
  return fieldsFor(template)
    .filter((f) => typeof values[f.key] === 'number')
    .map((f) => `${f.label} ${values[f.key]}${suffix}`)
    .join(' · ');
}
