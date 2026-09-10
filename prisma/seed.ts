import { PrismaClient, type Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';

/**
 * Development and staging seed.
 *
 * Idempotent throughout — every write is an upsert keyed on a natural unique
 * column, so running it twice does not create duplicates. That matters because
 * this runs automatically after `prisma migrate reset` and is the fastest way
 * to get a reviewable store up on a fresh staging database.
 *
 * Refuses to run against production. A seed that overwrites the real admin
 * password because someone typed the wrong DATABASE_URL is a very short
 * incident report.
 */

const prisma = new PrismaClient();

const PKR = (rupees: number) => Math.round(rupees * 100);

function assertNotProduction(): void {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PRODUCTION_SEED !== 'yes') {
    throw new Error(
      'Refusing to seed a production database. Set ALLOW_PRODUCTION_SEED=yes to override.',
    );
  }
}

async function seedSettings() {
  const settings: { key: string; value: Prisma.InputJsonValue }[] = [
    { key: 'store.name', value: 'MomiShop' },
    { key: 'store.email', value: 'hello@momishop.pk' },
    { key: 'store.phone', value: '+923001234567' },
    { key: 'store.currency', value: 'PKR' },
    { key: 'returns.windowDays', value: 7 },
    {
      key: 'cod',
      value: { enabled: true, maxOrderTotal: PKR(50_000), countries: ['PK'] },
    },
    {
      key: 'loyalty',
      value: { enabled: true, minorUnitsPerPointEarned: 10_000, minorUnitsPerPointSpent: 100 },
    },
    { key: 'shipping.freeThreshold', value: PKR(5_000) },
  ];

  for (const setting of settings) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      update: { value: setting.value },
      create: setting,
    });
  }
  console.log(`  settings: ${settings.length}`);
}

async function seedUsers() {
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@momishop.pk').toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2024';
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
    create: {
      email: adminEmail,
      name: 'Store Owner',
      passwordHash,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      emailVerified: new Date(),
      phone: '+923001234567',
    },
  });

  await prisma.user.upsert({
    where: { email: 'staff@momishop.pk' },
    update: {},
    create: {
      email: 'staff@momishop.pk',
      name: 'Fulfilment Staff',
      passwordHash: await bcrypt.hash('StaffPass!2024', 12),
      role: 'STAFF',
      status: 'ACTIVE',
      emailVerified: new Date(),
    },
  });

  const customer = await prisma.user.upsert({
    where: { email: 'ayesha@example.com' },
    update: {},
    create: {
      email: 'ayesha@example.com',
      name: 'Ayesha Khan',
      passwordHash: await bcrypt.hash('Customer!2024', 12),
      role: 'CUSTOMER',
      status: 'ACTIVE',
      emailVerified: new Date(),
      phone: '+923011234567',
      marketingOptIn: true,
      loyaltyAccount: { create: { balance: 250, lifetimeEarned: 250 } },
    },
  });

  // A saved measurement profile, so the product page can be exercised
  // immediately without filling the form by hand.
  const existingProfile = await prisma.measurementProfile.findFirst({
    where: { userId: customer.id, label: 'Everyday kameez' },
  });

  if (!existingProfile) {
    await prisma.measurementProfile.create({
      data: {
        userId: customer.id,
        label: 'Everyday kameez',
        template: 'WOMENS_STITCHED',
        unit: 'INCH',
        isDefault: true,
        values: {
          shirtLength: 38,
          bust: 36,
          waist: 30,
          hips: 38,
          shoulder: 14,
          sleeveLength: 21,
          trouserLength: 38,
          trouserWaist: 32,
        },
      },
    });
  }

  const existingAddress = await prisma.address.findFirst({
    where: { userId: customer.id, line1: '12 Gulberg III' },
  });

  if (!existingAddress) {
    await prisma.address.create({
      data: {
        userId: customer.id,
        fullName: 'Ayesha Khan',
        phone: '+923011234567',
        line1: '12 Gulberg III',
        line2: 'Near Main Boulevard',
        city: 'Lahore',
        state: 'Punjab',
        postalCode: '54000',
        country: 'PK',
        isDefault: true,
      },
    });
  }

  console.log(`  users: 3 (admin=${adminEmail})`);
  return { admin, customer };
}

