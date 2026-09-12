import type { Metadata } from 'next';
import Link from 'next/link';
import { Star } from 'lucide-react';
import type { AdminReviewList, ReviewStatus } from '@momishop/shared/api-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ReviewDecision } from '@/components/admin/moderation-actions';
import { apiGet } from '@/lib/api';
import { formatDate } from '@/lib/utils';

export const metadata: Metadata = { title: 'Reviews' };

const TABS: { label: string; status: ReviewStatus }[] = [
  { label: 'Waiting', status: 'PENDING' },
  { label: 'Published', status: 'APPROVED' },
  { label: 'Rejected', status: 'REJECTED' },
];

/**
 * Review moderation.
 *
 * Reviews arrive unpublished: a made-to-measure shop attracts fit complaints
 * that are better answered than deleted, and publishing automatically would
 * put an unanswered one on the product page.
 */
export default async function AdminReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const status = (typeof params.status === 'string' ? params.status : 'PENDING') as ReviewStatus;

  const { items, countsByStatus } = await apiGet<AdminReviewList>(
    `/admin/reviews?status=${status}`,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Reviews</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Publishing a review recomputes the product&apos;s star rating.
        </p>
      </div>

      <nav aria-label="Filter by status">
        <ul className="flex flex-wrap gap-2">
          {TABS.map((tab) => (
            <li key={tab.status}>
              <Button variant={tab.status === status ? 'default' : 'outline'} size="sm" asChild>
                <Link
                  href={`/admin/reviews?status=${tab.status}`}
                  aria-current={tab.status === status ? 'page' : undefined}
                >
                  {tab.label}
                  <span className="ms-1.5 tabular-nums opacity-70">
                    {countsByStatus[tab.status] ?? 0}
                  </span>
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      </nav>

      {items.length === 0 ? (
        <EmptyState
          icon={Star}
          title={status === 'PENDING' ? 'Nothing waiting' : 'Nothing here'}
          description={
            status === 'PENDING'
              ? 'New reviews will appear here for you to publish or reject.'
              : 'No reviews with that status.'
          }
        />
      ) : (
        <ul className="space-y-4">
          {items.map((review) => (
            <li key={review.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium">
                    <span aria-label={`${review.rating} out of 5 stars`} className="text-warning">
                      {'★'.repeat(review.rating)}
                      <span className="text-muted-foreground">{'★'.repeat(5 - review.rating)}</span>
                    </span>
                    {review.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {review.user.name ?? review.user.email} on{' '}
                    <Link
                      href={`/products/${review.product.slug}`}
                      className="underline underline-offset-4"
                    >
                      {review.product.name}
                    </Link>{' '}
                    · {formatDate(review.createdAt)}
                  </p>
                </div>

                {review.isVerifiedPurchase && <Badge variant="secondary">Verified purchase</Badge>}
              </div>

              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{review.body}</p>

              {status === 'PENDING' && (
                <div className="mt-4">
                  <ReviewDecision reviewId={review.id} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
