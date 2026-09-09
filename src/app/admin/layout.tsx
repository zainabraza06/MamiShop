import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/session';
import { isStaff, type Principal } from '@/lib/rbac';
import { AdminShell } from '@/components/admin/admin-shell';
import { prisma } from '@/lib/db';

/**
 * Admin shell.
 *
 * The second of the two authorisation gates. Middleware already redirected
 * anonymous and non-staff visitors, but that decision was made from the
 * session JWT, which reflects the user's role at sign-in. This check reads the
 * live row, so a staff member demoted five minutes ago loses access on their
 * very next request rather than when their week-old token expires.
 *
 * Individual pages narrow further with requirePermission().
 */
export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  if (!user) redirect('/login?callbackUrl=/admin');
  if (!isStaff(user as Principal)) redirect('/');

  // Counts for the sidebar badges: what actually needs a human today.
  const [pendingOrders, pendingReturns, pendingReviews] = await Promise.all([
    prisma.order.count({ where: { status: { in: ['PENDING', 'CONFIRMED'] } } }),
    prisma.returnRequest.count({ where: { status: 'REQUESTED' } }),
    prisma.review.count({ where: { status: 'PENDING' } }),
  ]);

  return (
    <AdminShell
      user={{
        name: user.name,
        email: user.email,
        role: user.role,
        permissions: user.permissions,
      }}
      badges={{ orders: pendingOrders, returns: pendingReturns, reviews: pendingReviews }}
    >
      {children}
    </AdminShell>
  );
}
