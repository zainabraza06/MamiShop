import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import type { AdminShell, AdminStaffDetail } from '@momishop/shared/api-types';
import { hasPermission, PERMISSIONS, type Principal } from '@momishop/shared/rbac';
import { formatDateTime } from '@momishop/shared/text';
import { PasswordResetForm, ROLE_LABELS, StaffEditor } from '@/components/admin/staff-forms';
import { Badge } from '@/components/ui/badge';
import { ApiError, apiGet } from '@/lib/api';

export const metadata: Metadata = { title: 'Staff member' };

export default async function StaffMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [shell, detail] = await Promise.all([
    apiGet<AdminShell>('/admin/shell'),
    apiGet<AdminStaffDetail>(`/admin/staff/${id}`).catch((error: unknown) => {
      if (error instanceof ApiError && (error.status === 404 || error.status === 403)) return null;
      throw error;
    }),
  ]);

  if (!detail) notFound();
  const { staff: member, assignableRoles, canWrite } = detail;

  const principal: Principal = {
    role: shell.user.role as Principal['role'],
    permissions: shell.user.permissions,
  };
  const grantable = PERMISSIONS.filter((permission) => hasPermission(principal, permission));

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/staff"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Staff
        </Link>
        <h1 className="mt-2 flex flex-wrap items-center gap-2 font-serif text-2xl font-semibold">
          {member.name ?? member.email}
          <Badge variant={member.role === 'STAFF' ? 'secondary' : 'default'}>
            {ROLE_LABELS[member.role]}
          </Badge>
          {member.status === 'SUSPENDED' && <Badge variant="destructive">suspended</Badge>}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {member.email} · last signed in{' '}
          {member.lastLoginAt ? formatDateTime(member.lastLoginAt) : 'never'}
        </p>
        {member.isSelf && (
          <p className="mt-2 text-sm text-muted-foreground">
            This is your account. Another super admin has to change your role or access.
          </p>
        )}
        {!member.isSelf && !member.canManage && (
          <p className="mt-2 text-sm text-muted-foreground">
            This account is ranked at or above yours, so you can view it but not change it.
          </p>
        )}
      </div>

      {canWrite && (member.canManage || member.isSelf) ? (
        <StaffEditor
          key={`${member.role}-${member.status}-${member.permissions.join(',')}`}
          member={member}
          assignableRoles={assignableRoles}
          grantable={grantable}
        />
      ) : null}

      {canWrite && member.canManage && (
        <PasswordResetForm memberId={member.id} email={member.email} />
      )}
    </div>
  );
}
