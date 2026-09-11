import { describe, expect, it } from 'vitest';
import type { UserRole } from '../src/rbac';
import {
  PERMISSIONS,
  PERMISSION_LABELS,
  canAccessSection,
  canAssignRole,
  canManageUser,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  isStaff,
  permissionsFor,
  type Principal,
} from '../src/rbac';

/**
 * Authorisation rules.
 *
 * This module decides who may refund money, change prices and create staff
 * accounts, and it previously had no tests at all. Every test here pins down a
 * rule whose failure would be a privilege escalation or a locked-out owner.
 */

function as(role: UserRole, permissions: string[] = []): Principal {
  return { role, permissions };
}

describe('hasPermission', () => {
  it('denies everything to a missing principal', () => {
    expect(hasPermission(null, 'order.read')).toBe(false);
  });

  it('grants a customer nothing in the admin area', () => {
    for (const permission of PERMISSIONS) {
      expect(hasPermission(as('CUSTOMER'), permission)).toBe(false);
    }
  });

  it('lets staff run fulfilment', () => {
    expect(hasPermission(as('STAFF'), 'order.read')).toBe(true);
    expect(hasPermission(as('STAFF'), 'order.write')).toBe(true);
    expect(hasPermission(as('STAFF'), 'order.create_manual')).toBe(true);
  });

  it('keeps staff away from money and pricing', () => {
    // Refunds and prices are the two levers most worth restricting.
    expect(hasPermission(as('STAFF'), 'order.refund')).toBe(false);
    expect(hasPermission(as('STAFF'), 'product.write')).toBe(false);
    expect(hasPermission(as('STAFF'), 'coupon.write')).toBe(false);
  });

  it('lets an admin refund and edit the catalogue', () => {
    expect(hasPermission(as('ADMIN'), 'order.refund')).toBe(true);
    expect(hasPermission(as('ADMIN'), 'product.write')).toBe(true);
  });

  it('does not let an admin manage staff or store settings by default', () => {
    expect(hasPermission(as('ADMIN'), 'staff.write')).toBe(false);
    expect(hasPermission(as('ADMIN'), 'settings.write')).toBe(false);
    expect(hasPermission(as('ADMIN'), 'customer.impersonate')).toBe(false);
  });

  it('gives a super admin every permission', () => {
    for (const permission of PERMISSIONS) {
      expect(hasPermission(as('SUPER_ADMIN'), permission)).toBe(true);
    }
  });

  it('adds an individually granted permission on top of the role', () => {
    const trustedStaff = as('STAFF', ['order.refund']);
    expect(hasPermission(trustedStaff, 'order.refund')).toBe(true);
    // ...without widening anything else.
    expect(hasPermission(trustedStaff, 'product.write')).toBe(false);
  });

  it('ignores a permission string that does not exist', () => {
    const granted = permissionsFor('STAFF', ['not.a.real.permission']);
    expect([...granted]).not.toContain('not.a.real.permission');
  });
});

describe('hasAnyPermission and hasAllPermissions', () => {
  it('passes "any" when one permission matches', () => {
    expect(hasAnyPermission(as('STAFF'), ['order.refund', 'order.read'])).toBe(true);
  });

  it('fails "all" when one permission is missing', () => {
    expect(hasAllPermissions(as('STAFF'), ['order.read', 'order.refund'])).toBe(false);
  });

  it('passes "all" when every permission matches', () => {
    expect(hasAllPermissions(as('ADMIN'), ['order.read', 'order.refund'])).toBe(true);
  });
});

describe('isStaff', () => {
  it('distinguishes staff roles from customers', () => {
    expect(isStaff(as('CUSTOMER'))).toBe(false);
    expect(isStaff(as('STAFF'))).toBe(true);
    expect(isStaff(as('ADMIN'))).toBe(true);
    expect(isStaff(as('SUPER_ADMIN'))).toBe(true);
    expect(isStaff(null)).toBe(false);
  });
});

describe('canAssignRole', () => {
  it('lets a super admin assign any role, including their own', () => {
    for (const role of ['CUSTOMER', 'STAFF', 'ADMIN', 'SUPER_ADMIN'] as const) {
      expect(canAssignRole(as('SUPER_ADMIN'), role)).toBe(true);
    }
  });

  it('refuses an admin who has not been granted staff management', () => {
    expect(canAssignRole(as('ADMIN'), 'STAFF')).toBe(false);
  });

  it('only allows assigning a role strictly below your own', () => {
    const manager = as('ADMIN', ['staff.write']);
    expect(canAssignRole(manager, 'STAFF')).toBe(true);
    // Equal rank would let an admin mint more admins.
    expect(canAssignRole(manager, 'ADMIN')).toBe(false);
  });

  it('blocks self-promotion to super admin', () => {
    expect(canAssignRole(as('ADMIN', ['staff.write']), 'SUPER_ADMIN')).toBe(false);
  });

  it('refuses a missing principal', () => {
    expect(canAssignRole(null, 'STAFF')).toBe(false);
  });
});

describe('canManageUser', () => {
  it('lets an admin manage customers and staff below them', () => {
    expect(canManageUser(as('ADMIN'), 'CUSTOMER')).toBe(true);
    expect(canManageUser(as('ADMIN'), 'STAFF')).toBe(true);
  });

  it('does not let an admin manage a peer or a superior', () => {
    expect(canManageUser(as('ADMIN'), 'ADMIN')).toBe(false);
    expect(canManageUser(as('ADMIN'), 'SUPER_ADMIN')).toBe(false);
  });

  it('does not let staff manage anyone', () => {
    expect(canManageUser(as('STAFF'), 'CUSTOMER')).toBe(false);
  });
});

describe('canAccessSection', () => {
  it('opens fulfilment sections to staff and closes the rest', () => {
    expect(canAccessSection(as('STAFF'), 'orders')).toBe(true);
    expect(canAccessSection(as('STAFF'), 'coupons')).toBe(false);
    expect(canAccessSection(as('STAFF'), 'audit')).toBe(false);
    expect(canAccessSection(as('STAFF'), 'settings')).toBe(false);
  });

  it('opens the audit log and shipping settings to an admin', () => {
    expect(canAccessSection(as('ADMIN'), 'audit')).toBe(true);
    expect(canAccessSection(as('ADMIN'), 'settings')).toBe(true);
  });

  it('keeps staff management away from an ordinary admin', () => {
    expect(canAccessSection(as('ADMIN'), 'staff')).toBe(false);
  });
});

describe('PERMISSION_LABELS', () => {
  it('labels every permission, so the staff editor has no blank rows', () => {
    for (const permission of PERMISSIONS) {
      expect(PERMISSION_LABELS[permission]).toBeTruthy();
    }
  });
});
