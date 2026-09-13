'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { KeyRound, UserPlus } from 'lucide-react';
import type { AdminStaffMember, StaffRole } from '@momishop/shared/api-types';
import {
  PERMISSION_LABELS,
  PERMISSIONS,
  permissionsFor,
  type Permission,
} from '@momishop/shared/rbac';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SelectField } from '@/components/ui/select-field';

/**
 * Adding staff, changing their role and access, and resetting a password.
 *
 * The API is the authority on who may do what; these forms only avoid
 * offering what it would refuse — roles above your own, permissions you do
 * not have, and changes to your own account.
 */

export const ROLE_LABELS: Record<StaffRole, string> = {
  STAFF: 'Staff',
  ADMIN: 'Admin',
  SUPER_ADMIN: 'Super admin',
};

const ROLE_HINTS: Record<StaffRole, string> = {
  STAFF: 'Runs orders, returns and reviews. Cannot move money or change prices.',
  ADMIN: 'Everything in the shop, including refunds, prices and coupons. Not staff accounts.',
  SUPER_ADMIN: 'Everything, including staff accounts and store settings.',
};

async function send(url: string, method: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const parsed = (await response.json().catch(() => null)) as {
    error?: string;
    issues?: { message: string }[];
  } | null;

  if (!response.ok) {
    throw new Error(parsed?.issues?.[0]?.message ?? parsed?.error ?? 'That did not go through.');
  }
  return parsed;
}

export function AddStaffForm({ assignableRoles }: { assignableRoles: StaffRole[] }) {
  const router = useRouter();
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState<StaffRole>(assignableRoles[0] ?? 'STAFF');
  const [password, setPassword] = React.useState('');
  const [isPending, setIsPending] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsPending(true);

    try {
      const result = (await send('/api/admin/staff', 'POST', {
        name,
        email,
        role,
        permissions: [],
        status: 'ACTIVE',
        password: password || undefined,
      })) as { staff: { id: string } };

      toast.success(`${email} can now sign in to the admin.`);
      router.push(`/admin/staff/${result.staff.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That did not go through.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Add staff</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
          <FormField label="Name" id="staff-name" required>
            <Input value={name} onChange={(event) => setName(event.target.value)} required />
          </FormField>
          <FormField
            label="Email"
            id="staff-email"
            required
            hint="An existing customer account with this email becomes a staff account."
          >
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </FormField>
          <SelectField
            label="Role"
            id="staff-role"
            value={role}
            onValueChange={(next) => setRole(next as StaffRole)}
            options={assignableRoles.map((value) => ({ value, label: ROLE_LABELS[value] }))}
            hint={ROLE_HINTS[role]}
          />
          <FormField
            label="Starting password"
            id="staff-password"
            hint="At least 10 characters. Share it privately; they can change it after signing in."
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </FormField>
          <div className="md:col-span-2">
            <Button type="submit" isLoading={isPending} loadingText="Adding">
              <UserPlus aria-hidden="true" />
              Add staff
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function StaffEditor({
  member,
  assignableRoles,
  grantable,
}: {
  member: AdminStaffMember;
  assignableRoles: StaffRole[];
  /** Permissions the signed-in user holds, and so may grant. */
  grantable: string[];
}) {
  const router = useRouter();
  const editable = member.canManage;

  const [name, setName] = React.useState(member.name ?? '');
  const [role, setRole] = React.useState<StaffRole>(member.role);
  const [status, setStatus] = React.useState(
    member.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
  );
  const [extras, setExtras] = React.useState<string[]>(member.permissions);
  const [isPending, setIsPending] = React.useState(false);

  const included = permissionsFor(role);
  // The current role stays selectable even when it is not one you could give.
  const roleOptions = Array.from(new Set<StaffRole>([member.role, ...assignableRoles]));

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (status === 'SUSPENDED' && member.status !== 'SUSPENDED') {
      if (!window.confirm(`Suspend ${member.email}? They are signed out straight away.`)) return;
    }

    setIsPending(true);
    try {
      await send(`/api/admin/staff/${member.id}`, 'PATCH', {
        name,
        ...(editable
          ? {
              role,
              status,
              // Extras already covered by the role are dropped rather than stored twice.
              permissions: extras.filter((p) => !included.has(p as Permission)),
            }
          : {}),
      });
      toast.success('Saved.');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That did not go through.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle as="h2">Account</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <FormField label="Name" id="edit-staff-name" required>
            <Input value={name} onChange={(event) => setName(event.target.value)} required />
          </FormField>

          <SelectField
            label="Role"
            id="edit-staff-role"
            value={role}
            onValueChange={(next) => setRole(next as StaffRole)}
            options={roleOptions.map((value) => ({ value, label: ROLE_LABELS[value] }))}
            hint={ROLE_HINTS[role]}
            disabled={!editable}
          />

          <fieldset className="md:col-span-2">
            <legend className="mb-2 text-sm font-medium">Access</legend>
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              {(['ACTIVE', 'SUSPENDED'] as const).map((value) => (
                <label key={value} className="flex min-h-9 items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="staff-status"
                    className="size-4 accent-primary"
                    checked={status === value}
                    onChange={() => setStatus(value)}
                    disabled={!editable}
                  />
                  {value === 'ACTIVE' ? 'Can sign in' : 'Suspended'}
                </label>
              ))}
            </div>
          </fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Permissions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Ticked and greyed out comes with the {ROLE_LABELS[role].toLowerCase()} role. Tick others
            to grant them on top.
          </p>
          <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {PERMISSIONS.map((permission) => {
              const fromRole = included.has(permission);
              const canGrant = grantable.includes(permission);

              return (
                <li key={permission}>
                  <label className="flex min-h-9 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 rounded border-input accent-primary"
                      checked={fromRole || extras.includes(permission)}
                      disabled={!editable || fromRole || !canGrant}
                      onChange={() =>
                        setExtras((current) =>
                          current.includes(permission)
                            ? current.filter((p) => p !== permission)
                            : [...current, permission],
                        )
                      }
                    />
                    <span className={fromRole ? 'text-muted-foreground' : undefined}>
                      {PERMISSION_LABELS[permission]}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Button type="submit" isLoading={isPending} loadingText="Saving">
        Save changes
      </Button>
    </form>
  );
}

export function PasswordResetForm({ memberId, email }: { memberId: string; email: string }) {
  const [password, setPassword] = React.useState('');
  const [isPending, setIsPending] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsPending(true);

    try {
      await send(`/api/admin/staff/${memberId}/password`, 'POST', { password });
      toast.success(`New password set for ${email}. Share it privately.`);
      setPassword('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That did not go through.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Reset password</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
          <FormField
            label="New password"
            id="reset-password"
            className="min-w-56 flex-1"
            hint="Also unlocks the account if they were locked out."
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </FormField>
          <Button type="submit" variant="outline" isLoading={isPending} loadingText="Saving">
            <KeyRound aria-hidden="true" />
            Set password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
