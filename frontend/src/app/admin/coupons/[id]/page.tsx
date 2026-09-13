import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import type { AdminCategory, AdminCoupon, AdminShell } from '@momishop/shared/api-types';
import { hasPermission, type Principal } from '@momishop/shared/rbac';
import { CouponActions } from '@/components/admin/coupon-actions';
import { CouponForm } from '@/components/admin/coupon-form';
import { Badge } from '@/components/ui/badge';
import { ApiError, apiGet } from '@/lib/api';
import { couponState, COUPON_STATE_LABEL } from '../coupon-state';

export const metadata: Metadata = { title: 'Coupon' };

export default async function CouponPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [shell, categoryList, detail] = await Promise.all([
    apiGet<AdminShell>('/admin/shell'),
    apiGet<{ categories: AdminCategory[] }>('/admin/categories'),
    apiGet<{ coupon: AdminCoupon }>(`/admin/coupons/${id}`).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }),
  ]);

  if (!detail) notFound();
  const { coupon } = detail;

  const principal: Principal = {
    role: shell.user.role as Principal['role'],
    permissions: shell.user.permissions,
  };
  const canEdit = hasPermission(principal, 'coupon.write');
  const state = couponState(coupon, new Date());

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/admin/coupons"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            Coupons
          </Link>
          <h1 className="mt-2 flex flex-wrap items-center gap-2 font-serif text-2xl font-semibold">
            <span className="font-mono">{coupon.code}</span>
            <Badge variant={state === 'active' ? 'default' : 'secondary'}>
              {COUPON_STATE_LABEL[state]}
            </Badge>
          </h1>
          {!canEdit && (
            <p className="mt-1 text-sm text-muted-foreground">
              You can view coupons but not change them.
            </p>
          )}
        </div>

        {canEdit && (
          <CouponActions
            id={coupon.id}
            code={coupon.code}
            isActive={coupon.isActive}
            canDelete={coupon.usedCount === 0 && coupon.orderCount === 0}
          />
        )}
      </div>

      <CouponForm
        key={`${coupon.id}-${coupon.isActive}`}
        coupon={coupon}
        categories={categoryList.categories}
        canEdit={canEdit}
      />
    </div>
  );
}
