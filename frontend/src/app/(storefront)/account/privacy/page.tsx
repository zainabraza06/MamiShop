import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { DataRequest } from '@momishop/shared/api-types';
import { Badge } from '@/components/ui/badge';
import { DataRequestControls } from '@/components/account/data-request-controls';
import { ApiError, apiGet } from '@/lib/api';
import { formatDate } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Your data',
  robots: { index: false, follow: false },
};

/** What we hold, said plainly rather than as a link to a policy. */
const HELD = [
  {
    title: 'Your account',
    body: 'Name, email address and phone number, so we can reach you about an order.',
  },
  {
    title: 'Your measurements',
    body: 'The profiles you save, and a frozen copy on each order line — that copy is what the workshop cuts to, and it cannot be changed after the fact.',
  },
  {
    title: 'Your orders',
    body: 'What you bought, where it was delivered and what it cost. Kept for the period tax rules require, even after an erasure request.',
  },
  {
    title: 'Security records',
    body: 'Sign-in attempts, with your IP address stored only as a hash — enough to spot an attack, not enough to track you.',
  },
];

const STATUS_LABEL: Record<DataRequest['status'], string> = {
  PENDING: 'Received',
  PROCESSING: 'In progress',
  COMPLETED: 'Completed',
  REJECTED: 'Declined',
};

export default async function AccountPrivacyPage() {
  let requests: DataRequest[];
  try {
    ({ requests } = await apiGet<{ requests: DataRequest[] }>('/account/data-requests'));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      redirect('/login?callbackUrl=/account/privacy');
    }
    throw error;
  }

  const open = requests.some((r) => r.status === 'PENDING' || r.status === 'PROCESSING');

  return (
    <div className="space-y-8">
      <section aria-labelledby="what-we-hold">
        <h2 id="what-we-hold" className="font-serif text-lg font-semibold">
          What we hold about you
        </h2>
        <dl className="mt-4 divide-y rounded-lg border">
          {HELD.map((item) => (
            <div key={item.title} className="p-4">
              <dt className="font-medium">{item.title}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.body}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-sm text-muted-foreground">
          The full detail is in our{' '}
          <Link href="/pages/privacy-policy" className="underline underline-offset-4">
            privacy policy
          </Link>
          .
        </p>
      </section>

      <section aria-labelledby="your-rights">
        <h2 id="your-rights" className="font-serif text-lg font-semibold">
          Export or erase
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Ask for a copy of everything we hold, or for your account and personal details to be
          erased. We handle each by hand and email you when it is done.
        </p>

        <div className="mt-4">
          <DataRequestControls hasOpenRequest={open} />
          {open && (
            <p className="mt-2 text-xs text-muted-foreground">
              You already have a request in progress. We will email you when it is complete.
            </p>
          )}
        </div>
      </section>

      {requests.length > 0 && (
        <section aria-labelledby="request-history">
          <h2 id="request-history" className="font-serif text-lg font-semibold">
            Your requests
          </h2>
          <ul className="mt-4 divide-y rounded-lg border">
            {requests.map((request) => (
              <li key={request.id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {request.kind === 'EXPORT' ? 'Copy of my data' : 'Erasure'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Asked {formatDate(request.createdAt)}
                    {request.completedAt ? ` · done ${formatDate(request.completedAt)}` : ''}
                  </p>
                </div>
                <Badge variant={request.status === 'COMPLETED' ? 'success' : 'secondary'}>
                  {STATUS_LABEL[request.status]}
                </Badge>
                {request.downloadUrl && request.status === 'COMPLETED' && (
                  <a
                    href={request.downloadUrl}
                    className="text-sm underline underline-offset-4"
                    rel="noreferrer"
                  >
                    Download
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
