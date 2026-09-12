'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Download, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Asks for an export or an erasure of the customer's data.
 *
 * Neither happens on the spot: an export has to be assembled and delivered
 * somewhere safe, and an erasure has to be reconciled with the orders we are
 * required to keep for tax purposes. Both are recorded for a human, and the
 * page above lists their state.
 */
export function DataRequestControls({ hasOpenRequest }: { hasOpenRequest: boolean }) {
  const router = useRouter();
  const [pending, setPending] = React.useState<'EXPORT' | 'DELETE' | null>(null);

  async function request(kind: 'EXPORT' | 'DELETE') {
    if (kind === 'DELETE') {
      const confirmed = window.confirm(
        'Ask us to erase your account and personal details?\n\nOrders we are legally required to keep are retained, with your details removed from them. This cannot be undone.',
      );
      if (!confirmed) return;
    }

    setPending(kind);
    try {
      const response = await fetch('/api/account/data-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      });

      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? 'We could not record that request.');

      toast.success(
        kind === 'EXPORT'
          ? 'We will email you a copy of your data.'
          : 'We have recorded your erasure request.',
      );
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'We could not record that request.');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-3">
      <Button
        variant="outline"
        onClick={() => void request('EXPORT')}
        isLoading={pending === 'EXPORT'}
        disabled={hasOpenRequest && pending === null}
      >
        <Download aria-hidden="true" />
        Request a copy of my data
      </Button>

      <Button
        variant="outline"
        onClick={() => void request('DELETE')}
        isLoading={pending === 'DELETE'}
        disabled={hasOpenRequest && pending === null}
      >
        <Trash2 aria-hidden="true" />
        Request erasure
      </Button>
    </div>
  );
}
