import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import type { AdminCustomRequestDetail, AdminShell } from '@momishop/shared/api-types';
import { formatMoney } from '@momishop/shared/money';
import { hasPermission, type Principal } from '@momishop/shared/rbac';
import { RequestStatusControl } from '@/components/admin/request-status-control';
import { ChatThread } from '@/components/chat/chat-thread';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError, apiGet } from '@/lib/api';
import { pieceKindLabel, REQUEST_STATUS_LABELS } from '@/lib/custom-requests';
import { formatDate } from '@/lib/utils';

export const metadata: Metadata = { title: 'Custom request' };

/** Measurement keys like "shoulderWidth" as "Shoulder width". */
const humanise = (key: string) =>
  key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());

export default async function AdminCustomRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [shell, detail, uploads] = await Promise.all([
    apiGet<AdminShell>('/admin/shell'),
    apiGet<{ request: AdminCustomRequestDetail }>(`/admin/custom-requests/${id}`).catch(
      (error: unknown) => {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      },
    ),
    apiGet<{ uploadsEnabled: boolean }>('/custom-requests/options').catch(() => ({
      uploadsEnabled: false,
    })),
  ]);
  if (!detail) notFound();

  const { request } = detail;
  const principal: Principal = {
    role: shell.user.role as Principal['role'],
    permissions: shell.user.permissions,
  };
  const canWrite = hasPermission(principal, 'request.write');
  const measurements = request.measurementSnapshot
    ? Object.entries(request.measurementSnapshot)
    : [];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/custom-requests"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Custom requests
        </Link>
        <h1 className="mt-2 flex flex-wrap items-center gap-2 font-serif text-2xl font-semibold">
          {request.title}
          <Badge variant="secondary">{REQUEST_STATUS_LABELS[request.status]}</Badge>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <span className="font-mono">{request.number}</span> · started{' '}
          {formatDate(request.createdAt)}
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_320px]">
        <ChatThread
          endpoint={`/api/admin/custom-requests/${request.id}`}
          viewer="STAFF"
          initialMessages={request.messages}
          status={request.status}
          uploadsEnabled={canWrite && uploads.uploadsEnabled}
          customerName={request.customer.name ?? request.customer.email}
        />

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle as="h2">Customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <Link
                href={`/admin/customers/${request.customer.id}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {request.customer.name ?? request.customer.email}
              </Link>
              <p className="text-muted-foreground">{request.customer.email}</p>
              {request.customer.phone && (
                <p>
                  <a
                    href={`tel:${request.customer.phone}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {request.customer.phone}
                  </a>
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">The piece</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                <span className="text-muted-foreground">Kind: </span>
                {pieceKindLabel(request.template)}
              </p>
              <p>
                <span className="text-muted-foreground">Budget: </span>
                {request.budget !== null ? formatMoney(request.budget, 'PKR') : 'Not given'}
              </p>
              <p>
                <span className="text-muted-foreground">Needed by: </span>
                {request.neededBy ? formatDate(request.neededBy) : 'Not given'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">Measurements</CardTitle>
            </CardHeader>
            <CardContent>
              {measurements.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  None attached. Ask for them in the conversation.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Measurements in {request.measurementUnit === 'CM' ? 'centimetres' : 'inches'}
                  </caption>
                  <tbody className="divide-y">
                    {measurements.map(([key, value]) => (
                      <tr key={key}>
                        <th
                          scope="row"
                          className="py-1.5 text-start font-normal text-muted-foreground"
                        >
                          {humanise(key)}
                        </th>
                        <td className="py-1.5 text-end tabular-nums">
                          {value} {request.measurementUnit === 'CM' ? 'cm' : 'in'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          {canWrite && (
            <Card>
              <CardHeader>
                <CardTitle as="h2">Status</CardTitle>
              </CardHeader>
              <CardContent>
                <RequestStatusControl requestId={request.id} status={request.status} />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
