import type { Metadata } from 'next';
import Link from 'next/link';
import { RotateCcw } from 'lucide-react';
import type { AdminReturnList, ReturnStatus } from '@momishop/shared/api-types';
import { formatMoney, type Currency } from '@momishop/shared/money';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ReturnDecision } from '@/components/admin/moderation-actions';
import { apiGet } from '@/lib/api';
import { formatDate } from '@/lib/utils';

export const metadata: Metadata = { title: 'Returns' };

const TABS: { label: string; status?: ReturnStatus }[] = [
  { label: 'All' },
  { label: 'Requested', status: 'REQUESTED' },
  { label: 'Approved', status: 'APPROVED' },
  { label: 'Received', status: 'RECEIVED' },
  { label: 'Refunded', status: 'REFUNDED' },
  { label: 'Closed', status: 'CLOSED' },
];

/**
 * Returns and exchanges.
 *
 * A made-to-measure piece cannot go back on the shelf, so the usual answer is
 * an alteration or a remake rather than a refund — which is why the status
 * list is a set of outcomes rather than a single approve/reject.
 */
export default async function AdminReturnsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const status = typeof params.status === 'string' ? (params.status as ReturnStatus) : undefined;

  const { items, countsByStatus } = await apiGet<AdminReturnList>(
    `/admin/returns${status ? `?status=${status}` : ''}`,
  );

  const totalCount = Object.values(countsByStatus).reduce((sum, n) => sum + (n ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Returns</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Alter or remake where the fit is wrong; refund where we got it wrong.
        </p>
      </div>

      <nav aria-label="Filter by status">
        <ul className="flex flex-wrap gap-2">
          {TABS.map((tab) => {
            const active = tab.status === status || (!tab.status && !status);
            const count = tab.status ? (countsByStatus[tab.status] ?? 0) : totalCount;

            return (
              <li key={tab.label}>
                <Button variant={active ? 'default' : 'outline'} size="sm" asChild>
                  <Link
                    href={tab.status ? `/admin/returns?status=${tab.status}` : '/admin/returns'}
                    aria-current={active ? 'page' : undefined}
                  >
                    {tab.label}
                    <span className="ms-1.5 tabular-nums opacity-70">{count}</span>
                  </Link>
                </Button>
              </li>
            );
          })}
        </ul>
      </nav>

      {items.length === 0 ? (
        <EmptyState
          icon={RotateCcw}
          title="No return requests"
          description="When a customer asks to return or exchange a piece, it will appear here."
        />
      ) : (
        <ul className="space-y-4">
          {items.map((request) => (
            <li key={request.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {request.requestNumber}
                    <Badge variant={request.kind === 'EXCHANGE' ? 'secondary' : 'default'}>
                      {request.kind === 'EXCHANGE' ? 'Exchange' : 'Return'}
                    </Badge>
                    <Badge variant="secondary">{request.status.replace('_', ' ')}</Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <Link
                      href={`/admin/orders/${request.order.id}`}
                      className="underline underline-offset-4"
                    >
                      {request.order.orderNumber}
                    </Link>{' '}
                    · {request.order.email} · asked {formatDate(request.createdAt)}
                  </p>
                </div>

                <p className="text-sm tabular-nums">
                  {request.refundAmount === null
                    ? formatMoney(request.order.grandTotal, request.order.currency as Currency)
                    : `refund ${formatMoney(request.refundAmount, request.order.currency as Currency)}`}
                </p>
              </div>

              <p className="mt-3 text-sm">
                <span className="font-medium">Reason:</span> {request.reason}
              </p>
              {request.detail && (
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                  {request.detail}
                </p>
              )}

              <div className="mt-4">
                <ReturnDecision
                  returnId={request.id}
                  status={request.status}
                  staffNote={request.staffNote}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
