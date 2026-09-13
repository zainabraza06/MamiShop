import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import type { QuoteCheckoutContext } from '@momishop/shared/api-types';
import { QuoteCheckoutForm } from '@/components/account/quote-checkout-form';
import { Button } from '@/components/ui/button';
import { ApiError, apiGet } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Accept your quote',
  robots: { index: false, follow: false },
};

export default async function AcceptQuotePage({
  params,
}: {
  params: Promise<{ id: string; quoteId: string }>;
}) {
  const { id, quoteId } = await params;
  const back = `/account/custom-requests/${id}`;

  const result = await apiGet<QuoteCheckoutContext>(
    `/custom-requests/${id}/quotes/${quoteId}/checkout`,
  )
    .then((context) => ({ context, unavailable: null }))
    .catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 401) {
        redirect(`/login?callbackUrl=/account/custom-requests/${id}/quotes/${quoteId}`);
      }
      if (error instanceof ApiError && error.status === 404) notFound();
      // Accepted, declined, withdrawn or expired: say which, and go back.
      if (error instanceof ApiError && error.status === 409) {
        return { context: null, unavailable: error.message };
      }
      throw error;
    });

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={back}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Back to the conversation
        </Link>
        <h2 className="mt-2 font-serif text-xl font-semibold">Accept your quote</h2>
      </div>

      {result.context ? (
        <QuoteCheckoutForm context={result.context} />
      ) : (
        <div className="space-y-4 rounded-lg border p-6">
          <p>{result.unavailable}</p>
          <Button asChild variant="outline">
            <Link href={back}>Back to the conversation</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
