import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { passwordSchema, safeText, staffSchema } from '@momishop/shared/validation';
import {
  canAssignRole,
  canManageUser,
  hasPermission,
  PERMISSIONS,
  STAFF_ROLES,
  type Principal,
  type UserRole,
} from '@momishop/shared/rbac';
import { prisma } from '../lib/db';
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from '../lib/errors';
import { hashPassword } from '../lib/password';
import { requirePermission } from '../auth/current-user';
import { ipHash } from '../http/request';
import { parseBody } from '../http/validate';
import { actorFrom, recordAudit } from '../services/audit';

/**
 * Staff accounts.
 *
 * Every rule here exists to stop someone handing themselves, or a friend, more
 * power than they hold:
 *
 *   - a role can only be given by someone ranked above it;
 *   - an extra permission can only be given by someone who has it;
 *   - nobody changes their own role, permissions or access;
 *   - the last active super admin cannot be demoted or suspended, which would
 *     leave nobody able to manage staff at all.
 *
 * Accounts are suspended, never deleted: the audit log names who did what, and
 * that has to keep resolving to a person.
 */
export const adminStaffRouter = Router();

type StaffRole = Exclude<UserRole, 'CUSTOMER'>;

const staffSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  permissions: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

function principalOf(user: { role: string; permissions: string[] }): Principal {
  return { role: user.role as UserRole, permissions: user.permissions };
}

/** Refuses any permission the granter does not hold, or that does not exist. */
function assertGrantable(principal: Principal, permissions: string[]) {
  const unknown = permissions.filter((p) => !(PERMISSIONS as readonly string[]).includes(p));
  if (unknown.length > 0) {
    throw new ValidationError(`Unknown permission: ${unknown.join(', ')}.`, [
      { field: 'permissions', message: 'Unknown permission.' },
    ]);
  }

  const withheld = permissions.filter(
    (p) => !hasPermission(principal, p as (typeof PERMISSIONS)[number]),
  );
  if (withheld.length > 0) {
    throw new AuthorizationError(
      `You can only grant permissions you have yourself (not ${withheld.join(', ')}).`,
    );
  }
}

function describeFor(principal: Principal, actorId: string) {
  return (member: { id: string; role: string } & Record<string, unknown>) => ({
    ...member,
    isSelf: member.id === actorId,
    canManage: member.id !== actorId && canManageUser(principal, member.role as UserRole),
  });
}

function assignableRoles(principal: Principal): StaffRole[] {
  return (STAFF_ROLES as StaffRole[]).filter((role) => canAssignRole(principal, role));
}

const auditContext = (req: Request) => ({
  ip: ipHash(req),
  userAgent: req.get('user-agent') ?? null,
});

adminStaffRouter.get('/admin/staff', async (req, res) => {
  const actor = await requirePermission(req, 'staff.read');
  const principal = principalOf(actor);

  const members = await prisma.user.findMany({
    where: { role: { in: STAFF_ROLES }, deletedAt: null },
    orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    select: staffSelect,
  });

  res.json({
    items: members.map(describeFor(principal, actor.id)),
    assignableRoles: assignableRoles(principal),
    canWrite: hasPermission(principal, 'staff.write'),
  });
});

adminStaffRouter.get('/admin/staff/:id', async (req, res) => {
  const actor = await requirePermission(req, 'staff.read');
  const principal = principalOf(actor);

  const member = await prisma.user.findFirst({
    where: { id: req.params.id, role: { in: STAFF_ROLES }, deletedAt: null },
    select: staffSelect,
  });
  if (!member) throw new NotFoundError('Staff member');

  res.json({
    staff: describeFor(principal, actor.id)(member),
    assignableRoles: assignableRoles(principal),
    canWrite: hasPermission(principal, 'staff.write'),
  });
});

const createSchema = staffSchema.extend({ password: passwordSchema.optional() });

/**
 * Add a staff member. An existing customer account with the same email is
 * promoted rather than duplicated — it is the same person.
 */
adminStaffRouter.post('/admin/staff', async (req, res) => {
  const actor = await requirePermission(req, 'staff.write');
  const principal = principalOf(actor);
  const { password, ...input } = parseBody(req, createSchema);

  if (!canAssignRole(principal, input.role)) {
    throw new AuthorizationError(`You cannot give someone the ${input.role.toLowerCase()} role.`);
  }
  assertGrantable(principal, input.permissions);

  const existing = await prisma.user.findFirst({
    where: { email: input.email },
    select: { id: true, role: true, email: true },
  });

  if (existing && existing.role !== 'CUSTOMER') {
    throw new ConflictError(`${existing.email} already has a staff account.`);
  }
  if (!existing && !password) {
    throw new ValidationError('Set a starting password for the new account.', [
      { field: 'password', message: 'A starting password is required.' },
    ]);
  }

  const passwordHash = password ? await hashPassword(password) : undefined;

  const member = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: {
          role: input.role,
          permissions: input.permissions,
          status: input.status,
          ...(passwordHash ? { passwordHash } : {}),
        },
        select: staffSelect,
      })
    : await prisma.user.create({
        data: {
          email: input.email,
          name: input.name,
          role: input.role,
          permissions: input.permissions,
          status: input.status,
          passwordHash,
        },
        select: staffSelect,
      });

  await recordAudit({
    actor: actorFrom(actor),
    action: existing ? 'staff.role_change' : 'staff.create',
    entityType: 'User',
    entityId: member.id,
    summary: existing
      ? `Gave ${member.email} the ${member.role.toLowerCase()} role`
      : `Added ${member.email} as ${member.role.toLowerCase()}`,
    after: { role: member.role, permissions: member.permissions, status: member.status },
    ...auditContext(req),
  });

  res.status(201).json({ staff: { id: member.id } });
});