async function seedCategories() {
  const tree = [
    {
      name: "Women's",
      slug: 'womens',
      sizingTemplate: 'WOMENS_STITCHED' as const,
      metaTitle: "Women's stitched clothing — made to measure",
      children: [
        { name: 'Three piece', slug: 'womens-three-piece' },
        { name: 'Two piece', slug: 'womens-two-piece' },
        { name: 'Formals', slug: 'womens-formals' },
      ],
    },
    {
      name: 'Abayas',
      slug: 'abayas',
      sizingTemplate: 'ABAYA' as const,
      metaTitle: 'Abayas stitched to your measurements',
      children: [
        { name: 'Everyday', slug: 'abayas-everyday' },
        { name: 'Occasion', slug: 'abayas-occasion' },
      ],
    },
    {
      name: 'Stoles',
      slug: 'stoles',
      sizingTemplate: 'STOLE' as const,
      metaTitle: 'Stoles and hijabs',
      children: [
        { name: 'Georgette', slug: 'stoles-georgette' },
        { name: 'Cotton', slug: 'stoles-cotton' },
      ],
    },
    {
      name: "Girls'",
      slug: 'girls',
      sizingTemplate: 'GIRLS_STITCHED' as const,
      children: [{ name: 'Frocks', slug: 'girls-frocks' }],
    },
    {
      name: "Boys'",
      slug: 'boys',
      sizingTemplate: 'BOYS_STITCHED' as const,
      children: [{ name: 'Kurta sets', slug: 'boys-kurta-sets' }],
    },
  ];

  const bySlug = new Map<string, string>();

  for (const [index, parent] of tree.entries()) {
    const row = await prisma.category.upsert({
      where: { slug: parent.slug },
      update: { sizingTemplate: parent.sizingTemplate, isActive: true },
      create: {
        name: parent.name,
        slug: parent.slug,
        position: index,
        isActive: true,
        isFeatured: true,
        sizingTemplate: parent.sizingTemplate,
        metaTitle: parent.metaTitle,
        metaDescription: `Shop ${parent.name.toLowerCase()} stitched to your own measurements.`,
      },
    });
    bySlug.set(parent.slug, row.id);

    for (const [childIndex, child] of parent.children.entries()) {
      const childRow = await prisma.category.upsert({
        where: { slug: child.slug },
        update: { parentId: row.id },
        create: {
          name: child.name,
          slug: child.slug,
          parentId: row.id,
          position: childIndex,
          isActive: true,
          sizingTemplate: parent.sizingTemplate,
        },
      });
      bySlug.set(child.slug, childRow.id);
    }
  }

  console.log(`  categories: ${bySlug.size}`);
  return bySlug;
}

interface SeedProduct {
  sku: string;
  slug: string;
  name: string;
  categorySlug: string;
  basePrice: number;
  compareAtPrice?: number;
  fabric: string;
  pieces?: string;
  shortDescription: string;
  description: string;
  stitchingDays: number;
  requiresMeasurements: boolean;
  isFeatured?: boolean;
  isNewArrival?: boolean;
  tags: string[];
  variants: { sku: string; name: string; colorHex?: string; priceDelta?: number; stock: number }[];
}

