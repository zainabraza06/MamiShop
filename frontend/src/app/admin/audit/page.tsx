import type { Metadata } from 'next';
import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import type { AdminAuditEntry, AdminAuditList } from '@momishop/shared/api-types';
import { formatDateTime } from '@momishop/shared/text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { ApiError, apiGet } from '@/lib/api';

export const metadata: Metadata = { title: 'Audit log' };

/** Friendly names for the part of an action before the dot. */
const AREA_LABELS: Record<string, string> = {
  auth: 'Sign-in',
  category: 'Categories',
  content: 'Content',
  coupon: 'Coupons',
  customer: 'Customers',
  data_request: 'Data requests',
  filter: 'Filters',
  inventory: 'Stock',
  order: 'Orders',
  page: 'Pages',
  product: 'Products',
  return: 'Returns',
  review: 'Reviews',
  settings: 'Settings',
  shipping: 'Shipping',
  staff: 'Staff',
  tax: 'Tax',
};

const areaLabel = (name: string) =>
  AREA_LABELS[name] ?? name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, ' ');

/** Where an entry's subject lives in the admin, when it has a page of its own. */
function entityHref(entry: AdminAuditEntry): string | null {
  if (!entry.entityId) return null;
  switch (entry.entityType) {
    case 'Order':
      return `/admin/orders/${entry.entityId}`;
    case 'Product':
      return `/admin/products/${entry.entityId}`;
    case 'Coupon':
      return `/admin/coupons/${entry.entityId}`;
    case 'User':
      return entry.action.startsWith('staff.')
        ? `/admin/staff/${entry.entityId}`
        : `/admin/customers/${entry.entityId}`;
    default:
      return null;
  }
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const area = typeof params.area === 'string' ? params.area : undefined;
  const actor = typeof params.actor === 'string' ? params.actor : undefined;
  const cursor = typeof params.cursor === 'string' ? params.cursor : undefined;

  const query = new URLSearchParams();
  if (area) query.set('area', area);
  if (actor) query.set('actor', actor);
  if (cursor) query.set('cursor', cursor);

  // The sidebar hides the audit log from staff, but the address still works.
  // Without this, the API's refusal crashed the whole page.
  const log = await apiGet<AdminAuditList>(`/admin/audit?${query.toString()}`).catch(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 403) return null;
      throw error;
    },
  );

  if (!log) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="The audit log is for admins"
        description="Ask an admin or super admin if you need to know who changed something."
      />
    );
  }

  const { items, nextCursor, areas } = log;

  /** A link to this view with some parameters changed. */
  const hrefWith = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = { area, actor, ...changes };
    for (const [key, value] of Object.entries(merged)) if (value) next.set(key, value);
    const qs = next.toString();
    return qs ? `/admin/audit?${qs}` : '/admin/audit';
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Audit log</h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Every change made in the admin: who made it, when, and what it changed. Entries cannot
            be edited or deleted.
          </p>
        </div>

        <form className="flex gap-2" action="/admin/audit">
          {area && <input type="hidden" name="area" value={area} />}
          <Input
            name="actor"
            defaultValue={actor ?? ''}
            placeholder="Staff email"
            aria-label="Filter by who made the change"
            className="w-56"
          />
          <Button type="submit" variant="outline">
            Filter
          </Button>
        </form>
      </div>

      <nav aria-label="Filter by area">
        <ul className="flex flex-wrap gap-2">
          <li>
            <Button variant={!area ? 'default' : 'outline'} size="sm" asChild>
              <Link href={hrefWith({ area: undefined })} aria-current={!area ? 'page' : undefined}>
                All
              </Link>
            </Button>
          </li>
          {areas.map((option) => {
            const active = option.name === area;
            return (
              <li key={option.name}>
                <Button variant={active ? 'default' : 'outline'} size="sm" asChild>
                  <Link
                    href={hrefWith({ area: option.name })}
                    aria-current={active ? 'page' : undefined}
                  >
                    {areaLabel(option.name)}
                    <span className="ms-1.5 tabular-nums opacity-70">{option.count}</span>
                  </Link>
                </Button>
              </li>
            );
          })}
        </ul>
      </nav>

      {items.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Nothing recorded"
          description={
            area || actor ? 'No entries match that filter.' : 'Changes appear here as they happen.'
          }
        />
      ) : (
        <ol className="divide-y rounded-lg border bg-background">
          {items.map((entry) => {
            const href = entityHref(entry);
            const hasDiff = entry.diff !== null && entry.diff !== undefined;

            return (
              <li key={entry.id} className="space-y-1 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="font-medium">
                    {href ? (
                      <Link href={href} className="underline-offset-4 hover:underline">
                        {entry.summary ?? entry.action}
                      </Link>
                    ) : (
                      (entry.summary ?? entry.action)
                    )}
                  </p>
                  <time dateTime={entry.createdAt} className="text-xs text-muted-foreground">
                    {formatDateTime(entry.createdAt)}
                  </time>
                </div>

                <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{entry.actorEmail ?? 'System'}</span>
                  {entry.actorRole && (
                    <Badge variant="secondary">
                      {entry.actorRole.replace('_', ' ').toLowerCase()}
                    </Badge>
                  )}
                  <code className="font-mono">{entry.action}</code>
                </p>

                {hasDiff && (
                  <details className="pt-1 text-sm">
                    <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                      What changed
                    </summary>
                    <pre className="scroll-x mt-2 rounded-md bg-muted/50 p-3 text-xs">
                      {JSON.stringify(entry.diff, null, 2)}
                    </pre>
                  </details>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {(cursor || nextCursor) && (
        <nav aria-label="Pages" className="flex justify-between gap-2">
          {cursor ? (
            <Button variant="outline" asChild>
              <Link href={hrefWith({ cursor: undefined })}>Newest</Link>
            </Button>
          ) : (
            <span />
          )}
          {nextCursor && (
            <Button variant="outline" asChild>
              <Link href={hrefWith({ cursor: nextCursor })}>Older entries</Link>
            </Button>
          )}
        </nav>
      )}
    </div>
  );
}
