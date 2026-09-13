import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { MessagesSquare, Plus } from 'lucide-react';
import type { CustomRequestSummary } from '@momishop/shared/api-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ApiError, apiGet } from '@/lib/api';
import { REQUEST_STATUS_LABELS } from '@/lib/custom-requests';
import { relativeTime } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Custom requests',
  robots: { index: false, follow: false },
};

export default async function CustomRequestsPage() {
  const { items } = await apiGet<{ items: CustomRequestSummary[] }>('/custom-requests').catch(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) {
        redirect('/login?callbackUrl=/account/custom-requests');
      }
      throw error;
    },
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-serif text-xl font-semibold">Custom requests</h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Want something we do not list? Describe it, and talk it through with us here.
          </p>
        </div>
        <Button asChild>
          <Link href="/account/custom-requests/new">
            <Plus aria-hidden="true" />
            Start a request
          </Link>
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          title="No requests yet"
          description="Tell us about a dress, abaya or outfit you would like made, with photos if you have them."
          action={
            <Button asChild>
              <Link href="/account/custom-requests/new">Start a request</Link>
            </Button>
          }
        />
      ) : (
        <ul className="divide-y rounded-lg border">
          {items.map((request) => (
            <li key={request.id}>
              <Link
                href={`/account/custom-requests/${request.id}`}
                className="flex flex-wrap items-center gap-3 p-4 hover:bg-accent/40"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-medium">
                    {request.unread && (
                      <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
                    )}
                    {request.title}
                    {request.unread && <span className="sr-only"> — new reply</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono">{request.number}</span> · last message{' '}
                    {relativeTime(request.lastMessageAt)}
                  </p>
                </div>
                <Badge variant="secondary">{REQUEST_STATUS_LABELS[request.status]}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
