import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

/**
 * Generates placeholder product imagery.
 *
 * Why generate rather than link to a stock-photo service: the seed originally
 * pointed at Unsplash photo ids, every one of which now 404s, so the entire
 * catalogue rendered as empty grey boxes. Swapping in different external URLs
 * would just restart that clock. These are drawn locally, committed, and will
 * look the same in five years with no network at all.
 *
 * They are deliberately illustrative rather than photographic. A garment
 * silhouette in the brand palette reads as considered placeholder art; a
 * stretched stock photo of the wrong dress reads as a mistake.
 *
 * Output is WebP via sharp (already present as a Next.js dependency), not SVG,
 * because serving SVG through next/image requires `dangerouslyAllowSVG`, and
 * enabling that globally to display placeholders is a poor trade.
 *
 * Run with: npm run gen:images
 */

const OUT_ROOT = path.join(process.cwd(), 'public');

// ── Colour helpers ───────────────────────────────────────────────────────────

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const to = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Mixes toward white (`amount` > 0) or black (`amount` < 0). */
function mix(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const target = amount > 0 ? 255 : 0;
  const t = Math.abs(amount);
  return rgbToHex({
    r: r + (target - r) * t,
    g: g + (target - g) * t,
    b: b + (target - b) * t,
  });
}

/** Perceived brightness, 0–1. Used to decide which way to shift a tone. */
function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Derives a three-tone scheme from a garment colour.
 *
 * The silhouette must stay visible against its own ground, so a pale colour
 * (ivory, cream) darkens its silhouette while a dark one (black, midnight)
 * lightens the ground instead. Without this, black garments render as a black
 * square.
 */
function scheme(baseHex: string) {
  const light = luminance(baseHex) > 0.62;
  const veryDark = luminance(baseHex) < 0.18;

  return {
    groundTop: light ? mix(baseHex, 0.55) : mix(baseHex, veryDark ? 0.82 : 0.7),
    groundBottom: light ? mix(baseHex, 0.3) : mix(baseHex, veryDark ? 0.68 : 0.52),
    garment: light ? mix(baseHex, -0.12) : baseHex,
    /**
     * Sleeve tone. Kept close to the garment: at -0.28 a cream kameez read as
     * a two-tone garment with grey sleeves rather than one piece in shadow.
     */
    garmentShade: light ? mix(baseHex, -0.16) : mix(baseHex, -0.2),
    detail: light ? mix(baseHex, -0.45) : mix(baseHex, 0.35),
    ink: light ? mix(baseHex, -0.62) : mix(baseHex, 0.55),
  };
}

// ── Garment silhouettes ──────────────────────────────────────────────────────

type Silhouette = 'abaya' | 'womens' | 'stole' | 'girls' | 'boys';

/**
 * Path data drawn on a 0 0 400 560 canvas, then scaled by the caller.
 * Shapes echo the measurement diagram so the two feel like one family.
 */
