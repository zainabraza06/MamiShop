import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { CmsPage } from '@momishop/shared/api-types';
import { apiGetOrNull } from '@/lib/api';
import { formatDate } from '@/lib/utils';

/**
 * Editorial pages: privacy policy, terms, returns, delivery.
 *
 * The body is stored as plain text and rendered as text — paragraphs split on
 * blank lines. Storing HTML here would put `dangerouslySetInnerHTML` on a value
 * an admin can edit, which is a stored-XSS hole for the sake of formatting
 * nobody has asked for.
 */

function getPage(slug: string) {
  return apiGetOrNull<{ page: CmsPage }>(`/pages/${encodeURIComponent(slug)}`);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const result = await getPage(slug);

  if (!result) notFound();
  const { page } = result;

  return {
    title: page.metaTitle ?? page.title,
    description: page.metaDescription ?? undefined,
    alternates: { canonical: `/pages/${page.slug}` },
  };
}

export default async function ContentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await getPage(slug);

  if (!result) notFound();
  const { page } = result;

  const paragraphs = page.body.split(/\n\s*\n/).filter((p) => p.trim().length > 0);

  return (
    <article className="container max-w-2xl py-12">
      <h1 className="text-display font-semibold">{page.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Last updated {formatDate(page.updatedAt)}
      </p>

      <div className="mt-8 space-y-4">
        {paragraphs.map((paragraph) => (
          <p key={paragraph.slice(0, 40)} className="leading-relaxed text-muted-foreground">
            {paragraph}
          </p>
        ))}
      </div>
    </article>
  );
}
