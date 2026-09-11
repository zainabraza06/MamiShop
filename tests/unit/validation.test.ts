import { describe, expect, it } from 'vitest';
import {
  addToCartSchema,
  addressSchema,
  couponSchema,
  emailSchema,
  moneyInputSchema,
  newsletterSchema,
  passwordSchema,
  phoneSchema,
  productFilterSchema,
  registerSchema,
  reviewSchema,
  slugSchema,
} from '@/lib/validation';

/**
 * Shared validation schemas.
 *
 * The same object validates the React form and the server handler, so the
 * server copy is the one that actually decides. These tests cover the inputs an
 * attacker would send straight to the API, not only what the form allows.
 */

describe('emailSchema', () => {
  it('trims and lowercases, so accounts cannot be duplicated by case', () => {
    expect(emailSchema.parse('  Ayesha@Example.COM ')).toBe('ayesha@example.com');
  });

  it('rejects something that is not an address', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
  });
});

describe('phoneSchema', () => {
  it('normalises the formats Pakistani customers type', () => {
    for (const input of ['0300 1234567', '0300-1234567', '+923001234567', '3001234567']) {
      expect(phoneSchema.parse(input)).toBe('+923001234567');
    }
  });

  it('rejects a number that is not a mobile', () => {
    expect(phoneSchema.safeParse('12345').success).toBe(false);
  });
});

describe('passwordSchema', () => {
  it('requires ten characters', () => {
    expect(passwordSchema.safeParse('Short1').success).toBe(false);
  });

  it('requires an uppercase letter or a number', () => {
    expect(passwordSchema.safeParse('alllowercaseletters').success).toBe(false);
  });

  it('accepts a long passphrase', () => {
    expect(passwordSchema.safeParse('CorrectHorse99').success).toBe(true);
  });
});

describe('registerSchema', () => {
  const valid = {
    name: 'Ayesha Khan',
    email: 'ayesha@example.com',
    password: 'CorrectHorse99',
    confirmPassword: 'CorrectHorse99',
    acceptTerms: true,
  };

  it('accepts a complete registration', () => {
    expect(registerSchema.safeParse(valid).success).toBe(true);
  });

  it('reports a password mismatch against the confirmation field', () => {
    const result = registerSchema.safeParse({ ...valid, confirmPassword: 'Different99x' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path.includes('confirmPassword'))).toBe(true);
  });

  it('refuses registration without accepting the terms', () => {
    expect(registerSchema.safeParse({ ...valid, acceptTerms: false }).success).toBe(false);
  });
});

describe('addressSchema', () => {
  const valid = {
    fullName: 'Ayesha Khan',
    phone: '03001234567',
    line1: '12 Gulberg III',
    city: 'Lahore',
    state: 'Punjab',
  };

  it('accepts a normal address and defaults the country', () => {
    const result = addressSchema.parse(valid);
    expect(result.country).toBe('PK');
    expect(result.phone).toBe('+923001234567');
  });

  it('strips markup, so stored text is safe in emails and PDFs', () => {
    const result = addressSchema.parse({
      ...valid,
      line1: '<script>alert(1)</script>12 Gulberg III',
    });
    expect(result.line1).not.toContain('<');
  });

  it('accepts an empty postal code but rejects a malformed one', () => {
    expect(addressSchema.safeParse({ ...valid, postalCode: '' }).success).toBe(true);
    expect(addressSchema.safeParse({ ...valid, postalCode: 'ABC' }).success).toBe(false);
  });
});

describe('addToCartSchema', () => {
  it('defaults quantity to one and coerces form strings', () => {
    expect(addToCartSchema.parse({ productId: 'p1' }).quantity).toBe(1);
    expect(addToCartSchema.parse({ productId: 'p1', quantity: '3' }).quantity).toBe(3);
  });

  it('bounds quantity at both ends', () => {
    expect(addToCartSchema.safeParse({ productId: 'p1', quantity: 0 }).success).toBe(false);
    expect(addToCartSchema.safeParse({ productId: 'p1', quantity: 21 }).success).toBe(false);
  });
});

describe('couponSchema', () => {
  const valid = { code: 'welcome10', type: 'PERCENTAGE' as const, value: 10 };

  it('stores codes uppercase', () => {
    expect(couponSchema.parse(valid).code).toBe('WELCOME10');
  });

  it('rejects a percentage above 100', () => {
    expect(couponSchema.safeParse({ ...valid, value: 150 }).success).toBe(false);
  });

  it('rejects an end date before the start date', () => {
    const result = couponSchema.safeParse({
      ...valid,
      startsAt: '2026-06-30',
      endsAt: '2026-06-01',
    });
    expect(result.success).toBe(false);
  });
});

describe('productFilterSchema', () => {
  it('supplies safe defaults for a bare listing URL', () => {
    const result = productFilterSchema.parse({});
    expect(result.sort).toBe('newest');
    expect(result.limit).toBe(24);
  });

  it('caps page size so the listing cannot be asked for the whole catalogue', () => {
    expect(productFilterSchema.safeParse({ limit: 61 }).success).toBe(false);
  });

  it('rejects an unknown sort key rather than passing it to the query', () => {
    expect(productFilterSchema.safeParse({ sort: 'id; DROP TABLE' }).success).toBe(false);
  });
});

describe('newsletterSchema', () => {
  it('accepts a normal signup', () => {
    expect(newsletterSchema.safeParse({ email: 'a@example.com' }).success).toBe(true);
  });

  it('rejects a filled honeypot, which only bots fill in', () => {
    expect(
      newsletterSchema.safeParse({ email: 'a@example.com', website: 'http://spam' }).success,
    ).toBe(false);
  });
});

describe('slugSchema', () => {
  it('accepts lowercase hyphenated slugs', () => {
    expect(slugSchema.safeParse('noor-abaya-2').success).toBe(true);
  });

  it('rejects spaces, uppercase and leading hyphens', () => {
    for (const bad of ['Noor Abaya', 'NoorAbaya', '-noor', 'noor--abaya']) {
      expect(slugSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('moneyInputSchema', () => {
  it('converts an admin-typed price into integer paisa', () => {
    expect(moneyInputSchema.parse('1,250.50')).toBe(125050);
    expect(moneyInputSchema.parse(8500)).toBe(850000);
  });

  it('rejects a negative price', () => {
    expect(moneyInputSchema.safeParse('-10').success).toBe(false);
  });
});

describe('reviewSchema', () => {
  const valid = { productId: 'p1', rating: 5, body: 'Fits perfectly, lovely fabric.' };

  it('accepts a normal review', () => {
    expect(reviewSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a rating outside one to five', () => {
    expect(reviewSchema.safeParse({ ...valid, rating: 6 }).success).toBe(false);
    expect(reviewSchema.safeParse({ ...valid, rating: 0 }).success).toBe(false);
  });

  it('rejects a review too short to be useful', () => {
    expect(reviewSchema.safeParse({ ...valid, body: 'Nice' }).success).toBe(false);
  });
});
