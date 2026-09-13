'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { ChatQuote } from '@momishop/shared/api-types';
import { formatMoney } from '@momishop/shared/money';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/**
 * A price quote inside the conversation.
 *
 * The customer accepts it on a page of its own, because accepting means giving
 * an address and choosing delivery and payment, and a chat bubble is no place
 * for a form. Declining, and the shop withdrawing, happen right here.
 */

const dayFormat = new Intl.DateTimeFormat('en-PK', {
  timeZone: 'Asia/Karachi',
  day: 'numeric',
  month: 'short',
});

export function QuoteCard({
  quote,
  viewer,
  requestId,
  onChanged,
}: {
  quote: ChatQuote;
  viewer: 'CUSTOMER' | 'STAFF';
  requestId: string;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  // Worked out in the browser only after it mounts, so the server and client
  // render the same markup; the API refuses an expired quote regardless.
  const [expired, setExpired] = React.useState(false);
  React.useEffect(() => {
    const check = () => setExpired(new Date(quote.expiresAt).getTime() <= Date.now());
    const timer = window.setTimeout(check, 0);
    return () => window.clearTimeout(timer);
  }, [quote.expiresAt]);

  const onOffer = quote.status === 'PENDING' && !expired;

  async function post(url: string, body: unknown, success: string) {
    setBusy(true);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? 'That did not go through.');
      }
      toast.success(success);
      onChanged();
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That did not go through.');
    } finally {
      setBusy(false);
    }
  }

  const statusBadge =
    quote.status === 'ACCEPTED' ? (
      <Badge>accepted{quote.orderNumber ? ` · ${quote.orderNumber}` : ''}</Badge>
    ) : quote.status === 'DECLINED' ? (
      <Badge variant="secondary">declined</Badge>
    ) : quote.status === 'WITHDRAWN' ? (
      <Badge variant="secondary">withdrawn</Badge>
    ) : expired ? (
      <Badge variant="secondary">expired</Badge>
    ) : null;

  return (
    <section
      aria-label="Price quote"
      className="space-y-2 rounded-md border bg-background p-3 text-foreground"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Quote</p>
        {statusBadge}
      </div>
      <p className="text-2xl font-semibold">{formatMoney(quote.amount, 'PKR')}</p>
      <p className="text-sm text-muted-foreground">
        Ready in about {quote.stitchingDays} day{quote.stitchingDays === 1 ? '' : 's'}, then
        delivery. Delivery and any tax are added at checkout.
        {quote.status === 'PENDING' && !expired && (
          <> Valid until {dayFormat.format(new Date(quote.expiresAt))}.</>
        )}
      </p>

      {onOffer && viewer === 'CUSTOMER' && (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" asChild>
            <Link href={`/account/custom-requests/${requestId}/quotes/${quote.id}`}>
              Accept and order
            </Link>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            isLoading={busy}
            loadingText="Declining"
            onClick={() => {
              if (!window.confirm('Decline this quote? You can keep talking to us about it.'))
                return;
              void post(
                `/api/custom-requests/${requestId}/quotes/${quote.id}/decline`,
                {},
                'Quote declined.',
              );
            }}
          >
            Decline
          </Button>
        </div>
      )}

      {onOffer && viewer === 'STAFF' && (
        <Button
          size="sm"
          variant="outline"
          isLoading={busy}
          loadingText="Withdrawing"
          onClick={() => {
            if (!window.confirm('Withdraw this quote? The customer can no longer accept it.'))
              return;
            void post(
              `/api/admin/custom-requests/${requestId}/quotes/${quote.id}/withdraw`,
              {},
              'Quote withdrawn.',
            );
          }}
        >
          Withdraw quote
        </Button>
      )}
    </section>
  );
}
