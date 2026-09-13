import type { Metadata } from 'next';
import Link from 'next/link';
import { MessagesSquare } from 'lucide-react';
import type { AdminCustomRequestList, CustomRequestStatus } from '@momishop/shared/api-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { apiGet } from '@/lib/api';
import { REQUEST_STATUS_LABELS } from '@/lib/custom-requests';
import { relativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Custom requests' };

const TABS: { label: string; status?: CustomRequestStatus }[] = [
  { label: 'All' },
  { label: 'Open', status: 'OPEN' },
  { label: 'Quote sent', status: 'QUOTED' },
  { label: 'Accepted', status: 'ACCEPTED' },
  { label: 'Ordered', status: 'ORDERED' },
  { label: 'Declined', status: 'DECLINED' },
  { label: 'Closed', status: 'CLOSED' },
];

export default async function AdminCustomRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const status = typeof params.status === 'string' ? params.status : undefined;
  const q = typeof params.q === 'string' ? params.q : undefined;

  const query = new URLSearchParams();
  if (status) query.set('status', status);
  if (q) query.set('q', q);

  const { items, countsByStatus } = await apiGet<AdminCustomRequestList>(
    `/admin/custom-requests?${query.toString()}`,
  );
  const total = Object.values(countsByStatus).reduce((sum, count) => sum + (count ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Custom requests</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Customers asking for something made. Unread conversations come first.
          </p>
        </div>

        <form className="flex gap-2" action="/admin/custom-requests">
          {status && <input type="hidden" name="status" value={status} />}
          <Input
            name="q"
            defaultValue={q ?? ''}
            placeholder="Number, title or email"
            aria-label="Search custom requests"
            className="w-56"
          />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
      </div>

      <nav aria-label="Filter by status">
        <ul className="flex flex-wrap gap-2">
          {TABS.map((tab) => {
            const active = tab.status === status || (!tab.status && !status);
            const count = tab.status ? (countsByStatus[tab.status] ?? 0) : total;
            return (
              <li key={tab.label}>
                <Button variant={active ? 'default' : 'outline'} size="sm" asChild>
                  <Link
                    href={
                      tab.status
                        ? `/admin/custom-requests?status=${tab.status}`
                        : '/admin/custom-requests'
                    }
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
          icon={MessagesSquare}
          title="No requests here"
          description={
            q || status
              ? 'No request matches that filter.'
              : 'When a customer asks for something made, it appears here.'
          }
        />
      ) : (
        <ul className="divide-y rounded-lg border bg-background">
          {items.map((request) => (
            <li key={request.id}>
              <Link
                href={`/admin/custom-requests/${request.id}`}
                className="flex flex-wrap items-start gap-3 p-4 hover:bg-accent/30"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {request.unread && <Badge>new</Badge>}
                    {request.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono">{request.number}</span> ·{' '}
                    {request.customer.name ?? request.customer.email}
                  </p>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{request.preview}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge variant="secondary">{REQUEST_STATUS_LABELS[request.status]}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {relativeTime(request.lastMessageAt)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
