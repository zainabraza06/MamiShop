import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus, Tag } from 'lucide-react';
import type { AdminCouponList, AdminShell } from '@momishop/shared/api-types';
import { describeCoupon } from '@momishop/shared/coupons';
import { formatMoney } from '@momishop/shared/money';
import { hasPermission, type Principal } from '@momishop/shared/rbac';
import { formatDate } from '@momishop/shared/text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { apiGet } from '@/lib/api';
import { COUPON_STATE_LABEL, couponState, type CouponState } from './coupon-state';

export const metadata: Metadata = { title: 'Coupons' };

const TABS: { label: string; state?: CouponState }[] = [
  { label: 'All' },
  { label: 'Live', state: 'active' },
  { label: 'Scheduled', state: 'scheduled' },
  { label: 'Ended', state: 'expired' },
  { label: 'Switched off', state: 'inactive' },
];

const formatRupees = (minor: number) => formatMoney(minor, 'PKR');

export default async function AdminCouponsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const state = typeof params.state === 'string' ? params.state : undefined;
  const q = typeof params.q === 'string' ? params.q : undefined;

  const query = new URLSearchParams();
  if (state) query.set('state', state);
  if (q) query.set('q', q);

  const [{ user }, { items, total }] = await Promise.all([
    apiGet<AdminShell>('/admin/shell'),
    apiGet<AdminCouponList>(`/admin/coupons?${query.toString()}`),
  ]);

  const principal: Principal = {
    role: user.role as Principal['role'],
    permissions: user.permissions,
  };
  const canEdit = hasPermission(principal, 'coupon.write');
  const now = new Date();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Coupons</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total} code{total === 1 ? '' : 's'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <form className="flex gap-2" action="/admin/coupons">
            {state && <input type="hidden" name="state" value={state} />}
            <Input
              name="q"
              defaultValue={q ?? ''}
              placeholder="Code"
              aria-label="Search coupons by code"
              className="w-40 uppercase"
            />
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>

          {canEdit && (
            <Button asChild>
              <Link href="/admin/coupons/new">
                <Plus aria-hidden="true" />
                New coupon
              </Link>
            </Button>
          )}
        </div>
      </div>

      <nav aria-label="Filter by status">
        <ul className="flex flex-wrap gap-2">
          {TABS.map((tab) => {
            const active = tab.state === state || (!tab.state && !state);
            return (
              <li key={tab.label}>
                <Button variant={active ? 'default' : 'outline'} size="sm" asChild>
                  <Link
                    href={tab.state ? `/admin/coupons?state=${tab.state}` : '/admin/coupons'}
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
          icon={Tag}
          title="No coupons here"
          description={
            q || state ? 'No code matches that filter.' : 'Create a code to run a promotion.'
          }
          action={
            canEdit ? (
              <Button asChild>
                <Link href="/admin/coupons/new">New coupon</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="scroll-x rounded-lg border">
          <table className="w-full text-sm">
            <caption className="sr-only">Coupons, newest first</caption>
            <thead>
              <tr className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="p-3 text-start font-medium">
                  Code
                </th>
                <th scope="col" className="p-3 text-start font-medium">
                  Status
                </th>
                <th scope="col" className="p-3 text-end font-medium">
                  Used
                </th>
                <th scope="col" className="p-3 text-end font-medium">
                  Runs
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((coupon) => {
                const current = couponState(coupon, now);

                return (
                  <tr key={coupon.id} className="hover:bg-accent/30">
                    <td className="p-3">
                      <Link
                        href={`/admin/coupons/${coupon.id}`}
                        className="font-mono font-medium underline-offset-4 hover:underline"
                      >
                        {coupon.code}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {describeCoupon(coupon, formatRupees)}
                        {coupon.firstOrderOnly && ' · first order only'}
                      </span>
                    </td>
                    <td className="p-3">
                      <Badge variant={current === 'active' ? 'default' : 'secondary'}>
                        {COUPON_STATE_LABEL[current]}
                      </Badge>
                    </td>
                    <td className="p-3 text-end tabular-nums">
                      {coupon.usedCount}
                      {coupon.usageLimit !== null && (
                        <span className="text-muted-foreground"> / {coupon.usageLimit}</span>
                      )}
                    </td>
                    <td className="p-3 text-end text-xs text-muted-foreground">
                      {coupon.startsAt ? formatDate(coupon.startsAt) : 'Now'} –{' '}
                      {coupon.endsAt ? formatDate(coupon.endsAt) : 'no end'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
