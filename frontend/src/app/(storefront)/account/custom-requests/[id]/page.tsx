import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import type { CustomRequestDetail, CustomRequestOptions } from '@momishop/shared/api-types';
import { formatMoney } from '@momishop/shared/money';
import { ChatThread } from '@/components/chat/chat-thread';
import { Badge } from '@/components/ui/badge';
import { ApiError, apiGet } from '@/lib/api';
import { pieceKindLabel, REQUEST_STATUS_LABELS } from '@/lib/custom-requests';
import { formatDate } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Custom request',
  robots: { index: false, follow: false },
};

export default async function CustomRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const handle = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      redirect(`/login?callbackUrl=/account/custom-requests/${id}`);
    }
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  };

  const [detail, options] = await Promise.all([
    apiGet<{ request: CustomRequestDetail }>(`/custom-requests/${id}`).catch(handle),
    apiGet<CustomRequestOptions>('/custom-requests/options').catch(handle),
  ]);
  if (!detail) notFound();

  const { request } = detail;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/account/custom-requests"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Custom requests
        </Link>
        <h2 className="mt-2 flex flex-wrap items-center gap-2 font-serif text-xl font-semibold">
          {request.title}
          <Badge variant="secondary">{REQUEST_STATUS_LABELS[request.status]}</Badge>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          <span className="font-mono">{request.number}</span> · {pieceKindLabel(request.template)}
          {request.budget !== null && ` · budget ${formatMoney(request.budget, 'PKR')}`}
          {request.neededBy && ` · needed by ${formatDate(request.neededBy)}`}
        </p>
      </div>

      <ChatThread
        endpoint={`/api/custom-requests/${request.id}`}
        viewer="CUSTOMER"
        initialMessages={request.messages}
        status={request.status}
        uploadsEnabled={options?.uploadsEnabled ?? false}
      />
    </div>
  );
}