function silhouettePaths(kind: Silhouette): {
  sleeves: string[];
  body: string[];
  accents: string[];
} {
  switch (kind) {
    case 'abaya':
      return {
        // Drawn behind the body, and reaching well outside its flare, so the
        // sleeve reads as a sleeve rather than merging into the skirt.
        sleeves: [
          'M154 120 L92 152 L54 316 L104 330 L150 176 Z',
          'M246 120 L308 152 L346 316 L296 330 L250 176 Z',
        ],
        body: [
          // Full-length flared body
          'M150 118 Q200 100 250 118 L318 512 L82 512 Z',
        ],
        accents: [
          // Centre placket
          'M200 112 L200 512',
          // Cuff bands
          'M86 292 L126 302',
          'M274 302 L314 292',
        ],
      };

    case 'womens':
      return {
        sleeves: [
          'M152 118 L104 142 L86 268 L126 278 L148 160 Z',
          'M248 118 L296 142 L314 268 L274 278 L252 160 Z',
        ],
        body: [
          // Kameez
          'M152 118 Q200 100 248 118 L266 356 Q200 372 134 356 Z',
          // Shalwar
          'M138 356 L128 528 L192 528 L198 372 Z',
          'M262 356 L272 528 L208 528 L202 372 Z',
        ],
        accents: [
          // Neckline
          'M176 112 Q200 152 224 112',
          // Hem embroidery band
          'M138 330 L262 330',
        ],
      };

    case 'stole':
      return {
        sleeves: [],
        body: [
          // A draped rectangle with a soft fold
          'M110 120 Q200 96 290 120 L306 470 Q200 500 94 470 Z',
        ],
        accents: [
          'M132 150 Q200 130 268 150',
          'M126 240 Q200 220 274 240',
          'M122 330 Q200 312 278 330',
          'M118 420 Q200 402 282 420',
        ],
      };

    case 'girls':
      return {
        sleeves: [
          'M160 130 L122 150 L108 226 L140 234 L158 164 Z',
          'M240 130 L278 150 L292 226 L260 234 L242 164 Z',
        ],
        body: [
          // Fitted bodice
          'M160 130 Q200 114 240 130 L248 250 L152 250 Z',
          // Full skirt
          'M152 250 L96 470 Q200 500 304 470 L248 250 Z',
        ],
        accents: ['M180 124 Q200 152 220 124', 'M152 250 L248 250', 'M112 430 Q200 456 288 430'],
      };

    case 'boys':
      return {
        sleeves: [
          'M156 124 L114 146 L98 276 L134 284 L152 166 Z',
          'M244 124 L286 146 L302 276 L266 284 L248 166 Z',
        ],
        body: [
          // Straight kurta with mandarin collar
          'M156 124 Q200 108 244 124 L258 372 L142 372 Z',
          // Shalwar
          'M146 372 L138 528 L196 528 L199 388 Z',
          'M254 372 L262 528 L204 528 L201 388 Z',
        ],
        accents: ['M186 118 L186 138 L214 138 L214 118', 'M200 146 L200 250'],
      };
  }
}

// ── SVG composition ──────────────────────────────────────────────────────────

interface ArtworkOptions {
  width: number;
  height: number;
  baseHex: string;
  kind: Silhouette;
  /** "detail" swaps the silhouette for a fabric-weave study. */
  variant?: 'front' | 'detail';
  caption?: string;
}

