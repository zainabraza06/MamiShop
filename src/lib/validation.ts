import { z } from 'zod';
import { MEASUREMENT_TEMPLATES } from '@/lib/measurements';
import { SUPPORTED_CURRENCIES } from '@/lib/money';
import { normalizePhonePK, sanitizeText } from '@/lib/utils';

/**
 * Shared validation schemas.
 *
 * The same schema object is imported by the React form (via
 * @hookform/resolvers) and by the server handler. The client copy exists for
 * fast feedback; the server copy is the one that actually decides. Because
 * they are literally the same object they cannot drift, which is the usual way
 * "we validate on both sides" quietly becomes "we validate on neither".
 */

// ── Primitives ───────────────────────────────────────────────────────────────

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Email is required.')
  .max(254, 'That email address is too long.')
  .email('Enter a valid email address.')
  .transform((v) => v.toLowerCase());

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(128, 'Passwords cannot exceed 128 characters.')
  .refine((v) => /[a-z]/.test(v), 'Include a lowercase letter.')
  .refine((v) => /[A-Z0-9]/.test(v), 'Include an uppercase letter or a number.');

/**
 * Accepts the formats Pakistani customers actually type (0300-1234567,
 * +923001234567, 3001234567) and stores one canonical E.164 value.
 */
export const phoneSchema = z
  .string()
  .trim()
  .min(1, 'Phone number is required.')
  .transform((v, ctx) => {
    const normalised = normalizePhonePK(v);
    if (!normalised) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter a valid Pakistani mobile number, e.g. 0300 1234567.',
      });
      return z.NEVER;
    }
    return normalised;
  });

/** Free text that will be re-displayed: tags and control characters stripped. */
export const safeText = (max: number, label = 'This field') =>
  z
    .string()
    .trim()
    .max(max, `${label} cannot exceed ${max} characters.`)
    .transform(sanitizeText);

export const slugSchema = z
  .string()
  .trim()
  .min(1, 'Slug is required.')
  .max(96)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens only.');

/** Money entered by an admin, in major units, converted to integer minor units. */
export const moneyInputSchema = z
  .union([z.number(), z.string()])
  .transform((v, ctx) => {
    const n = typeof v === 'string' ? Number(v.replace(/[,\s]/g, '')) : v;
    if (!Number.isFinite(n) || n < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid amount.' });
      return z.NEVER;
    }
    return Math.round(n * 100);
  });

export const currencySchema = z.enum(SUPPORTED_CURRENCIES);

export const cuidSchema = z.string().min(1).max(64);

/** Cursor pagination — offset pagination degrades badly on a large catalogue. */
export const paginationSchema = z.object({
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(60).default(24),
});

// ── Auth ─────────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required.').max(128),
  callbackUrl: z.string().optional(),
});

