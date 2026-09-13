import type { Metadata } from 'next';
import Link from 'next/link';
import { Download } from 'lucide-react';
import type { AdminReport } from '@momishop/shared/api-types';
import { formatMoney } from '@momishop/shared/money';
import { RevenueChart } from '@/components/admin/revenue-chart';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ApiError, apiGet } from '@/lib/api';
import { shopDay } from '@/lib/shop-time';

export const metadata: Metadata = { title: 'Reports' };

const rs = (minor: number) => formatMoney(minor, 'PKR');

const PAYMENT_LABELS: Record<string, string> = {
  STRIPE: 'Card',
  JAZZCASH: 'JazzCash',
  EASYPAISA: 'Easypaisa',
  COD: 'Cash on delivery',
  BANK_TRANSFER: 'Bank transfer',
  MANUAL: 'Recorded by staff',
};

/** A YYYY-MM-DD day moved by whole days; calendar arithmetic, so done in UTC. */
function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const dayFormat = new Intl.DateTimeFormat('en-PK', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const longDay = (day: string) => dayFormat.format(new Date(`${day}T00:00:00Z`));

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold">{value}</dd>
      {note && <dd className="mt-1 text-xs text-muted-foreground">{note}</dd>}
    </div>
  );
}

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const from = typeof params.from === 'string' ? params.from : undefined;
  const to = typeof params.to === 'string' ? params.to : undefined;

  const query = new URLSearchParams();
  if (from) query.set('from', from);
  if (to) query.set('to', to);

  // A bad range from a hand-edited URL shows the message over the default
  // report, rather than an error page.
  const requested = await apiGet<AdminReport>(`/admin/reports?${query.toString()}`)
    .then((data) => ({ data, rangeError: null }))
    .catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 422) {
        return { data: null, rangeError: error.message };
      }
      throw error;
    });
  const { rangeError } = requested;
  const report = requested.data ?? (await apiGet<AdminReport>('/admin/reports'));

  const today = shopDay(new Date().toISOString());
  const presets = [
    { label: 'Last 7 days', from: addDays(today, -6), to: today },
    { label: 'Last 30 days', from: addDays(today, -29), to: today },
    { label: 'Last 90 days', from: addDays(today, -89), to: today },
    { label: 'This month', from: `${today.slice(0, 8)}01`, to: today },
  ];

  const { summary, byDay, topProducts, byPayment, range } = report;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {longDay(range.from)} to {longDay(range.to)}, Pakistan time
          </p>
        </div>

        {report.canExport && (
          <Button variant="outline" asChild>
            <a href={`/api/admin/reports/orders.csv?from=${range.from}&to=${range.to}`} download>
              <Download aria-hidden="true" />
              Download orders (CSV)
            </a>
          </Button>
        )}
      </div>

      {/* One row of filters above everything they scope. */}
      <div className="flex flex-wrap items-end gap-2">
        <nav aria-label="Date range">
          <ul className="flex flex-wrap gap-2">
            {presets.map((preset) => {
              const active = preset.from === range.from && preset.to === range.to;
              return (
                <li key={preset.label}>
                  <Button variant={active ? 'default' : 'outline'} size="sm" asChild>
                    <Link
                      href={`/admin/reports?from=${preset.from}&to=${preset.to}`}
                      aria-current={active ? 'page' : undefined}
                    >
                      {preset.label}
                    </Link>
                  </Button>
                </li>
              );
            })}
          </ul>
        </nav>

        <form action="/admin/reports" className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted-foreground">
            From
            <Input type="date" name="from" defaultValue={range.from} className="mt-1 h-9 w-40" />
          </label>
          <label className="text-xs text-muted-foreground">
            To
            <Input type="date" name="to" defaultValue={range.to} className="mt-1 h-9 w-40" />
          </label>
          <Button type="submit" size="sm" variant="outline">
            Apply
          </Button>
        </form>
      </div>

      {rangeError && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 p-3 text-sm text-destructive"
        >
          {rangeError} Showing the last 30 days instead.
        </p>
      )}

      <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Revenue"
          value={rs(summary.revenue)}
          note="Excludes cancelled and refunded orders."
        />
        <Stat
          label="Orders"
          value={summary.orders.toLocaleString('en-PK')}
          note={`${summary.cancelled} cancelled`}
        />
        <Stat label="Average order" value={rs(summary.averageOrder)} />
        <Stat
          label="Refunded"
          value={rs(summary.refunded)}
          note={`Discounts given: ${rs(summary.discounts)}`}
        />
      </dl>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Revenue by day</CardTitle>
        </CardHeader>
        <CardContent>
          {summary.orders === 0 ? (
            <p className="text-sm text-muted-foreground">No orders in this range.</p>
          ) : (
            <RevenueChart points={byDay} />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle as="h2">Best-selling pieces</CardTitle>
          </CardHeader>
          <CardContent>
            {topProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing sold in this range.</p>
            ) : (
              <table className="w-full text-sm">
                <caption className="sr-only">Best-selling pieces by revenue</caption>
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th scope="col" className="py-2 text-start font-medium">
                      Piece
                    </th>
                    <th scope="col" className="py-2 text-end font-medium">
                      Sold
                    </th>
                    <th scope="col" className="py-2 text-end font-medium">
                      Revenue
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {topProducts.map((product) => (
                    <tr key={product.name}>
                      <td className="py-2">{product.name}</td>
                      <td className="py-2 text-end tabular-nums">{product.quantity}</td>
                      <td className="py-2 text-end tabular-nums">{rs(product.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">How customers paid</CardTitle>
          </CardHeader>
          <CardContent>
            {byPayment.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payments in this range.</p>
            ) : (
              <table className="w-full text-sm">
                <caption className="sr-only">Revenue by payment method</caption>
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th scope="col" className="py-2 text-start font-medium">
                      Method
                    </th>
                    <th scope="col" className="py-2 text-end font-medium">
                      Orders
                    </th>
                    <th scope="col" className="py-2 text-end font-medium">
                      Revenue
                    </th>
                    <th scope="col" className="py-2 text-end font-medium">
                      Share
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {byPayment.map((row) => (
                    <tr key={row.method}>
                      <td className="py-2">{PAYMENT_LABELS[row.method] ?? row.method}</td>
                      <td className="py-2 text-end tabular-nums">{row.orders}</td>
                      <td className="py-2 text-end tabular-nums">{rs(row.revenue)}</td>
                      <td className="py-2 text-end tabular-nums">
                        {summary.revenue > 0
                          ? Math.round((row.revenue / summary.revenue) * 100)
                          : 0}
                        %
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
