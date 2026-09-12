import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Ruler, Scissors, Truck } from 'lucide-react';
import type { Metadata } from 'next';
import type { HomepageContent } from '@momishop/shared/api-types';
import { Button } from '@/components/ui/button';
import { ProductCard } from '@/components/product/product-card';
import { apiGet } from '@/lib/api';

/**
 * Homepage.
 *
 * Rendered per request, like every storefront page: the shell around it shows
 * the visitor's own bag count. The content itself changes at editorial pace,
 * so the API caches it, and a render costs a cache read rather than a
 * catalogue query.
 */

export const metadata: Metadata = {
  title: 'Made-to-measure modest fashion',
  description:
    'Women’s, girls’ and boys’ clothing, abayas and stoles — stitched to your own measurements. Free delivery over Rs 5,000 across Pakistan.',
  alternates: { canonical: '/' },
};

interface HeroData {
  headline?: string;
  subhead?: string;
  ctaLabel?: string;
  ctaHref?: string;
  imageUrl?: string;
  imageAlt?: string;
}

export default async function HomePage() {
  const { blocks, categories, featured, newArrivals } =
    await apiGet<HomepageContent>('/storefront/home');

  const hero = (blocks.find((b) => b.type === 'HERO')?.data ?? {}) as HeroData;

  return (
    <>
      {/* Hero */}
      <section className="relative isolate overflow-hidden bg-secondary/50">
        <div className="container grid items-center gap-10 py-16 lg:grid-cols-2 lg:py-24">
          <div className="max-w-xl animate-fade-up">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-primary">
              No standard sizes
            </p>
            <h1 className="mt-4 text-display-lg font-semibold">
              {hero.headline ?? 'Cut to your measurements, not to a size chart'}
            </h1>
            <p className="mt-5 text-base leading-relaxed text-muted-foreground sm:text-lg">
              {hero.subhead ??
                'Every piece is stitched to the numbers you give us. Tell us your measurements once, and we will keep them on file for every order after.'}
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" asChild>
                <Link href={hero.ctaHref ?? '/products'}>
                  {hero.ctaLabel ?? 'Shop the collection'}
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/measuring-guide">How to measure</Link>
              </Button>
            </div>
          </div>

          <div className="relative aspect-[4/5] overflow-hidden rounded-lg bg-muted lg:aspect-[3/4]">
            {hero.imageUrl ? (
              <Image
                src={hero.imageUrl}
                alt={hero.imageAlt ?? ''}
                fill
                // The hero image is the LCP element on this page, so it is
                // fetched eagerly at high priority rather than lazy-loaded.
                priority
                sizes="(max-width: 1024px) 100vw, 50vw"
                className="object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Add a hero image from the admin dashboard
              </div>
            )}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section aria-labelledby="how-it-works" className="border-b py-14">
        <div className="container">
          <h2 id="how-it-works" className="sr-only">
            How ordering works
          </h2>
          <ul className="grid gap-8 sm:grid-cols-3">
            {[
              {
                icon: Ruler,
                title: 'Send your measurements',
                body: 'Fill in our guided form once. We save it to your account for next time.',
              },
              {
                icon: Scissors,
                title: 'We cut and stitch',
                body: 'Your pieces are cut to your numbers by our workshop, never to a size chart.',
              },
              {
                icon: Truck,
                title: 'Delivered to your door',
                body: 'Tracked delivery nationwide, with cash on delivery available.',
              },
            ].map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-4">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent">
                  <Icon className="size-5 text-accent-foreground" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="font-serif text-base font-semibold">{title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Categories */}
      {categories.length > 0 && (
        <section aria-labelledby="shop-by-category" className="py-14">
          <div className="container">
            <h2 id="shop-by-category" className="text-display font-semibold">
              Shop by category
            </h2>

            <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {categories.slice(0, 4).map((category) => (
                <li key={category.id}>
                  <Link
                    href={`/products?category=${category.slug}`}
                    className="group block overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <div className="relative aspect-[4/5] bg-muted">
                      {category.imageUrl ? (
                        <Image
                          src={category.imageUrl}
                          alt=""
                          fill
                          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                          className="object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transform-none"
                        />
                      ) : null}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-foreground/70 to-transparent p-4">
                        <p className="font-serif text-lg font-semibold text-background">
                          {category.name}
                        </p>
                        <p className="text-xs text-background/80">
                          {category.productCount} piece{category.productCount === 1 ? '' : 's'}
                        </p>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Featured */}
      {featured.length > 0 && (
        <section aria-labelledby="featured" className="py-14">
          <div className="container">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <h2 id="featured" className="text-display font-semibold">
                Loved by our customers
              </h2>
              <Button variant="link" asChild className="px-0">
                <Link href="/products?sort=popular">
                  View all
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </div>

            <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 lg:grid-cols-4">
              {featured.map((product, index) => (
                <ProductCard key={product.id} product={product} priority={index < 4} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* New arrivals */}
      {newArrivals.length > 0 && (
        <section aria-labelledby="new-arrivals" className="pb-14">
          <div className="container">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <h2 id="new-arrivals" className="text-display font-semibold">
                Just arrived
              </h2>
              <Button variant="link" asChild className="px-0">
                <Link href="/products?sort=newest">
                  View all
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </div>

            <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 lg:grid-cols-4">
              {newArrivals.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