export const registerSchema = z
  .object({
    name: safeText(80, 'Name').pipe(z.string().min(2, 'Enter your name.')),
    email: emailSchema,
    phone: phoneSchema.optional(),
    password: passwordSchema,
    confirmPassword: z.string(),
    marketingOptIn: z.boolean().default(false),
    referralCode: z.string().trim().max(16).optional(),
    acceptTerms: z.literal(true, {
      errorMap: () => ({ message: 'Please accept the terms to continue.' }),
    }),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export const passwordResetRequestSchema = z.object({ email: emailSchema });

export const passwordResetSchema = z
  .object({
    token: z.string().min(16),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

// ── Address ──────────────────────────────────────────────────────────────────

export const addressSchema = z.object({
  fullName: safeText(80, 'Name').pipe(z.string().min(2, 'Enter the recipient name.')),
  phone: phoneSchema,
  line1: safeText(160, 'Address').pipe(z.string().min(5, 'Enter a street address.')),
  line2: safeText(160, 'Address line 2').optional(),
  city: safeText(60, 'City').pipe(z.string().min(2, 'Enter a city.')),
  state: safeText(60, 'Province').pipe(z.string().min(2, 'Select a province.')),
  postalCode: z
    .string()
    .trim()
    .max(12)
    .regex(/^[0-9]{4,6}$/, 'Enter a valid postal code.')
    .optional()
    .or(z.literal('')),
  country: z.string().trim().length(2).default('PK'),
  landmark: safeText(120, 'Landmark').optional(),
  type: z.enum(['SHIPPING', 'BILLING']).default('SHIPPING'),
  isDefault: z.boolean().default(false),
});

// ── Measurements ─────────────────────────────────────────────────────────────

export const measurementProfileSchema = z.object({
  label: safeText(60, 'Label').pipe(z.string().min(1, 'Give this profile a name.')),
  template: z.enum(MEASUREMENT_TEMPLATES),
  unit: z.enum(['INCH', 'CM']).default('INCH'),
  // Field-level ranges are template-dependent and checked by
  // validateMeasurements() after this envelope passes.
  values: z.record(z.string(), z.union([z.number(), z.string()])),
  notes: safeText(500, 'Notes').optional(),
  isDefault: z.boolean().default(false),
});

// ── Cart & checkout ──────────────────────────────────────────────────────────

export const addToCartSchema = z.object({
  productId: cuidSchema,
  variantId: cuidSchema.optional(),
  quantity: z.coerce.number().int().min(1).max(20).default(1),
  measurementProfileId: cuidSchema.optional(),
  measurementUnit: z.enum(['INCH', 'CM']).optional(),
  measurementValues: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
  customNote: safeText(300, 'Note').optional(),
});

export const updateCartItemSchema = z.object({
  itemId: cuidSchema,
  quantity: z.coerce.number().int().min(0).max(20),
});

export const applyCouponSchema = z.object({
  code: z.string().trim().min(1, 'Enter a code.').max(32),
});

export const checkoutSchema = z.object({
  email: emailSchema,
  phone: phoneSchema,
  shippingAddress: addressSchema,
  billingAddress: addressSchema.optional(),
  billingSameAsShipping: z.boolean().default(true),
  shippingRateId: cuidSchema,
  paymentMethod: z.enum(['STRIPE', 'JAZZCASH', 'EASYPAISA', 'COD', 'BANK_TRANSFER']),
  couponCode: z.string().trim().max(32).optional(),
  loyaltyPoints: z.coerce.number().int().min(0).default(0),
  customerNote: safeText(500, 'Note').optional(),
  saveAddress: z.boolean().default(false),
  createAccount: z.boolean().default(false),
  /** Present only when `createAccount` is true. */
  password: z.string().max(128).optional(),
  acceptTerms: z.literal(true, {
    errorMap: () => ({ message: 'Please accept the terms to place your order.' }),
  }),
});

// ── Reviews ──────────────────────────────────────────────────────────────────

export const reviewSchema = z.object({
  productId: cuidSchema,
  rating: z.coerce.number().int().min(1, 'Choose a rating.').max(5),
  title: safeText(120, 'Title').optional(),
  body: safeText(2000, 'Review').pipe(
    z.string().min(10, 'Tell us a little more — at least 10 characters.'),
  ),
  photos: z.array(z.string().url()).max(5, 'Up to 5 photos.').default([]),
});

// ── Returns ──────────────────────────────────────────────────────────────────

export const returnRequestSchema = z.object({
  orderId: cuidSchema,
  kind: z.enum(['RETURN', 'EXCHANGE']).default('RETURN'),
  reason: z.enum([
    'WRONG_SIZE',
    'NOT_AS_DESCRIBED',
    'DAMAGED',
    'LATE_DELIVERY',
    'CHANGED_MIND',
    'OTHER',
  ]),
  detail: safeText(1000, 'Details').optional(),
  photos: z.array(z.string().url()).max(5).default([]),
  items: z
    .array(
      z.object({
        orderItemId: cuidSchema,
        quantity: z.coerce.number().int().min(1),
        reason: safeText(200, 'Reason').optional(),
      }),
    )
    .min(1, 'Select at least one item to return.'),
});

// ── Newsletter & contact ─────────────────────────────────────────────────────

export const newsletterSchema = z.object({
  email: emailSchema,
  name: safeText(80, 'Name').optional(),
  source: z.enum(['FOOTER', 'EXIT_INTENT', 'CHECKOUT', 'POPUP']).default('FOOTER'),
  /** Honeypot: bots fill hidden fields, humans do not. */
  website: z.string().max(0, 'Unexpected value.').optional(),
});

export const contactSchema = z.object({
  name: safeText(80, 'Name').pipe(z.string().min(2, 'Enter your name.')),
  email: emailSchema,
  phone: phoneSchema.optional(),
  orderNumber: z.string().trim().max(32).optional(),
  subject: safeText(120, 'Subject').pipe(z.string().min(3, 'Enter a subject.')),
  message: safeText(2000, 'Message').pipe(
    z.string().min(20, 'Please give us a little more detail.'),
  ),
  website: z.string().max(0).optional(),
});

// ── Search & filtering ───────────────────────────────────────────────────────

export const productFilterSchema = z.object({
  q: z.string().trim().max(120).optional(),
  category: z.string().trim().max(96).optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  tags: z.union([z.string(), z.array(z.string())]).optional(),
  fabric: z.string().trim().max(60).optional(),
  sort: z
    .enum(['newest', 'price-asc', 'price-desc', 'rating', 'popular'])
    .default('newest'),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(60).default(24),
});

export type ProductFilter = z.infer<typeof productFilterSchema>;

// ── Admin ────────────────────────────────────────────────────────────────────

export const productVariantSchema = z.object({
  id: cuidSchema.optional(),
  sku: z.string().trim().min(1, 'SKU is required.').max(48),
  kind: z.enum(['COLOR', 'FABRIC', 'LENGTH', 'STYLE', 'BUNDLE']).default('COLOR'),
  name: safeText(60, 'Variant name').pipe(z.string().min(1, 'Name the variant.')),
  colorHex: z
    .string()
    .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Enter a hex colour like #C9A227.')
    .optional()
    .or(z.literal('')),
  priceDelta: z.coerce.number().int().default(0),
  position: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
  trackInventory: z.boolean().default(true),
  stockOnHand: z.coerce.number().int().min(0).default(0),
  lowStockAlert: z.coerce.number().int().min(0).default(3),
});

export const productSchema = z.object({
  sku: z.string().trim().min(1, 'SKU is required.').max(48),
  slug: slugSchema,
  name: safeText(140, 'Name').pipe(z.string().min(2, 'Enter a product name.')),
  categoryId: cuidSchema,
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).default('DRAFT'),
  shortDescription: safeText(200, 'Short description').optional(),
  description: safeText(8000, 'Description').optional(),
  careInstructions: safeText(2000, 'Care instructions').optional(),
  fabric: safeText(80, 'Fabric').optional(),
  pieces: safeText(40, 'Pieces').optional(),
  tags: z.array(z.string().trim().max(40)).max(20).default([]),
  basePrice: z.coerce.number().int().min(0, 'Price cannot be negative.'),
  compareAtPrice: z.coerce.number().int().min(0).optional(),
  currency: currencySchema.default('PKR'),
  taxClass: z.string().trim().max(32).default('STANDARD'),
  requiresMeasurements: z.boolean().default(true),
  sizingTemplate: z.enum(MEASUREMENT_TEMPLATES).optional(),
  stitchingDays: z.coerce.number().int().min(0).max(90).default(7),
  isFeatured: z.boolean().default(false),
  isNewArrival: z.boolean().default(false),
  weightGrams: z.coerce.number().int().min(0).max(50_000).default(500),
  metaTitle: safeText(70, 'Meta title').optional(),
  metaDescription: safeText(160, 'Meta description').optional(),
  variants: z.array(productVariantSchema).default([]),
  images: z
    .array(
      z.object({
        id: cuidSchema.optional(),
        url: z.string().url(),
        publicId: z.string().max(200).optional(),
        alt: safeText(160, 'Alt text').pipe(
          z.string().min(1, 'Alt text is required for accessibility.'),
        ),
        position: z.coerce.number().int().min(0).default(0),
        variantId: cuidSchema.optional(),
      }),
    )
    .default([]),
});

export const categorySchema = z.object({
  name: safeText(80, 'Name').pipe(z.string().min(2, 'Enter a category name.')),
  slug: slugSchema,
  parentId: cuidSchema.nullable().optional(),
  description: safeText(500, 'Description').optional(),
  imageUrl: z.string().url().optional().or(z.literal('')),
  position: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  sizingTemplate: z.enum(MEASUREMENT_TEMPLATES).optional(),
  metaTitle: safeText(70, 'Meta title').optional(),
  metaDescription: safeText(160, 'Meta description').optional(),
});

export const couponSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(3, 'Codes need at least 3 characters.')
      .max(32)
      .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, numbers, hyphens and underscores only.')
      .transform((v) => v.toUpperCase()),
    type: z.enum(['PERCENTAGE', 'FIXED_AMOUNT', 'FREE_SHIPPING']),
    value: z.coerce.number().int().min(0),
    maxDiscount: z.coerce.number().int().min(0).nullable().default(null),
    minOrderSubtotal: z.coerce.number().int().min(0).default(0),
    usageLimit: z.coerce.number().int().min(1).nullable().default(null),
    usageLimitPerUser: z.coerce.number().int().min(1).nullable().default(1),
    appliesToCategoryIds: z.array(cuidSchema).default([]),
    appliesToProductIds: z.array(cuidSchema).default([]),
    firstOrderOnly: z.boolean().default(false),
    description: safeText(200, 'Description').optional(),
    isActive: z.boolean().default(true),
    startsAt: z.coerce.date().nullable().default(null),
    endsAt: z.coerce.date().nullable().default(null),
  })
  .refine((d) => d.type !== 'PERCENTAGE' || (d.value > 0 && d.value <= 100), {
    message: 'A percentage discount must be between 1 and 100.',
    path: ['value'],
  })
  .refine((d) => !d.startsAt || !d.endsAt || d.endsAt > d.startsAt, {
    message: 'The end date must come after the start date.',
    path: ['endsAt'],
  });

export const orderStatusUpdateSchema = z.object({
  status: z.enum([
    'PENDING',
    'CONFIRMED',
    'IN_PRODUCTION',
    'READY_TO_SHIP',
    'SHIPPED',
    'DELIVERED',
    'CANCELLED',
    'REFUNDED',
  ]),
  trackingNumber: z.string().trim().max(64).optional(),
  courier: z.string().trim().max(64).optional(),
  note: safeText(500, 'Note').optional(),
  notifyCustomer: z.boolean().default(true),
});

export const refundSchema = z.object({
  amount: z.coerce.number().int().min(1, 'Enter a refund amount.'),
  reason: safeText(300, 'Reason').pipe(z.string().min(3, 'Give a reason for the refund.')),
  restock: z.boolean().default(false),
});

export const staffSchema = z.object({
  email: emailSchema,
  name: safeText(80, 'Name').pipe(z.string().min(2, 'Enter a name.')),
  role: z.enum(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  permissions: z.array(z.string().max(48)).max(40).default([]),
  status: z.enum(['ACTIVE', 'SUSPENDED']).default('ACTIVE'),
});

export const shippingZoneSchema = z.object({
  name: safeText(80, 'Name').pipe(z.string().min(2, 'Name the zone.')),
  country: z.string().trim().length(2).default('PK'),
  cities: z.array(z.string().trim().max(60)).max(200).default([]),
  states: z.array(z.string().trim().max(60)).max(50).default([]),
  priority: z.coerce.number().int().default(0),
  isActive: z.boolean().default(true),
});

export const shippingRateSchema = z.object({
  name: safeText(80, 'Name').pipe(z.string().min(2, 'Name the rate.')),
  description: safeText(160, 'Description').optional(),
  amount: z.coerce.number().int().min(0),
  freeAbove: z.coerce.number().int().min(0).nullable().default(null),
  codSurcharge: z.coerce.number().int().min(0).default(0),
  minDays: z.coerce.number().int().min(0).max(90).default(3),
  maxDays: z.coerce.number().int().min(0).max(120).default(5),
  isActive: z.boolean().default(true),
  position: z.coerce.number().int().min(0).default(0),
});

export const taxRuleSchema = z.object({
  name: safeText(80, 'Name').pipe(z.string().min(2, 'Name the rule.')),
  country: z.string().trim().length(2).default('PK'),
  state: z.string().trim().max(60).nullable().default(null),
  taxClass: z.string().trim().max(32).default('STANDARD'),
  rateBps: z.coerce.number().int().min(0).max(10_000),
  isInclusive: z.boolean().default(true),
  priority: z.coerce.number().int().default(0),
  isActive: z.boolean().default(true),
});

export const contentBlockSchema = z.object({
  key: z.string().trim().min(2).max(48),
  type: z.enum(['HERO', 'BANNER_GRID', 'COLLECTION_STRIP', 'RICH_TEXT', 'USP_ROW']),
  title: safeText(120, 'Title').optional(),
  data: z.record(z.string(), z.unknown()),
  position: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
  experimentKey: z.string().trim().max(48).optional(),
  variant: z.string().trim().max(8).default('A'),
  startsAt: z.coerce.date().nullable().default(null),
  endsAt: z.coerce.date().nullable().default(null),
});

export const pageSchema = z.object({
  slug: slugSchema,
  title: safeText(120, 'Title').pipe(z.string().min(2, 'Enter a title.')),
  body: z.string().max(60_000),
  isPublished: z.boolean().default(true),
  metaTitle: safeText(70, 'Meta title').optional(),
  metaDescription: safeText(160, 'Meta description').optional(),
});

export const manualOrderSchema = z.object({
  email: emailSchema,
  phone: phoneSchema,
  customerName: safeText(80, 'Name').pipe(z.string().min(2, 'Enter a customer name.')),
  shippingAddress: addressSchema,
  paymentMethod: z.enum(['COD', 'BANK_TRANSFER', 'MANUAL']),
  shippingAmount: z.coerce.number().int().min(0).default(0),
  discountAmount: z.coerce.number().int().min(0).default(0),
  staffNote: safeText(500, 'Note').optional(),
  items: z
    .array(
      z.object({
        productId: cuidSchema,
        variantId: cuidSchema.optional(),
        quantity: z.coerce.number().int().min(1).max(50),
        unitPrice: z.coerce.number().int().min(0),
        measurementUnit: z.enum(['INCH', 'CM']).optional(),
        measurementValues: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
        customNote: safeText(300, 'Note').optional(),
      }),
    )
    .min(1, 'Add at least one item.'),
});

// ── Inferred types ───────────────────────────────────────────────────────────

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type AddressInput = z.infer<typeof addressSchema>;
export type MeasurementProfileInput = z.infer<typeof measurementProfileSchema>;
export type AddToCartInput = z.infer<typeof addToCartSchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type ReviewInput = z.infer<typeof reviewSchema>;
export type ReturnRequestInput = z.infer<typeof returnRequestSchema>;
export type ProductInput = z.infer<typeof productSchema>;
export type CategoryInput = z.infer<typeof categorySchema>;
export type CouponInput = z.infer<typeof couponSchema>;
export type ManualOrderInput = z.infer<typeof manualOrderSchema>;
export type StaffInput = z.infer<typeof staffSchema>;