const PRODUCTS: SeedProduct[] = [
  {
    sku: 'MS-W-0001',
    slug: 'noor-embroidered-three-piece',
    name: 'Noor Embroidered Three Piece',
    categorySlug: 'womens-three-piece',
    basePrice: PKR(8_500),
    compareAtPrice: PKR(10_500),
    fabric: 'Lawn with chiffon dupatta',
    pieces: '3 piece',
    shortDescription: 'Hand-embroidered lawn shirt with a chiffon dupatta and cambric trouser.',
    description:
      'A softly structured three piece in fine lawn, with thread embroidery across the front panel and sleeves. The chiffon dupatta is finished with a narrow hand-rolled edge.\n\nStitched to your measurements in our Lahore workshop.',
    stitchingDays: 8,
    requiresMeasurements: true,
    isFeatured: true,
    tags: ['embroidered', 'lawn', 'three-piece'],
    variants: [
      { sku: 'MS-W-0001-IVR', name: 'Ivory', colorHex: '#F2EDE4', stock: 12 },
      { sku: 'MS-W-0001-SGE', name: 'Sage', colorHex: '#A8B5A0', stock: 8 },
      { sku: 'MS-W-0001-RSE', name: 'Dusty rose', colorHex: '#C9A0A0', stock: 5 },
    ],
  },
  {
    sku: 'MS-W-0002',
    slug: 'sana-silk-formal-two-piece',
    name: 'Sana Silk Formal Two Piece',
    categorySlug: 'womens-formals',
    basePrice: PKR(16_500),
    fabric: 'Raw silk',
    pieces: '2 piece',
    shortDescription: 'A raw silk formal with mirror work at the neckline.',
    description:
      'Cut from weighty raw silk that holds its shape beautifully. Mirror and dabka work is applied by hand at the neckline and cuffs.',
    stitchingDays: 12,
    requiresMeasurements: true,
    isFeatured: true,
    isNewArrival: true,
    tags: ['formal', 'silk', 'occasion'],
    variants: [
      { sku: 'MS-W-0002-MID', name: 'Midnight', colorHex: '#1F2A44', stock: 6 },
      {
        sku: 'MS-W-0002-GLD',
        name: 'Antique gold',
        colorHex: '#C9A227',
        priceDelta: PKR(1_500),
        stock: 4,
      },
    ],
  },
  {
    sku: 'MS-A-0001',
    slug: 'noor-nida-everyday-abaya',
    name: 'Noor Nida Everyday Abaya',
    categorySlug: 'abayas-everyday',
    basePrice: PKR(6_900),
    fabric: 'Korean Nida matte',
    shortDescription: 'A clean, unadorned everyday abaya in matte Nida.',
    description:
      'Our most-ordered abaya. Cut generously through the body with a straight sleeve and a concealed front placket. Matte Nida does not shine under indoor lighting and holds a press well.',
    stitchingDays: 6,
    requiresMeasurements: true,
    isFeatured: true,
    tags: ['abaya', 'everyday', 'nida'],
    variants: [
      { sku: 'MS-A-0001-BLK', name: 'Black', colorHex: '#14110F', stock: 30 },
      { sku: 'MS-A-0001-NVY', name: 'Navy', colorHex: '#1B2A3A', stock: 14 },
      { sku: 'MS-A-0001-MOC', name: 'Mocha', colorHex: '#6B5545', stock: 9 },
    ],
  },
  {
    sku: 'MS-A-0002',
    slug: 'layla-occasion-abaya',
    name: 'Layla Occasion Abaya',
    categorySlug: 'abayas-occasion',
    basePrice: PKR(12_400),
    fabric: 'Nida with satin trim',
    shortDescription: 'A flared occasion abaya with satin cuff and hem detailing.',
    description:
      'A softly flared cut with satin binding at the cuffs and hem. Designed to sit well over formal wear without adding bulk.',
    stitchingDays: 10,
    requiresMeasurements: true,
    isNewArrival: true,
    tags: ['abaya', 'occasion', 'flared'],
    variants: [
      { sku: 'MS-A-0002-BLK', name: 'Black', colorHex: '#14110F', stock: 11 },
      { sku: 'MS-A-0002-CHR', name: 'Charcoal', colorHex: '#3A3A3A', stock: 7 },
    ],
  },
  {
    sku: 'MS-S-0001',
    slug: 'georgette-everyday-stole',
    name: 'Georgette Everyday Stole',
    categorySlug: 'stoles-georgette',
    basePrice: PKR(1_450),
    fabric: 'Georgette',
    shortDescription: 'A lightweight georgette stole with a finished edge. One size.',
    description:
      'Soft georgette that drapes without slipping. Measures 2.5 by 1 metres with a narrow machine-rolled hem. No measurements needed — stoles come in one size.',
    stitchingDays: 2,
    // Stoles are the one product type that skips the measurement form.
    requiresMeasurements: false,
    isFeatured: true,
    tags: ['stole', 'georgette', 'everyday'],
    variants: [
      { sku: 'MS-S-0001-BLK', name: 'Black', colorHex: '#14110F', stock: 60 },
      { sku: 'MS-S-0001-CRM', name: 'Cream', colorHex: '#EFE6D8', stock: 45 },
      { sku: 'MS-S-0001-OLV', name: 'Olive', colorHex: '#6B7250', stock: 38 },
      { sku: 'MS-S-0001-PLM', name: 'Plum', colorHex: '#5C3A4E', stock: 22 },
    ],
  },
  {
    sku: 'MS-S-0002',
    slug: 'cotton-jersey-stole',
    name: 'Cotton Jersey Stole',
    categorySlug: 'stoles-cotton',
    basePrice: PKR(1_150),
    fabric: 'Cotton jersey',
    shortDescription: 'A stretch cotton jersey stole that stays put without pins.',
    description: 'Breathable cotton jersey with a little stretch. Machine washable.',
    stitchingDays: 2,
    requiresMeasurements: false,
    tags: ['stole', 'cotton', 'jersey'],
    variants: [
      { sku: 'MS-S-0002-GRY', name: 'Heather grey', colorHex: '#9A9A93', stock: 40 },
      { sku: 'MS-S-0002-NVY', name: 'Navy', colorHex: '#1B2A3A', stock: 33 },
    ],
  },
  {
    sku: 'MS-G-0001',
    slug: 'gul-girls-embroidered-frock',
    name: 'Gul Girls Embroidered Frock',
    categorySlug: 'girls-frocks',
    basePrice: PKR(4_200),
    fabric: 'Cotton net over lining',
    pieces: '2 piece',
    shortDescription: 'A twirl-friendly frock with pyjama, stitched to her measurements.',
    description:
      'Full-skirted cotton net frock with a soft cotton lining, plus a matching pyjama. We add hidden hem allowance so it can be let down next season.',
    stitchingDays: 7,
    requiresMeasurements: true,
    isNewArrival: true,
    tags: ['girls', 'frock', 'embroidered'],
    variants: [
      { sku: 'MS-G-0001-PCH', name: 'Peach', colorHex: '#F2C4B0', stock: 15 },
      { sku: 'MS-G-0001-MNT', name: 'Mint', colorHex: '#BEDCCB', stock: 12 },
    ],
  },
  {
    sku: 'MS-B-0001',
    slug: 'ali-boys-kurta-set',
    name: 'Ali Boys Kurta Set',
    categorySlug: 'boys-kurta-sets',
    basePrice: PKR(3_800),
    fabric: 'Cotton blend',
    pieces: '2 piece',
    shortDescription: 'A classic kurta and shalwar set, cut to his measurements.',
    description:
      'Straightforward cotton-blend kurta with a mandarin collar and matching shalwar. Holds up to washing and to being worn to everything.',
    stitchingDays: 7,
    requiresMeasurements: true,
    tags: ['boys', 'kurta', 'eid'],
    variants: [
      { sku: 'MS-B-0001-WHT', name: 'White', colorHex: '#F7F5F0', stock: 20 },
      { sku: 'MS-B-0001-BEI', name: 'Beige', colorHex: '#D9CBB3', stock: 16 },
    ],
  },
];

