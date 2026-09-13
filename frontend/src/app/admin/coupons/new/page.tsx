import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import type { AdminCategory, AdminShell } from '@momishop/shared/api-types';
import { hasPermission, type Principal } from '@momishop/shared/rbac';
import { CouponForm } from '@/components/admin/coupon-form';
import { apiGet } from '@/lib/api';

export const metadata: Metadata = { title: 'New coupon' };

export default async function NewCouponPage() {
  const [{ user }, { categories }] = await Promise.all([
    apiGet<AdminShell>('/admin/shell'),
    apiGet<{ categories: AdminCategory[] }>('/admin/categories'),
  ]);

  const principal: Principal = {
    role: user.role as Principal['role'],
    permissions: user.permissions,
  };
  // Staff can look at coupons but not make them; send them back to the list.
  if (!hasPermission(principal, 'coupon.write')) redirect('/admin/coupons');

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/coupons"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Coupons
        </Link>
        <h1 className="mt-2 font-serif text-2xl font-semibold">New coupon</h1>
      </div>

      <CouponForm coupon={null} categories={categories} canEdit />
    </div>
  );
}
