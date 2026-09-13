'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Power, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Switching a code on or off, and deleting one nobody has used.
 *
 * A used code cannot be deleted — the orders that took the discount need it
 * to explain their totals — so the delete button is only offered while it is
 * still unused. The API enforces the same rule either way.
 */

async function send(url: string, method: string, body?: unknown): Promise<void> {
  const response = await fetch(url, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });

  if (!response.ok) {
    const parsed = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(parsed?.error ?? 'That did not go through.');
  }
}

export function CouponActions({
  id,
  code,
  isActive,
  canDelete,
}: {
  id: string;
  code: string;
  isActive: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<'toggle' | 'delete' | null>(null);

  async function toggle() {
    setBusy('toggle');
    try {
      await send(`/api/admin/coupons/${id}/active`, 'PATCH', { isActive: !isActive });
      toast.success(isActive ? `${code} switched off.` : `${code} switched on.`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That did not go through.');
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete ${code}? Nobody has used it, so nothing else is affected.`)) return;

    setBusy('delete');
    try {
      await send(`/api/admin/coupons/${id}`, 'DELETE');
      toast.success(`${code} deleted.`);
      router.push('/admin/coupons');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That did not go through.');
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="outline"
        onClick={toggle}
        isLoading={busy === 'toggle'}
        loadingText="Saving"
        disabled={busy !== null}
      >
        <Power aria-hidden="true" />
        {isActive ? 'Switch off' : 'Switch on'}
      </Button>
      {canDelete && (
        <Button
          type="button"
          variant="ghost"
          onClick={remove}
          isLoading={busy === 'delete'}
          loadingText="Deleting"
          disabled={busy !== null}
        >
          <Trash2 aria-hidden="true" />
          Delete
        </Button>
      )}
    </div>
  );
}
