import { redirect } from 'next/navigation';
import type { AdminShell as AdminShellData } from '@momishop/shared/api-types';
import { AdminShell } from '@/components/admin/admin-shell';
import { ApiError, apiGet } from '@/lib/api';

/**
 * Admin shell.
 *
 * The second of the two authorisation gates. The proxy already redirected
 * anonymous and non-staff visitors, but it decided from the session token,
 * which reflects the user's role at sign-in. The API's admin endpoints check
 * the live user row, so a staff member demoted five minutes ago loses access
 * on their very next request rather than when their week-old token expires.
 */
export const dynamic = 'force-dynamic';

async function loadShell(): Promise<AdminShellData> {
  try {
    return await apiGet<AdminShellData>('/admin/shell');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?callbackUrl=/admin');
    if (error instanceof ApiError && error.status === 403) redirect('/');
    throw error;
  }
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, badges } = await loadShell();

  return (
    <AdminShell user={user} badges={badges}>
      {children}
    </AdminShell>
  );
}
