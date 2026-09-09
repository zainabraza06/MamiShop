import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Truck, RotateCcw, ShieldCheck } from 'lucide-react';
import {
  getProductBySlug,
  getPublishedProductSlugs,
  getRatingBreakdown,
  getRelatedProducts,
  getProductReviews,
} from '@/server/catalogue';
import { getCurrentUser } from '@/server/session';
import { prisma } from '@/lib/db';
import { ProductDetail } from '@/components/product/product-detail';
import { ProductCard } from '@/components/product/product-card';
import { ReviewList } from '@/components/product/review-list';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { formatMoney, type Currency } from '@/lib/money';
import { absoluteUrl, serializable, truncate } from '@/lib/utils';
import type { MeasurementTemplateKey } from '@/lib/measurements';

/**
 * Product detail page.
 *
 * Incrementally static: prebuilt for the best-selling products at deploy time,
 * generated on first request for the rest, and revalidated hourly. This is the
 * highest-traffic page type on the site, and its content changes at the pace
 * an admin edits it, not per visitor.
 *
 * `dynamicParams` stays true so a newly added product is reachable immediately
 * rather than 404ing until the next deploy.
 */
export const revalidate = 3600;
export const dynamicParams = true;

export async function generateStaticParams() {
  const slugs = await getPublishedProductSlugs(200);
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);

  if (!product) return { title: 'Product not found' };

  const description =
    product.metaDescription ??
    product.shortDescription ??
    truncate(product.description ?? `${product.name} — stitched to your measurements.`, 155);

  const image = product.images[0];

  return {
    title: product.metaTitle ?? product.name,
    description,
    alternates: { canonical: `/products/${product.slug}` },
    openGraph: {
      type: 'website',
      title: product.metaTitle ?? product.name,
      description,
      url: absoluteUrl(`/products/${product.slug}`),
      images: image ? [{ url: image.url, alt: image.alt }] : undefined,
    },
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);

  if (!product) notFound();

  const currency = product.currency as Currency;

  // The sizing template falls back through product -> category -> a sane
  // default, so a product added without one still renders a usable form.
  const template = (product.sizingTemplate ??
    product.category.sizingTemplate ??
    'WOMENS_STITCHED') as MeasurementTemplateKey;

  const user = await getCurrentUser();

  const [related, reviews, ratingBreakdown, savedProfiles] = await Promise.all([
    getRelatedProducts(product.id, product.categoryId, product.basePrice),
    getProductReviews(product.id, 5),
    getRatingBreakdown(product.id),
    user
      ? prisma.measurementProfile.findMany({
          where: { userId: user.id, deletedAt: null, template },
          orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
          select: { id: true, label: true, unit: true, values: true, isDefault: true },
        })
      : Promise.resolve([]),
  ]);

  /**
   * Product structured data.
   *
   * Drives the rich result (price, availability, star rating) in Google. The
   * `aggregateRating` block is only emitted when reviews actually exist —
   * Google flags a rating with no reviews as a structured-data error.
   */
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.shortDescription ?? product.description ?? undefined,
    sku: product.sku,
    image: product.images.map((i) => i.url),
    brand: { '@type': 'Brand', name: 'MomiShop' },
    material: product.fabric ?? undefined,
    offers: {
      '@type': 'Offer',
      url: absoluteUrl(`/products/${product.slug}`),
      priceCurrency: currency,
      price: (product.basePrice / 100).toFixed(2),
      availability: 'https://schema.org/InStock',
      itemCondition: 'https://schema.org/NewCondition',
    },
    ...(product.ratingCount > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: product.ratingAverage.toFixed(1),
            reviewCount: product.ratingCount,
          },
        }
      : {}),
  };

  return (
    <>
      <script
        type="application/ld+json"
        // Structured data must be raw JSON in the document; the content is
        // built from our own database rows, not user input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="container py-6">
        <Breadcrumbs
          items={[
            { label: 'Home', href: '/' },
            ...(product.category.parent
              ? [
                  {
                    label: product.category.parent.name,
                    href: `/products?category=${product.category.parent.slug}`,
                  },
                ]
              : []),
            {
              label: product.category.name,
              href: `/products?category=${product.category.slug}`,
            },
            { label: product.name },
          ]}
        />

        <ProductDetail
          product={serializable({
            id: product.id,
            slug: product.slug,
            name: product.name,
            sku: product.sku,
            basePrice: product.basePrice,
            compareAtPrice: product.compareAtPrice,
            currency: product.currency,
            shortDescription: product.shortDescription,
            description: product.description,
            careInstructions: product.careInstructions,
            fabric: product.fabric,
            pieces: product.pieces,
            stitchingDays: product.stitchingDays,
            requiresMeasurements: product.requiresMeasurements,
            ratingAverage: product.ratingAverage,
            ratingCount: product.ratingCount,
            variants: product.variants,
            images: product.images,
          })}
          template={template}
          savedProfiles={serializable(savedProfiles)}
          isSignedIn={Boolean(user)}
        />

        {/* Reassurance block: the three questions every made-to-order shopper asks. */}
        <ul className="mt-12 grid gap-6 border-y py-8 sm:grid-cols-3">
          {[
            {
              icon: Truck,
              title: 'Tracked delivery',
              body: `Free over ${formatMoney(500_000, currency)}. Cash on delivery available.`,
            },
            {
              icon: RotateCcw,
              title: '7-day returns',
              body: 'If the fit is wrong, we will alter or remake it. See our returns policy.',
            },
            {
              icon: ShieldCheck,
              title: 'Measured, not guessed',
              body: 'Cut to the numbers you give us, checked by a tailor before stitching.',
            },
          ].map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex gap-3">
              <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold">{title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{body}</p>
              </div>
            </li>
          ))}
        </ul>

        <ReviewList
          productId={product.id}
          initialReviews={serializable(reviews.items)}
          nextCursor={reviews.nextCursor}
          ratingAverage={product.ratingAverage}
          ratingCount={product.ratingCount}
          breakdown={ratingBreakdown}
          canReview={Boolean(user)}
        />

        {related.length > 0 && (
          <section aria-labelledby="related-products" className="mt-16">
            <h2 id="related-products" className="text-display font-semibold">
              You may also like
            </h2>
            <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-4">
              {related.map((item) => (
                <ProductCard key={item.id} product={item} />
              ))}
            </div>
          </section>
        )}

        <p className="mt-12 text-sm text-muted-foreground">
          Not sure how to measure?{' '}
          <Link href="/measuring-guide" className="underline underline-offset-4">
            Read our step-by-step guide
          </Link>
          .
        </p>
      </div>
    </>
  );
}