function artworkSvg({
  width,
  height,
  baseHex,
  kind,
  variant = 'front',
  caption,
}: ArtworkOptions): string {
  const c = scheme(baseHex);
  const id = Math.random().toString(36).slice(2, 8);

  // The silhouette is drawn on a 400x560 grid, centred and scaled to fit.
  const scale = Math.min(width / 400, height / 560) * 0.86;
  const tx = (width - 400 * scale) / 2;
  const ty = (height - 560 * scale) / 2;

  const { sleeves, body, accents } = silhouettePaths(kind);

  const figure =
    variant === 'front'
      ? `
    <g transform="translate(${tx} ${ty}) scale(${scale})">
      <!--
        Sleeves are drawn first, behind the body, in a deeper tone. Drawn on
        top and in the same colour they merged into the flared skirt and the
        abaya read as a boxy jacket over a triangle.
      -->
      <g fill="${c.garmentShade}">
        ${sleeves.map((d) => `<path d="${d}" />`).join('\n        ')}
      </g>
      <g fill="${c.garment}">
        ${body.map((d) => `<path d="${d}" />`).join('\n        ')}
      </g>
      <g fill="none" stroke="${c.detail}" stroke-width="2.5" stroke-linecap="round" opacity="0.8">
        ${accents.map((d) => `<path d="${d}" />`).join('\n        ')}
      </g>
    </g>`
      : `
    <g opacity="0.9">
      <rect x="${width * 0.12}" y="${height * 0.14}" width="${width * 0.76}" height="${height * 0.72}" rx="${width * 0.02}" fill="${c.garment}" />
      <g stroke="${c.detail}" stroke-width="1.6" opacity="0.5">
        ${Array.from({ length: 22 }, (_, i) => {
          const y = height * 0.14 + ((i + 1) * (height * 0.72)) / 23;
          return `<line x1="${width * 0.12}" y1="${y}" x2="${width * 0.88}" y2="${y}" />`;
        }).join('\n        ')}
      </g>
      <g stroke="${c.garmentShade}" stroke-width="1.2" opacity="0.45">
        ${Array.from({ length: 16 }, (_, i) => {
          const x = width * 0.12 + ((i + 1) * (width * 0.76)) / 17;
          return `<line x1="${x}" y1="${height * 0.14}" x2="${x}" y2="${height * 0.86}" />`;
        }).join('\n        ')}
      </g>
      <g fill="${c.detail}" opacity="0.55">
        ${Array.from({ length: 5 }, (_, row) =>
          Array.from({ length: 4 }, (_, col) => {
            const cx = width * 0.24 + col * (width * 0.176);
            const cy = height * 0.26 + row * (height * 0.13);
            return `<circle cx="${cx}" cy="${cy}" r="${width * 0.012}" />`;
          }).join(''),
        ).join('\n        ')}
      </g>
    </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="g${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${c.groundTop}" />
      <stop offset="100%" stop-color="${c.groundBottom}" />
    </linearGradient>
  </defs>

  <rect width="${width}" height="${height}" fill="url(#g${id})" />

  <!-- A soft vignette so the silhouette does not float on a flat field. -->
  <ellipse cx="${width / 2}" cy="${height * 0.52}" rx="${width * 0.46}" ry="${height * 0.44}"
           fill="${c.groundTop}" opacity="0.35" />

  ${figure}

  ${
    caption
      ? `<text x="${width / 2}" y="${height - height * 0.045}" text-anchor="middle"
              font-family="Georgia, 'Times New Roman', serif" font-size="${Math.round(width * 0.032)}"
              fill="${c.ink}" opacity="0.85" letter-spacing="${width * 0.004}">${escapeXml(caption)}</text>`
      : ''
  }
</svg>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── What to generate ─────────────────────────────────────────────────────────

interface ProductSpec {
  sku: string;
  kind: Silhouette;
  baseHex: string;
  caption: string;
  variants: { sku: string; hex: string; name: string }[];
}

const PRODUCTS: ProductSpec[] = [
  {
    sku: 'MS-W-0001',
    kind: 'womens',
    baseHex: '#F2EDE4',
    caption: 'Noor Embroidered Three Piece',
    variants: [
      { sku: 'MS-W-0001-IVR', hex: '#F2EDE4', name: 'Ivory' },
      { sku: 'MS-W-0001-SGE', hex: '#A8B5A0', name: 'Sage' },
      { sku: 'MS-W-0001-RSE', hex: '#C9A0A0', name: 'Dusty rose' },
    ],
  },
  {
    sku: 'MS-W-0002',
    kind: 'womens',
    baseHex: '#1F2A44',
    caption: 'Sana Silk Formal Two Piece',
    variants: [
      { sku: 'MS-W-0002-MID', hex: '#1F2A44', name: 'Midnight' },
      { sku: 'MS-W-0002-GLD', hex: '#C9A227', name: 'Antique gold' },
    ],
  },
  {
    sku: 'MS-A-0001',
    kind: 'abaya',
    baseHex: '#14110F',
    caption: 'Noor Nida Everyday Abaya',
    variants: [
      { sku: 'MS-A-0001-BLK', hex: '#14110F', name: 'Black' },
      { sku: 'MS-A-0001-NVY', hex: '#1B2A3A', name: 'Navy' },
      { sku: 'MS-A-0001-MOC', hex: '#6B5545', name: 'Mocha' },
    ],
  },
  {
    sku: 'MS-A-0002',
    kind: 'abaya',
    baseHex: '#3A3A3A',
    caption: 'Layla Occasion Abaya',
    variants: [
      { sku: 'MS-A-0002-BLK', hex: '#14110F', name: 'Black' },
      { sku: 'MS-A-0002-CHR', hex: '#3A3A3A', name: 'Charcoal' },
    ],
  },
  {
    sku: 'MS-S-0001',
    kind: 'stole',
    baseHex: '#5C3A4E',
    caption: 'Georgette Everyday Stole',
    variants: [
      { sku: 'MS-S-0001-BLK', hex: '#14110F', name: 'Black' },
      { sku: 'MS-S-0001-CRM', hex: '#EFE6D8', name: 'Cream' },
      { sku: 'MS-S-0001-OLV', hex: '#6B7250', name: 'Olive' },
      { sku: 'MS-S-0001-PLM', hex: '#5C3A4E', name: 'Plum' },
    ],
  },
  {
    sku: 'MS-S-0002',
    kind: 'stole',
    baseHex: '#9A9A93',
    caption: 'Cotton Jersey Stole',
    variants: [
      { sku: 'MS-S-0002-GRY', hex: '#9A9A93', name: 'Heather grey' },
      { sku: 'MS-S-0002-NVY', hex: '#1B2A3A', name: 'Navy' },
    ],
  },
  {
    sku: 'MS-G-0001',
    kind: 'girls',
    baseHex: '#F2C4B0',
    caption: 'Gul Girls Embroidered Frock',
    variants: [
      { sku: 'MS-G-0001-PCH', hex: '#F2C4B0', name: 'Peach' },
      { sku: 'MS-G-0001-MNT', hex: '#BEDCCB', name: 'Mint' },
    ],
  },
  {
    sku: 'MS-B-0001',
    kind: 'boys',
    baseHex: '#D9CBB3',
    caption: 'Ali Boys Kurta Set',
    variants: [
      { sku: 'MS-B-0001-WHT', hex: '#F7F5F0', name: 'White' },
      { sku: 'MS-B-0001-BEI', hex: '#D9CBB3', name: 'Beige' },
    ],
  },
];

const CATEGORIES: { slug: string; kind: Silhouette; hex: string; caption: string }[] = [
  { slug: 'womens', kind: 'womens', hex: '#C9A0A0', caption: "Women's" },
  { slug: 'abayas', kind: 'abaya', hex: '#1B2A3A', caption: 'Abayas' },
  { slug: 'stoles', kind: 'stole', hex: '#6B7250', caption: 'Stoles' },
  { slug: 'girls', kind: 'girls', hex: '#F2C4B0', caption: "Girls'" },
  { slug: 'boys', kind: 'boys', hex: '#D9CBB3', caption: "Boys'" },
];

// ── Rendering ────────────────────────────────────────────────────────────────

async function render(svg: string, outPath: string): Promise<number> {
  const buffer = await sharp(Buffer.from(svg)).webp({ quality: 82, effort: 5 }).toBuffer();
  await writeFile(outPath, buffer);
  return buffer.byteLength;
}

async function main() {
  const productDir = path.join(OUT_ROOT, 'products');
  const categoryDir = path.join(OUT_ROOT, 'categories');
  await mkdir(productDir, { recursive: true });
  await mkdir(categoryDir, { recursive: true });

  let count = 0;
  let bytes = 0;

  // Product images: a front view and a fabric detail, 3:4 to match the card.
  for (const product of PRODUCTS) {
    bytes += await render(
      artworkSvg({
        width: 900,
        height: 1200,
        baseHex: product.baseHex,
        kind: product.kind,
        variant: 'front',
        caption: 'MomiShop',
      }),
      path.join(productDir, `${product.sku}-1.webp`),
    );

    bytes += await render(
      artworkSvg({
        width: 900,
        height: 1200,
        baseHex: product.baseHex,
        kind: product.kind,
        variant: 'detail',
      }),
      path.join(productDir, `${product.sku}-2.webp`),
    );
    count += 2;

    // One per colour variant, so switching colour visibly changes the photo.
    for (const variant of product.variants) {
      bytes += await render(
        artworkSvg({
          width: 900,
          height: 1200,
          baseHex: variant.hex,
          kind: product.kind,
          variant: 'front',
          caption: variant.name,
        }),
        path.join(productDir, `${variant.sku}.webp`),
      );
      count++;
    }
  }

  // Category tiles, 4:5 to match the homepage grid.
  for (const category of CATEGORIES) {
    bytes += await render(
      artworkSvg({
        width: 800,
        height: 1000,
        baseHex: category.hex,
        kind: category.kind,
        variant: 'front',
        caption: category.caption,
      }),
      path.join(categoryDir, `${category.slug}.webp`),
    );
    count++;
  }

  // Hero, wider and calmer than the product shots.
  bytes += await render(
    artworkSvg({
      width: 1400,
      height: 1750,
      baseHex: '#C9A0A0',
      kind: 'abaya',
      variant: 'front',
      caption: 'Cut to your measurements',
    }),
    path.join(OUT_ROOT, 'hero.webp'),
  );
  count++;

  console.log(`Generated ${count} images (${(bytes / 1024).toFixed(0)} KB total)`);
  console.log(`  products:   ${productDir}`);
  console.log(`  categories: ${categoryDir}`);
}

main().catch((error) => {
  console.error('Image generation failed:', error);
  process.exitCode = 1;
});
