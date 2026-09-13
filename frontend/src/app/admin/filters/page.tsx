import type { Metadata } from 'next';
import type { AdminStorefrontFilter } from '@momishop/shared/api-types';
import { FilterManager } from '@/components/admin/filter-manager';
import { apiGet } from '@/lib/api';

export const metadata: Metadata = { title: 'Filters' };

export default async function AdminFiltersPage() {
  const { filters } = await apiGet<{ filters: AdminStorefrontFilter[] }>('/admin/filters');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Filters</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          What shoppers can narrow the catalogue by, in the order they see it. Built-in filters take
          their choices from product details. Custom filters use the options you add here, ticked on
          each product under Shop filters.
        </p>
      </div>

      <FilterManager filters={filters} />
    </div>
  );
}
