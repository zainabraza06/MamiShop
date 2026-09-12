import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Package, Plus } from 'lucide-react';
import type { AdminProductList, ProductStatus } from '@momishop/shared/api-types';
import { formatMoney, type Currency } from '@momishop/shared/money';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { apiGet } from '@/lib/api';
import { relativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Products' };

const TABS: { label: string; status?: ProductStatus }[] = [
  { label: 'All' },
  { label: 'Live', status: 'ACTIVE' },
  { label: 'Drafts', status: 'DRAFT' },
  { label: 'Archived', status: 'ARCHIVED' },
];

const STATUS_BADGE: Record<ProductStatus, 'default' | 'secondary' | 'destructive'> = {
  ACTIVE: 'default',
  DRAFT: 'secondary',
  ARCHIVED: 'destructive',
};

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const status = typeof params.status === 'string' ? params.status : undefined;
  const q = typeof params.q === 'string' ? params.q : undefined;

  const query = new URLSearchParams();
  if (status) query.set('status', status);
  if (q) query.set('q', q);

  const { items, total, countsByStatus } = await apiGet<AdminProductList>(
    `/admin/products?${query.toString()}`,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Products</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total} piece{total === 1 ? '' : 's'} in the catalogue
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <form className="flex gap-2" action="/admin/products">
            <Input
              name="q"
              defaultValue={q ?? ''}
              placeholder="Name or SKU"
              aria-label="Search products"
              className="w-48"
            />
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>

          <Button asChild>
            <Link href="/admin/products/new">
              <Plus aria-hidden="true" />
              New product
            </Link>
          </Button>
        </div>
      </div>

      <nav aria-label="Filter by status">
        <ul className="flex flex-wrap gap-2">
          {TABS.map((tab) => {
            const active = tab.status === status || (!tab.status && !status);
            const count = tab.status ? (countsByStatus[tab.status] ?? 0) : total;

            return (
              <li key={tab.label}>
                <Button variant={active ? 'default' : 'outline'} size="sm" asChild>
                  <Link
                    href={tab.status ? `/admin/products?status=${tab.status}` : '/admin/products'}
                    aria-current={active ? 'page' : undefined}
                  >
                    {tab.label}
                    <span className="ms-1.5 tabular-nums opacity-70">{count}</span>
                  </Link>
                </Button>
              </li>
            );
          })}
        </ul>
      </nav>

      {items.length === 0 ? (
        <EmptyState
          icon={Package}
          title="Nothing here"
          description={q || status ? 'No products match that filter.' : 'Add your first piece.'}
          action={
            <Button asChild>
              <Link href="/admin/products/new">New product</Link>
            </Button>
          }
        />
      ) : (
        <div className="scroll-x rounded-lg border">
          <table className="w-full text-sm">
            <caption className="sr-only">Products, most recently updated first</caption>
            <thead>
              <tr className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="p-3 text-start font-medium">
                  Product
                </th>
                <th scope="col" className="p-3 text-start font-medium">
                  Status
                </th>
                <th scope="col" className="p-3 text-end font-medium">
                  Price
                </th>
                <th scope="col" className="p-3 text-end font-medium">
                  Stock
                </th>
                <th scope="col" className="p-3 text-end font-medium">
                  Updated
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((product) => (
                <tr key={product.id} className="hover:bg-accent/30">
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      {product.image ? (
                        <Image
                          src={product.image.url}
                          alt=""
                          width={40}
                          height={50}
                          className="rounded object-cover"
                        />
                      ) : (
                        <div className="size-10 rounded bg-muted" aria-hidden="true" />
                      )}
                      <div className="min-w-0">
                        <Link
                          href={`/admin/products/${product.id}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {product.name}
                        </Link>
                        <span className="block truncate text-xs text-muted-foreground">
                          {product.sku} · {product.category.name}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="p-3">
                    <Badge variant={STATUS_BADGE[product.status]}>
                      {product.status.toLowerCase()}
                    </Badge>
                    {product.isFeatured && (
                      <Badge variant="secondary" className="ms-1">
                        featured
                      </Badge>
                    )}
                  </td>
                  <td className="p-3 text-end tabular-nums">
                    {formatMoney(product.basePrice, product.currency as Currency)}
                  </td>
                  <td className="p-3 text-end tabular-nums">
                    <span className={product.lowStock ? 'font-medium text-warning' : undefined}>
                      {product.stockOnHand}
                    </span>
                    {product.lowStock && <span className="sr-only"> — running low</span>}
                  </td>
                  <td className="p-3 text-end text-xs text-muted-foreground">
                    {relativeTime(product.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