const updateSchema = z
  .object({
    name: safeText(80, 'Name').pipe(z.string().min(2, 'Enter a name.')).optional(),
    role: z.enum(['STAFF', 'ADMIN', 'SUPER_ADMIN']).optional(),
    permissions: z.array(z.string().max(48)).max(40).optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    'Nothing to change.',
  );

adminStaffRouter.patch('/admin/staff/:id', async (req, res) => {
  const actor = await requirePermission(req, 'staff.write');
  const principal = principalOf(actor);
  const input = parseBody(req, updateSchema);

  const before = await prisma.user.findFirst({
    where: { id: req.params.id, role: { in: STAFF_ROLES }, deletedAt: null },
    select: staffSelect,
  });
  if (!before) throw new NotFoundError('Staff member');

  const changesAccess =
    (input.role !== undefined && input.role !== before.role) ||
    (input.status !== undefined && input.status !== before.status) ||
    (input.permissions !== undefined &&
      JSON.stringify([...input.permissions].sort()) !==
        JSON.stringify([...before.permissions].sort()));

  if (before.id === actor.id && changesAccess) {
    throw new ValidationError(
      'You cannot change your own role, permissions or access. Ask another super admin.',
    );
  }

  if (before.id !== actor.id && !canManageUser(principal, before.role as UserRole)) {
    throw new AuthorizationError('You cannot manage an account ranked at or above your own.');
  }

  if (input.role && input.role !== before.role && !canAssignRole(principal, input.role)) {
    throw new AuthorizationError(`You cannot give someone the ${input.role.toLowerCase()} role.`);
  }

  if (input.permissions) assertGrantable(principal, input.permissions);

  // Never leave the shop without someone able to manage staff.
  const losesSuperAdmin =
    before.role === 'SUPER_ADMIN' &&
    before.status === 'ACTIVE' &&
    ((input.role !== undefined && input.role !== 'SUPER_ADMIN') || input.status === 'SUSPENDED');

  if (losesSuperAdmin) {
    const others = await prisma.user.count({
      where: {
        id: { not: before.id },
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        deletedAt: null,
      },
    });
    if (others === 0) {
      throw new ConflictError(
        `${before.email} is the only active super admin. Make someone else a super admin first.`,
      );
    }
  }

  const after = await prisma.user.update({
    where: { id: before.id },
    data: input,
    select: staffSelect,
  });

  await recordAudit({
    actor: actorFrom(actor),
    action: input.role && input.role !== before.role ? 'staff.role_change' : 'staff.update',
    entityType: 'User',
    entityId: before.id,
    summary:
      input.role && input.role !== before.role
        ? `Changed ${before.email} from ${before.role.toLowerCase()} to ${input.role.toLowerCase()}`
        : input.status && input.status !== before.status
          ? `${input.status === 'SUSPENDED' ? 'Suspended' : 'Reinstated'} ${before.email}`
          : `Updated ${before.email}`,
    before: {
      name: before.name,
      role: before.role,
      status: before.status,
      permissions: before.permissions,
    },
    after: {
      name: after.name,
      role: after.role,
      status: after.status,
      permissions: after.permissions,
    },
    ...auditContext(req),
  });

  res.json({ staff: describeFor(principal, actor.id)(after) });
});

/**
 * Set a new password for a colleague who is locked out.
 *
 * Your own password is changed from your account page, which asks for the
 * current one; this route does not, so it only works on other people.
 */
adminStaffRouter.post('/admin/staff/:id/password', async (req, res) => {
  const actor = await requirePermission(req, 'staff.write');
  const principal = principalOf(actor);
  const { password } = parseBody(req, z.object({ password: passwordSchema }));

  const member = await prisma.user.findFirst({
    where: { id: req.params.id, role: { in: STAFF_ROLES }, deletedAt: null },
    select: { id: true, email: true, role: true },
  });
  if (!member) throw new NotFoundError('Staff member');

  if (member.id === actor.id) {
    throw new ValidationError('Change your own password from your account page.');
  }
  if (!canManageUser(principal, member.role as UserRole)) {
    throw new AuthorizationError('You cannot manage an account ranked at or above your own.');
  }

  await prisma.user.update({
    where: { id: member.id },
    // A reset also lifts a lockout: the point is to let them back in.
    data: { passwordHash: await hashPassword(password), failedLoginCount: 0, lockedUntil: null },
  });

  // The password itself never reaches the log.
  await recordAudit({
    actor: actorFrom(actor),
    action: 'staff.update',
    entityType: 'User',
    entityId: member.id,
    summary: `Reset the password for ${member.email}`,
    ...auditContext(req),
  });

  res.json({ ok: true });
});
