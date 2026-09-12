import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import type { AdminCustomerDetail, AdminCustomerOrder } from '@momishop/shared/api-types';
import { formatMoney, type Currency } from '@momishop/shared/money';
import { STATUS_PRESENTATION } from '@momishop/shared/order-status';
import { formatDate, formatDateTime } from '@momishop/shared/text';
import { CustomerStatusForm, LoyaltyForm } from '@/components/admin/customer-actions';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiGet, ApiError } from '@/lib/api';

export const metadata: Metadata = { title: 'Customer' };

export default async function AdminCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const data = await apiGet<{ customer: AdminCustomerDetail; orders: AdminCustomerOrder[] }>(
    `/admin/customers/${id}`,
  ).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  });

  if (!data) notFound();
  const { customer, orders } = data;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/customers"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Customers
        </Link>
        <h1 className="mt-2 flex flex-wrap items-center gap-2 font-serif text-2xl font-semibold">
          {customer.name ?? customer.email}
          {customer.status !== 'ACTIVE' && (
            <Badge variant="destructive">{customer.status.toLowerCase()}</Badge>
          )}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {customer.email}
          {customer.phone && ` · ${customer.phone}`} · joined {formatDate(customer.createdAt)}
        </p>
      </div>

      <dl className="grid gap-4 sm:grid-cols-3">
        <Stat label="Spent" value={formatMoney(customer.lifetimeSpend, 'PKR' as Currency)} />
        <Stat label="Orders paid for" value={String(customer.paidOrderCount)} />
        <Stat label="Points" value={String(customer.loyaltyAccount?.balance ?? 0)} />
      </dl>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle as="h2">Orders</CardTitle>
            </CardHeader>
            <CardContent>
              {orders.length === 0 ? (
                <p className="text-sm text-muted-foreground">No orders yet.</p>
              ) : (
                <div className="scroll-x">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Orders, newest first</caption>
                    <thead>
                      <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                        <th scope="col" className="py-2 text-start font-medium">
                          Order
                        </th>
                        <th scope="col" className="py-2 text-start font-medium">
                          Status
                        </th>
                        <th scope="col" className="py-2 text-end font-medium">
                          Total
                        </th>
                        <th scope="col" className="py-2 text-end font-medium">
                          Placed
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {orders.map((order) => (
                        <tr key={order.id}>
                          <td className="py-2">
                            <Link
                              href={`/admin/orders/${order.id}`}
                              className="font-medium underline-offset-4 hover:underline"
                            >
                              {order.orderNumber}
                            </Link>
                          </td>
                          <td className="py-2">
                            <Badge variant="secondary">
                              {STATUS_PRESENTATION[order.status].label}
                            </Badge>
                          </td>
                          <td className="py-2 text-end tabular-nums">
                            {formatMoney(order.grandTotal, order.currency as Currency)}
                          </td>
                          <td className="py-2 text-end text-xs text-muted-foreground">
                            {formatDate(order.placedAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">Addresses</CardTitle>
            </CardHeader>
            <CardContent>
              {customer.addresses.length === 0 ? (
                <p className="text-sm text-muted-foreground">None saved.</p>
              ) : (
                <ul className="grid gap-4 sm:grid-cols-2">
                  {customer.addresses.map((address) => (
                    <li key={address.id} className="rounded-lg border p-3 text-sm">
                      <p className="font-medium">
                        {address.fullName}
                        {address.isDefault && (
                          <Badge variant="secondary" className="ms-2">
                            default
                          </Badge>
                        )}
                      </p>
                      <p className="text-muted-foreground">
                        {address.line1}
                        {address.line2 && `, ${address.line2}`}
                        <br />
                        {address.city}, {address.state}
                        {address.postalCode && ` ${address.postalCode}`}
                        <br />
                        {address.phone}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">Measurements</CardTitle>
            </CardHeader>
            <CardContent>
              {customer.measurementProfiles.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No saved profiles — measurements were given per order.
                </p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {customer.measurementProfiles.map((profile) => (
                    <li key={profile.id} className="flex flex-wrap justify-between gap-2">
                      <span className="font-medium">{profile.label}</span>
                      <span className="text-muted-foreground">
                        {profile.template.replace(/_/g, ' ').toLowerCase()} · {profile.unit} ·
                        updated {formatDate(profile.updatedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {/*
                The figures themselves are not shown here. Staff need to know a
                profile exists; the numbers belong to the order being made, and
                they are on the order screen where the work happens.
              */}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle as="h2">Account</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="Email confirmed" value={customer.emailVerified ? 'Yes' : 'Not yet'} />
              <Row
                label="Last signed in"
                value={customer.lastLoginAt ? formatDateTime(customer.lastLoginAt) : 'Never'}
              />
              <Row label="Marketing" value={customer.marketingOptIn ? 'Subscribed' : 'No'} />
              <Row label="Reviews written" value={String(customer.reviewCount)} />
              <Row label="Returns raised" value={String(customer.returnCount)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">Points</CardTitle>
            </CardHeader>
            <CardContent>
              <LoyaltyForm
                customerId={customer.id}
                balance={customer.loyaltyAccount?.balance ?? 0}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">Access</CardTitle>
            </CardHeader>
            <CardContent>
              <CustomerStatusForm customerId={customer.id} status={customer.status} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-serif text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-end font-medium">{value}</span>
    </div>
  );
}