/**
 * Placeholder imagery from Unsplash.
 *
 * Referenced by URL rather than committed to the repository so the seed stays
 * small. next.config.mjs allowlists this host for exactly this reason; real
 * product photography goes to Cloudinary via the admin uploader.
 */
const PLACEHOLDER_IMAGES = [
  'https://images.unsplash.com/photo-1583391733956-6c78276477e2?w=900&q=80',
  'https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?w=900&q=80',
  'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=900&q=80',
  'https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=900&q=80',
];

async function seedProducts(categoryIds: Map<string, string>) {
  let count = 0;

  for (const [index, product] of PRODUCTS.entries()) {
    const categoryId = categoryIds.get(product.categorySlug);
    if (!categoryId) {
      console.warn(`  ! skipping ${product.slug}: category ${product.categorySlug} not found`);
      continue;
    }

    const row = await prisma.product.upsert({
      where: { slug: product.slug },
      update: {
        basePrice: product.basePrice,
        status: 'ACTIVE',
        categoryId,
      },
      create: {
        sku: product.sku,
        slug: product.slug,
        name: product.name,
        categoryId,
        status: 'ACTIVE',
        publishedAt: new Date(Date.now() - index * 86_400_000),
        shortDescription: product.shortDescription,
        description: product.description,
        careInstructions: 'Dry clean recommended for embroidered pieces. Cool iron on the reverse.',
        fabric: product.fabric,
        pieces: product.pieces,
        tags: product.tags,
        basePrice: product.basePrice,
        compareAtPrice: product.compareAtPrice,
        currency: 'PKR',
        requiresMeasurements: product.requiresMeasurements,
        stitchingDays: product.stitchingDays,
        isFeatured: product.isFeatured ?? false,
        isNewArrival: product.isNewArrival ?? false,
        metaTitle: `${product.name} — made to measure`,
        metaDescription: product.shortDescription,
      },
    });

    for (const [variantIndex, variant] of product.variants.entries()) {
      await prisma.productVariant.upsert({
        where: { sku: variant.sku },
        update: { stockOnHand: variant.stock, isActive: true },
        create: {
          productId: row.id,
          sku: variant.sku,
          kind: 'COLOR',
          name: variant.name,
          colorHex: variant.colorHex,
          priceDelta: variant.priceDelta ?? 0,
          position: variantIndex,
          trackInventory: true,
          stockOnHand: variant.stock,
        },
      });
    }

    const imageCount = await prisma.productImage.count({ where: { productId: row.id } });
    if (imageCount === 0) {
      await prisma.productImage.createMany({
        data: PLACEHOLDER_IMAGES.slice(0, 2).map((url, imageIndex) => ({
          productId: row.id,
          url: `${url}&sig=${index}${imageIndex}`,
          // Alt text describes the garment, not "product image" — this is what
          // a screen-reader user actually hears in the grid.
          alt: `${product.name} in ${product.fabric.toLowerCase()}`,
          position: imageIndex,
        })),
      });
    }

    count++;
  }

  console.log(`  products: ${count}`);
}

