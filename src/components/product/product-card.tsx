import Image from 'next/image';
import Link from 'next/link';
import { Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatMoney, type Currency } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { ProductCard as ProductCardData } from '@/server/catalogue';

/**
 * Product card.
 *
 * The whole card is one link with a single accessible name, rather than a card
 * containing several competing links. A grid of cards each exposing "image
 * link, title link, price link" makes screen-reader and keyboard navigation
 * three times longer for no benefit.
 *
 * `priority` should be set on the first few cards above the fold — those
 * images are usually the LCP element, and letting them lazy-load costs a
 * visible chunk of the score.
 */
export function ProductCard({
  product,
  priority = false,
  className,
}: {
  product: ProductCardData;
  priority?: boolean;
  className?: string;
}) {
  const primary = product.images[0];
  const hover = product.images[1];
  const currency = product.currency as Currency;

  const onSale =
    product.compareAtPrice !== null && product.compareAtPrice > product.basePrice;
  const discountPercent = onSale
    ? Math.round(((product.compareAtPrice! - product.basePrice) / product.compareAtPrice!) * 100)
    : 0;

  return (
    <article className={cn('group', className)}>
      <Link
        href={`/products/${product.slug}`}
        className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-muted">
          {primary ? (
            <>
              <Image
                src={primary.url}
                alt={primary.alt}
                fill
                priority={priority}
                loading={priority ? undefined : 'lazy'}
                // Two columns on phones, three on tablets, four on desktop —
                // matching the grid so the browser never downloads an
                // oversized file for a small slot.
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                className={cn(
                  'object-cover transition-opacity duration-300',
                  hover && 'group-hover:opacity-0',
                )}
              />
              {hover && (
                <Image
                  src={hover.url}
                  alt=""
                  fill
                  loading="lazy"
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                  aria-hidden="true"
                  className="object-cover opacity-0 transition-opacity duration-300 group-hover:opacity-100 motion-reduce:hidden"
                />
              )}
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No image yet
            </div>
          )}

          <div className="absolute start-2 top-2 flex flex-col items-start gap-1">
            {product.isNewArrival && <Badge variant="default">New</Badge>}
            {onSale && <Badge variant="destructive">{discountPercent}% off</Badge>}
          </div>
        </div>

        <div className="mt-3 space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {product.category.name}
          </p>

          <h3 className="line-clamp-2 text-sm font-medium leading-snug">{product.name}</h3>

          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-serif text-base font-semibold">
              {formatMoney(product.basePrice, currency)}
            </span>
            {onSale && (
              <>
                <span aria-hidden="true" className="text-xs text-muted-foreground line-through">
                  {formatMoney(product.compareAtPrice!, currency)}
                </span>
                <span className="sr-only">
                  reduced from {formatMoney(product.compareAtPrice!, currency)}
                </span>
              </>
            )}
          </div>

          {product.ratingCount > 0 && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Star className="size-3 fill-current text-warning" aria-hidden="true" />
              <span>
                {product.ratingAverage.toFixed(1)}
                <span className="sr-only"> out of 5</span>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {product.ratingCount} review{product.ratingCount === 1 ? '' : 's'}
              </span>
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            Stitched to your measurements · ready in ~{product.stitchingDays} days
          </p>
        </div>
      </Link>
    </article>
  );
}
