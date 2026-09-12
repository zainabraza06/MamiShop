'use client';

import * as React from 'react';
import Image from 'next/image';
import { BadgeCheck, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDate } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface Review {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  photos: string[];
  isVerifiedPurchase: boolean;
  createdAt: string | Date;
  user: { name: string | null; image: string | null };
}

/**
 * Customer reviews.
 *
 * Only approved reviews reach this component — moderation happens server-side,
 * so unapproved content is never sent to the browser at all rather than being
 * filtered out in the client where it could be read from the payload.
 *
 * Reviewer names are shown as a first name plus initial ("Ayesha K.") because
 * the full name on a public page is more personal data than a review needs.
 */
export function ReviewList({
  productId,
  initialReviews,
  nextCursor: initialCursor,
  ratingAverage,
  ratingCount,
  breakdown,
  canReview,
}: {
  productId: string;
  initialReviews: Review[];
  nextCursor: string | null;
  ratingAverage: number;
  ratingCount: number;
  breakdown: Record<number, number>;
  canReview: boolean;
}) {
  const [reviews, setReviews] = React.useState(initialReviews);
  const [cursor, setCursor] = React.useState(initialCursor);
  const [isLoading, setIsLoading] = React.useState(false);

  async function loadMore() {
    if (!cursor || isLoading) return;
    setIsLoading(true);
    try {
      const response = await fetch(
        `/api/products/${productId}/reviews?cursor=${encodeURIComponent(cursor)}`,
      );
      if (!response.ok) throw new Error('Failed to load reviews');
      const body = (await response.json()) as { items: Review[]; nextCursor: string | null };
      setReviews((current) => [...current, ...body.items]);
      setCursor(body.nextCursor);
    } catch {
      // A failed "load more" leaves the existing reviews on screen; the button
      // simply becomes available again to retry.
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section id="reviews" aria-labelledby="reviews-heading" className="mt-16 scroll-mt-24">
      <h2 id="reviews-heading" className="text-display font-semibold">
        Customer reviews
      </h2>

      {ratingCount === 0 ? (
        <EmptyState
          icon={Star}
          title="No reviews yet"
          description="Be the first to tell others how the fit and fabric worked out."
          className="mt-6"
          action={
            canReview ? (
              <Button asChild>
                <a href={`/account/reviews/new?product=${productId}`}>Write a review</a>
              </Button>
            ) : (
              <Button variant="outline" asChild>
                <a href="/login">Sign in to review</a>
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="mt-6 grid gap-8 sm:grid-cols-[auto_1fr] sm:items-start">
            <div className="text-center sm:text-left">
              <p className="font-serif text-4xl font-semibold">{ratingAverage.toFixed(1)}</p>
              <Stars rating={ratingAverage} />
              <p className="mt-1 text-sm text-muted-foreground">
                {ratingCount} review{ratingCount === 1 ? '' : 's'}
              </p>
            </div>

            {/* Rating histogram */}
            <ul className="space-y-1.5">
              {[5, 4, 3, 2, 1].map((star) => {
                const count = breakdown[star] ?? 0;
                const percent = ratingCount > 0 ? Math.round((count / ratingCount) * 100) : 0;
                return (
                  <li key={star} className="flex items-center gap-3 text-sm">
                    <span className="w-12 shrink-0 text-muted-foreground">{star} star</span>
                    <span
                      role="img"
                      aria-label={`${percent}% of reviews are ${star} star`}
                      className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
                    >
                      <span
                        className="block h-full rounded-full bg-warning"
                        style={{ width: `${percent}%` }}
                      />
                    </span>
                    <span className="w-8 shrink-0 text-end text-muted-foreground">{count}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          <ul className="mt-10 space-y-8">
            {reviews.map((review) => (
              <li key={review.id} className="border-b pb-8 last:border-0">
                <article>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <p className="font-medium">{displayName(review.user.name)}</p>
                    {review.isVerifiedPurchase && (
                      <Badge variant="success" className="gap-1">
                        <BadgeCheck className="size-3" aria-hidden="true" />
                        Verified purchase
                      </Badge>
                    )}
                    <time
                      dateTime={new Date(review.createdAt).toISOString()}
                      className="text-sm text-muted-foreground"
                    >
                      {formatDate(review.createdAt)}
                    </time>
                  </div>

                  <Stars rating={review.rating} className="mt-2" />

                  {review.title && <h3 className="mt-2 font-semibold">{review.title}</h3>}

                  <p className="mt-2 whitespace-pre-line leading-relaxed text-muted-foreground">
                    {review.body}
                  </p>

                  {review.photos.length > 0 && (
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {review.photos.map((photo, index) => (
                        <li key={photo} className="relative size-20 overflow-hidden rounded-md">
                          <Image
                            src={photo}
                            alt={`Customer photo ${index + 1} for this review`}
                            fill
                            sizes="80px"
                            className="object-cover"
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              </li>
            ))}
          </ul>

          {cursor && (
            <div className="mt-8 text-center">
              <Button variant="outline" onClick={loadMore} isLoading={isLoading}>
                Load more reviews
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** "Ayesha Khan" -> "Ayesha K." Falls back gracefully for single names. */
function displayName(name: string | null): string {
  if (!name) return 'Verified customer';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

/**
 * Star rating.
 *
 * The stars themselves are `aria-hidden`; the rating is announced once as
 * text. Otherwise a screen reader reads "star star star star star" on every
 * review, which is unusable.
 */
function Stars({ rating, className }: { rating: number; className?: string }) {
  return (
    <p className={cn('flex items-center gap-0.5', className)}>
      <span aria-hidden="true" className="flex">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={cn(
              'size-4',
              star <= Math.round(rating) ? 'fill-current text-warning' : 'text-muted-foreground/30',
            )}
          />
        ))}
      </span>
      <span className="sr-only">{rating.toFixed(1)} out of 5 stars</span>
    </p>
  );
}