async function seedShippingAndTax() {
  const zones = [
    {
      name: 'Lahore metro',
      cities: ['Lahore'],
      states: [] as string[],
      priority: 10,
      rates: [
        {
          name: 'Standard (2-3 days)',
          amount: PKR(150),
          freeAbove: PKR(5_000),
          minDays: 2,
          maxDays: 3,
          codSurcharge: PKR(100),
        },
        {
          name: 'Same-day (order before 12pm)',
          amount: PKR(450),
          freeAbove: null,
          minDays: 0,
          maxDays: 1,
          codSurcharge: PKR(100),
        },
      ],
    },
    {
      name: 'Punjab',
      cities: [] as string[],
      states: ['Punjab'],
      priority: 5,
      rates: [
        {
          name: 'Standard (3-5 days)',
          amount: PKR(250),
          freeAbove: PKR(5_000),
          minDays: 3,
          maxDays: 5,
          codSurcharge: PKR(150),
        },
      ],
    },
    {
      name: 'Rest of Pakistan',
      cities: [] as string[],
      states: [] as string[],
      priority: 0,
      rates: [
        {
          name: 'Standard (4-7 days)',
          amount: PKR(350),
          freeAbove: PKR(7_500),
          minDays: 4,
          maxDays: 7,
          codSurcharge: PKR(200),
        },
      ],
    },
  ];

  for (const zone of zones) {
    const existing = await prisma.shippingZone.findFirst({ where: { name: zone.name } });

    const row =
      existing ??
      (await prisma.shippingZone.create({
        data: {
          name: zone.name,
          country: 'PK',
          cities: zone.cities,
          states: zone.states,
          priority: zone.priority,
        },
      }));

    for (const [index, rate] of zone.rates.entries()) {
      const existingRate = await prisma.shippingRate.findFirst({
        where: { zoneId: row.id, name: rate.name },
      });
      if (existingRate) continue;

      await prisma.shippingRate.create({
        data: {
          zoneId: row.id,
          name: rate.name,
          amount: rate.amount,
          freeAbove: rate.freeAbove,
          codSurcharge: rate.codSurcharge,
          minDays: rate.minDays,
          maxDays: rate.maxDays,
          position: index,
        },
      });
    }
  }

  const existingTax = await prisma.taxRule.findFirst({ where: { name: 'Pakistan GST' } });
  if (!existingTax) {
    await prisma.taxRule.create({
      data: {
        name: 'Pakistan GST',
        country: 'PK',
        taxClass: 'STANDARD',
        // Displayed prices already include GST, which is how Pakistani retail
        // quotes prices. The pricing engine extracts rather than adds it.
        rateBps: 1700,
        isInclusive: true,
      },
    });
  }

  console.log(`  shipping zones: ${zones.length}, tax rules: 1`);
}

