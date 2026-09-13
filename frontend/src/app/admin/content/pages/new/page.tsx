import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { PageForm } from '@/components/admin/content-forms';

export const metadata: Metadata = { title: 'New page' };

export default function NewContentPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/content"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Content
        </Link>
        <h1 className="mt-2 font-serif text-2xl font-semibold">New page</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          It lives at /pages/its-address. Link to it from anywhere once it is published.
        </p>
      </div>

      <PageForm page={null} />
    </div>
  );
}
