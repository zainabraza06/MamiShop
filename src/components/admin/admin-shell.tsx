'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import {
  BarChart3,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  RotateCcw,
  Settings,
  ShoppingCart,
  Star,
  Tag,
  Users,
  UserCog,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { canAccessSection, type AdminSection, type Principal } from '@/lib/rbac';
import { cn } from '@/lib/utils';

/**
 * Admin chrome.
 *
 * Navigation is filtered by the viewer's permissions, so a staff member with
 * no refund rights never sees a Reports link they cannot open. This is purely
 * cosmetic — every page re-checks server-side. Hiding a link the user cannot
 * use is good UX; relying on it for access control would not be security.
 */

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  section: AdminSection;
  badgeKey?: 'orders' | 'returns' | 'reviews';
}

const NAV: NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, section: 'dashboard' },
  { href: '/admin/orders', label: 'Orders', icon: ShoppingCart, section: 'orders', badgeKey: 'orders' },
  { href: '/admin/products', label: 'Products', icon: Package, section: 'products' },
  { href: '/admin/returns', label: 'Returns', icon: RotateCcw, section: 'returns', badgeKey: 'returns' },
  { href: '/admin/customers', label: 'Customers', icon: Users, section: 'customers' },
  { href: '/admin/reviews', label: 'Reviews', icon: Star, section: 'reviews', badgeKey: 'reviews' },
  { href: '/admin/coupons', label: 'Coupons', icon: Tag, section: 'coupons' },
  { href: '/admin/content', label: 'Content', icon: FileText, section: 'content' },
  { href: '/admin/reports', label: 'Reports', icon: BarChart3, section: 'reports' },
  { href: '/admin/staff', label: 'Staff', icon: UserCog, section: 'staff' },
  { href: '/admin/audit', label: 'Audit log', icon: ClipboardList, section: 'audit' },
  { href: '/admin/settings', label: 'Settings', icon: Settings, section: 'settings' },
];

export function AdminShell({
  user,
  badges,
  children,
}: {
  user: { name: string | null; email: string; role: string; permissions: string[] };
  badges: { orders: number; returns: number; reviews: number };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const principal: Principal = { role: user.role as Principal['role'], permissions: user.permissions };
  const visible = NAV.filter((item) => canAccessSection(principal, item.section));

  return (
    <div className="flex min-h-dvh bg-muted/30">
      {/* Sidebar */}
      <aside
        id="admin-navigation"
        className={cn(
          'fixed inset-y-0 start-0 z-50 w-64 shrink-0 border-e bg-background lg:static lg:block',
          !mobileOpen && 'hidden lg:block',
        )}
      >
        <div className="flex h-16 items-center justify-between border-b px-4">
          <Link href="/admin" className="font-serif text-lg font-semibold">
            MomiShop
            <span className="ms-1 text-xs font-normal text-muted-foreground">admin</span>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(false)}
          >
            <X aria-hidden="true" />
            <span className="sr-only">Close navigation</span>
          </Button>
        </div>

        <nav aria-label="Admin" className="p-3">
          <ul className="space-y-0.5">
            {visible.map((item) => {
              const Icon = item.icon;
              const isActive =
                item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
              const badge = item.badgeKey ? badges[item.badgeKey] : 0;

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    <span className="flex-1">{item.label}</span>
                    {badge > 0 && (
                      <Badge variant={isActive ? 'secondary' : 'default'} className="tabular-nums">
                        {badge}
                        <span className="sr-only"> needing attention</span>
                      </Badge>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="absolute inset-x-0 bottom-0 border-t p-3">
          <p className="truncate px-3 text-sm font-medium">{user.name ?? user.email}</p>
          <p className="truncate px-3 text-xs text-muted-foreground">
            {user.role.replace('_', ' ').toLowerCase()}
          </p>
          <Button
            variant="ghost"
            size="sm"
            fullWidth
            className="mt-2 justify-start"
            onClick={() => void signOut({ callbackUrl: '/' })}
          >
            <LogOut aria-hidden="true" />
            Sign out
          </Button>
        </div>
      </aside>

      {/* Backdrop for the mobile drawer */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-foreground/40 lg:hidden"
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center gap-3 border-b bg-background px-4 lg:hidden">
          <Button
            variant="ghost"
            size="icon"
            aria-expanded={mobileOpen}
            aria-controls="admin-navigation"
            onClick={() => setMobileOpen(true)}
          >
            <Menu aria-hidden="true" />
            <span className="sr-only">Open navigation</span>
          </Button>
          <span className="font-serif text-lg font-semibold">MomiShop admin</span>
        </header>

        <main id="main-content" className="min-w-0 flex-1 p-4 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
