import type { Metadata } from 'next';
import Link from 'next/link';
import { Users } from 'lucide-react';
import type { AdminCustomerList } from '@momishop/shared/api-types';
import { formatMoney, type Currency } from '@momishop/shared/money';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { apiGet } from '@/lib/api';
import { relativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Customers' };

const TABS: { label: string; status?: string }[] = [
  { label: 'All' },
  { label: 'Active', status: 'ACTIVE' },
  { label: 'Suspended', status: 'SUSPENDED' },
];

export default async function AdminCustomersPage({
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

  const { items, total } = await apiGet<AdminCustomerList>(`/admin/customers?${query.toString()}`);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Customers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total} {total === 1 ? 'person' : 'people'}
          </p>
        </div>

        <form className="flex gap-2" action="/admin/customers">
          <Input
            name="q"
            defaultValue={q ?? ''}
            placeholder="Name, email or phone"
            aria-label="Search customers"
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
            return (
              <li key={tab.label}>
                <Button variant={active ? 'default' : 'outline'} size="sm" asChild>
                  <Link
                    href={tab.status ? `/admin/customers?status=${tab.status}` : '/admin/customers'}
                    aria-current={active ? 'page' : undefined}
                  >
                    {tab.label}
                  </Link>
                </Button>
              </li>
            );
          })}
        </ul>
      </nav>

      {items.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nobody here"
          description={
            q ? 'No customer matches that search.' : 'Customers appear once someone orders.'
          }
        />
      ) : (
        <div className="scroll-x rounded-lg border">
          <table className="w-full text-sm">
            <caption className="sr-only">Customers, newest first</caption>
            <thead>
              <tr className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="p-3 text-start font-medium">
                  Customer
                </th>
                <th scope="col" className="p-3 text-start font-medium">
                  Status
                </th>
                <th scope="col" className="p-3 text-end font-medium">
                  Orders
                </th>
                <th scope="col" className="p-3 text-end font-medium">
                  Spent
                </th>
                <th scope="col" className="p-3 text-end font-medium">
                  Last order
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((customer) => (
                <tr key={customer.id} className="hover:bg-accent/30">
                  <td className="p-3">
                    <Link
                      href={`/admin/customers/${customer.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {customer.name ?? customer.email}
                    </Link>
                    <span className="block truncate text-xs text-muted-foreground">
                      {customer.email}
                      {customer.phone && ` · ${customer.phone}`}
                    </span>
                  </td>
                  <td className="p-3">
                    <Badge variant={customer.status === 'ACTIVE' ? 'secondary' : 'destructive'}>
                      {customer.status.toLowerCase()}
                    </Badge>
                    {customer.marketingOptIn && (
                      <Badge variant="secondary" className="ms-1">
                        subscribed
                      </Badge>
                    )}
                  </td>
                  <td className="p-3 text-end tabular-nums">{customer.orderCount}</td>
                  <td className="p-3 text-end tabular-nums">
                    {formatMoney(customer.lifetimeSpend, 'PKR' as Currency)}
                  </td>
                  <td className="p-3 text-end text-xs text-muted-foreground">
                    {customer.lastOrderAt ? relativeTime(customer.lastOrderAt) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
