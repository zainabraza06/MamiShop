import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import type { AdminPage } from '@momishop/shared/api-types';
import { PageForm } from '@/components/admin/content-forms';
import { ApiError, apiGet } from '@/lib/api';

export const metadata: Metadata = { title: 'Edit page' };

export default async function EditContentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const detail = await apiGet<{ page: AdminPage }>(`/admin/pages/${id}`).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  });
  if (!detail) notFound();

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
        <h1 className="mt-2 font-serif text-2xl font-semibold">{detail.page.title}</h1>
      </div>

      <PageForm key={detail.page.updatedAt} page={detail.page} />
    </div>
  );
}
