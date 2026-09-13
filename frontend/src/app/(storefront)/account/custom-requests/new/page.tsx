import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import type { CustomRequestOptions } from '@momishop/shared/api-types';
import { CustomRequestForm } from '@/components/account/custom-request-form';
import { ApiError, apiGet } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Request a custom piece',
  robots: { index: false, follow: false },
};

export default async function NewCustomRequestPage() {
  const options = await apiGet<CustomRequestOptions>('/custom-requests/options').catch(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) {
        redirect('/login?callbackUrl=/account/custom-requests/new');
      }
      throw error;
    },
  );

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link
          href="/account/custom-requests"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Custom requests
        </Link>
        <h2 className="mt-2 font-serif text-xl font-semibold">Request a custom piece</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          We read every request and reply here, usually within a working day. If we can make it, we
          send a price and how long it takes.
        </p>
      </div>

      <CustomRequestForm options={options} />
    </div>
  );
}
