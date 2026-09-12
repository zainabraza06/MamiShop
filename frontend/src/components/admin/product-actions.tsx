'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Archive } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Archiving, rather than deleting.
 *
 * Orders, reviews and ledger rows all point at a product; removing the row
 * would break every past invoice that mentions it. Archiving takes it off the
 * storefront and leaves the history intact.
 */
export function ArchiveProduct({ productId, name }: { productId: string; name: string }) {
  const router = useRouter();
  const [isPending, setIsPending] = React.useState(false);

  async function handleArchive() {
    if (
      !window.confirm(
        `Archive “${name}”? It comes off the storefront straight away. Past orders keep working.`,
      )
    ) {
      return;
    }

    setIsPending(true);
    try {
      const response = await fetch(`/api/admin/products/${productId}/archive`, { method: 'POST' });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'We could not archive this product.');
      }

      toast.success('Product archived.');
      router.push('/admin/products');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'We could not archive this product.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handleArchive}
      isLoading={isPending}
      loadingText="Archiving"
    >
      <Archive aria-hidden="true" />
      Archive
    </Button>
  );
}