async function seedCoupons() {
  const coupons: Prisma.CouponCreateInput[] = [
    {
      code: 'WELCOME10',
      type: 'PERCENTAGE',
      value: 10,
      maxDiscount: PKR(1_500),
      minOrderSubtotal: PKR(3_000),
      usageLimitPerUser: 1,
      firstOrderOnly: true,
      description: '10% off your first order',
      isActive: true,
    },
    {
      code: 'FREESHIP',
      type: 'FREE_SHIPPING',
      value: 0,
      minOrderSubtotal: PKR(3_000),
      usageLimitPerUser: 3,
      description: 'Free delivery over Rs 3,000',
      isActive: true,
    },
    {
      code: 'ABAYA500',
      type: 'FIXED_AMOUNT',
      value: PKR(500),
      minOrderSubtotal: PKR(5_000),
      description: 'Rs 500 off abayas',
      isActive: true,
    },
  ];

  for (const coupon of coupons) {
    await prisma.coupon.upsert({
      where: { code: coupon.code },
      update: {},
      create: coupon,
    });
  }
  console.log(`  coupons: ${coupons.length}`);
}

async function seedContent() {
  const blocks: { key: string; type: string; data: Prisma.InputJsonValue; position: number }[] = [
    {
      key: 'ANNOUNCEMENT_BAR',
      type: 'RICH_TEXT',
      position: 0,
      data: { text: 'Free delivery on orders over Rs 5,000 · Stitched to your measurements' },
    },
    {
      key: 'HOME_HERO',
      type: 'HERO',
      position: 1,
      data: {
        headline: 'Cut to your measurements, not to a size chart',
        subhead:
          'Every piece is stitched to the numbers you give us. Tell us once, and we keep them on file for every order after.',
        ctaLabel: 'Shop the collection',
        ctaHref: '/products',
        imageUrl: 'https://images.unsplash.com/photo-1583391733956-6c78276477e2?w=1200&q=80',
        imageAlt: 'A model wearing a softly draped ivory three piece',
      },
    },
  ];

  for (const block of blocks) {
    await prisma.contentBlock.upsert({
      where: { key: block.key },
      update: { data: block.data },
      create: { ...block, isActive: true },
    });
  }

  const pages = [
    {
      slug: 'privacy-policy',
      title: 'Privacy Policy',
      body: 'We collect only what we need to fulfil your order: your name, contact details, delivery address and measurements.\n\nYour measurements are used to make your garments and are never shared with third parties. You can export or delete your data at any time from your account settings.',
    },
    {
      slug: 'terms',
      title: 'Terms & Conditions',
      body: 'By placing an order you confirm that the measurements you provide are accurate.\n\nBecause every garment is cut individually to your measurements, orders cannot be cancelled once production has begun.',
    },
    {
      slug: 'returns-policy',
      title: 'Returns & Exchange Policy',
      body: 'Made-to-measure garments cannot be resold, so we do not accept change-of-mind returns.\n\nIf the fit is wrong, contact us within 7 days of delivery and we will alter or remake the piece at no cost. Faulty or incorrect items are refunded in full.\n\nStoles, which are not made to measure, may be returned unworn within 7 days.',
    },
    {
      slug: 'shipping',
      title: 'Delivery',
      body: 'Stitching takes 6 to 12 working days depending on the piece, after which your parcel ships.\n\nDelivery is free on orders over Rs 5,000. Cash on delivery is available across Pakistan on orders up to Rs 50,000.',
    },
  ];

  for (const page of pages) {
    await prisma.page.upsert({
      where: { slug: page.slug },
      update: {},
      create: { ...page, isPublished: true, metaTitle: page.title },
    });
  }

  console.log(`  content blocks: ${blocks.length}, pages: ${pages.length}`);
}

async function seedNewsletter() {
  await prisma.newsletterSubscriber.upsert({
    where: { email: 'ayesha@example.com' },
    update: {},
    create: {
      email: 'ayesha@example.com',
      name: 'Ayesha Khan',
      source: 'FOOTER',
      confirmedAt: new Date(),
      unsubscribeToken: randomBytes(24).toString('base64url'),
    },
  });
}

async function main() {
  assertNotProduction();
  console.log('Seeding MomiShop…');

  await seedSettings();
  await seedUsers();
  const categoryIds = await seedCategories();
  await seedProducts(categoryIds);
  await seedShippingAndTax();
  await seedCoupons();
  await seedContent();
  await seedNewsletter();

  console.log('\nSeed complete.');
  console.log(`  Admin:    ${process.env.SEED_ADMIN_EMAIL ?? 'admin@momishop.pk'}`);
  console.log('  Staff:    staff@momishop.pk / StaffPass!2024');
  console.log('  Customer: ayesha@example.com / Customer!2024');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
