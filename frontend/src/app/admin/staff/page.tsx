import type { Metadata } from 'next';
import Link from 'next/link';
import { UserCog } from 'lucide-react';
import type { AdminStaffList } from '@momishop/shared/api-types';
import { AddStaffForm, ROLE_LABELS } from '@/components/admin/staff-forms';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ApiError, apiGet } from '@/lib/api';
import { relativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Staff' };

export default async function AdminStaffPage() {
  const list = await apiGet<AdminStaffList>('/admin/staff').catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 403) return null;
    throw error;
  });

  if (!list) {
    return (
      <EmptyState
        icon={UserCog}
        title="Staff accounts are managed by a super admin"
        description="Ask a super admin to add a colleague or change what they can do."
      />
    );
  }

  const { items, assignableRoles, canWrite } = list;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Staff</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {items.length} account{items.length === 1 ? '' : 's'} with admin access
        </p>
      </div>

      <div className="scroll-x rounded-lg border">
        <table className="w-full text-sm">
          <caption className="sr-only">Staff accounts</caption>
          <thead>
            <tr className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="p-3 text-start font-medium">
                Person
              </th>
              <th scope="col" className="p-3 text-start font-medium">
                Role
              </th>
              <th scope="col" className="p-3 text-end font-medium">
                Last signed in
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((member) => (
              <tr key={member.id} className="hover:bg-accent/30">
                <td className="p-3">
                  <Link
                    href={`/admin/staff/${member.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {member.name ?? member.email}
                  </Link>
                  {member.isSelf && <span className="text-muted-foreground"> (you)</span>}
                  <span className="block text-xs text-muted-foreground">{member.email}</span>
                </td>
                <td className="p-3">
                  <Badge variant={member.role === 'STAFF' ? 'secondary' : 'default'}>
                    {ROLE_LABELS[member.role]}
                  </Badge>
                  {member.status === 'SUSPENDED' && (
                    <Badge variant="destructive" className="ms-1">
                      suspended
                    </Badge>
                  )}
                  {member.permissions.length > 0 && (
                    <span className="ms-2 text-xs text-muted-foreground">
                      +{member.permissions.length} extra
                    </span>
                  )}
                </td>
                <td className="p-3 text-end text-xs text-muted-foreground">
                  {member.lastLoginAt ? relativeTime(member.lastLoginAt) : 'Never'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canWrite && assignableRoles.length > 0 && <AddStaffForm assignableRoles={assignableRoles} />}
    </div>
  );
}
