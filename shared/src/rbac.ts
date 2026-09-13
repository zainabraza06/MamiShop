/** Mirrors the Prisma `UserRole` enum; local so this package has no database dependency. */
export type UserRole = 'CUSTOMER' | 'STAFF' | 'ADMIN' | 'SUPER_ADMIN';

/**
 * Role-based access control.
 *
 * Two layers:
 *   1. A role grants a default permission set (the common case).
 *   2. A user's `permissions[]` column grants extras on top, so the owner can
 *      give one staff member refund rights without promoting them to admin.
 *
 * This module is pure, with no I/O, so the per-request proxy can import it.
 * It never decides anything on its own — every server entry point re-checks the
 * session's role against it. Client-side role checks are for hiding UI only,
 * never for authorisation.
 */

export const PERMISSIONS = [
  'product.read',
  'product.write',
  'product.delete',
  'product.import',
  'category.write',
  'inventory.write',
  'order.read',
  'order.write',
  'order.cancel',
  'order.refund',
  'order.create_manual',
  'customer.read',
  'customer.write',
  'customer.impersonate',
  'review.moderate',
  'request.read',
  'request.write',
  'return.read',
  'return.write',
  'coupon.read',
  'coupon.write',
  'content.write',
  'settings.write',
  'shipping.write',
  'tax.write',
  'staff.read',
  'staff.write',
  'report.read',
  'report.export',
  'audit.read',
  'data_request.handle',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Default grants per role.
 *
 * STAFF is deliberately read-mostly: they run day-to-day fulfilment but cannot
 * move money, change prices, or create other staff accounts. Refunds and
 * pricing are the two levers most worth restricting in a small business.
 */
const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  CUSTOMER: [],

  STAFF: [
    'product.read',
    'order.read',
    'order.write',
    'order.create_manual',
    'customer.read',
    'return.read',
    'return.write',
    'review.moderate',
    // Staff run the conversations with customers asking for something made.
    'request.read',
    'request.write',
    'inventory.write',
    // Read-only: staff are asked "does this code still work?" every day, and
    // answering it should not require the right to create discounts.
    'coupon.read',
    'report.read',
  ],

  ADMIN: [
    'product.read',
    'product.write',
    'product.delete',
    'product.import',
    'category.write',
    'inventory.write',
    'order.read',
    'order.write',
    'order.cancel',
    'order.refund',
    'order.create_manual',
    'customer.read',
    'customer.write',
    'review.moderate',
    'request.read',
    'request.write',
    'return.read',
    'return.write',
    'coupon.read',
    'coupon.write',
    'content.write',
    'shipping.write',
    'tax.write',
    'report.read',
    'report.export',
    'audit.read',
  ],

  // SUPER_ADMIN is handled by the wildcard in `hasPermission`, but the list is
  // kept explicit so `permissionsFor` can enumerate it for the UI.
  SUPER_ADMIN: [...PERMISSIONS],
};

export function permissionsFor(role: UserRole, extra: string[] = []): Set<Permission> {
  const granted = new Set<Permission>(ROLE_PERMISSIONS[role]);
  for (const p of extra) {
    if ((PERMISSIONS as readonly string[]).includes(p)) granted.add(p as Permission);
  }
  return granted;
}

export interface Principal {
  role: UserRole;
  permissions?: string[];
}

/** SUPER_ADMIN bypasses the table entirely — there is no lockout scenario. */
export function hasPermission(principal: Principal | null, permission: Permission): boolean {
  if (!principal) return false;
  if (principal.role === 'SUPER_ADMIN') return true;
  return permissionsFor(principal.role, principal.permissions ?? []).has(permission);
}

export function hasAnyPermission(principal: Principal | null, permissions: Permission[]): boolean {
  return permissions.some((p) => hasPermission(principal, p));
}

export function hasAllPermissions(principal: Principal | null, permissions: Permission[]): boolean {
  return permissions.every((p) => hasPermission(principal, p));
}

/** Any role that may open the admin area at all. */
export const STAFF_ROLES: UserRole[] = ['STAFF', 'ADMIN', 'SUPER_ADMIN'];

export function isStaff(principal: Principal | null): boolean {
  return principal !== null && STAFF_ROLES.includes(principal.role);
}

/**
 * Role hierarchy used to stop privilege escalation: a user may only assign a
 * role strictly below their own. Without this, an ADMIN could promote
 * themselves — or a colleague — to SUPER_ADMIN.
 */
const ROLE_RANK: Record<UserRole, number> = {
  CUSTOMER: 0,
  STAFF: 1,
  ADMIN: 2,
  SUPER_ADMIN: 3,
};

export function canAssignRole(actor: Principal | null, target: UserRole): boolean {
  if (!actor) return false;
  if (actor.role === 'SUPER_ADMIN') return true;
  if (!hasPermission(actor, 'staff.write')) return false;
  return ROLE_RANK[target] < ROLE_RANK[actor.role];
}

/** Whether `actor` may modify the account of a user holding `targetRole`. */
export function canManageUser(actor: Principal | null, targetRole: UserRole): boolean {
  if (!actor) return false;
  if (actor.role === 'SUPER_ADMIN') return true;
  if (!hasPermission(actor, 'customer.write') && !hasPermission(actor, 'staff.write')) {
    return false;
  }
  return ROLE_RANK[targetRole] < ROLE_RANK[actor.role];
}

/** Admin navigation gating — each section needs at least one of these. */
export const SECTION_PERMISSIONS = {
  dashboard: ['order.read', 'report.read'],
  products: ['product.read'],
  categories: ['category.write', 'product.read'],
  orders: ['order.read'],
  returns: ['return.read'],
  customers: ['customer.read'],
  reviews: ['review.moderate'],
  requests: ['request.read'],
  coupons: ['coupon.read'],
  content: ['content.write'],
  reports: ['report.read'],
  staff: ['staff.read', 'staff.write'],
  settings: ['settings.write', 'shipping.write', 'tax.write'],
  audit: ['audit.read'],
} as const satisfies Record<string, readonly Permission[]>;

export type AdminSection = keyof typeof SECTION_PERMISSIONS;

export function canAccessSection(principal: Principal | null, section: AdminSection): boolean {
  return hasAnyPermission(principal, [...SECTION_PERMISSIONS[section]]);
}

/** Friendly labels for the staff permission editor. */
export const PERMISSION_LABELS: Record<Permission, string> = {
  'product.read': 'View products',
  'product.write': 'Create and edit products',
  'product.delete': 'Archive products',
  'product.import': 'Bulk import / export products',
  'category.write': 'Manage categories',
  'inventory.write': 'Adjust stock levels',
  'order.read': 'View orders',
  'order.write': 'Update order status',
  'order.cancel': 'Cancel orders',
  'order.refund': 'Issue refunds',
  'order.create_manual': 'Create phone / WhatsApp orders',
  'customer.read': 'View customers',
  'customer.write': 'Edit customer accounts',
  'customer.impersonate': 'Sign in as a customer',
  'review.moderate': 'Moderate reviews',
  'request.read': 'View custom dress requests',
  'request.write': 'Reply to custom dress requests',
  'return.read': 'View return requests',
  'return.write': 'Process returns and exchanges',
  'coupon.read': 'View coupons',
  'coupon.write': 'Manage coupons',
  'content.write': 'Edit homepage and pages',
  'settings.write': 'Change store settings',
  'shipping.write': 'Manage shipping zones and rates',
  'tax.write': 'Manage tax rules',
  'staff.read': 'View staff accounts',
  'staff.write': 'Manage staff accounts',
  'report.read': 'View reports',
  'report.export': 'Export reports',
  'audit.read': 'View the audit log',
  'data_request.handle': 'Handle data export / deletion requests',
};
