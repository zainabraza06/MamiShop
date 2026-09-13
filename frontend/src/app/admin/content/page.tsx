import type { Metadata } from 'next';
import Link from 'next/link';
import { FileText, Plus } from 'lucide-react';
import type { AdminContent } from '@momishop/shared/api-types';
import { AnnouncementForm, HeroForm } from '@/components/admin/content-forms';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ApiError, apiGet } from '@/lib/api';
import { relativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Content' };

export default async function AdminContentPage() {
  const content = await apiGet<AdminContent>('/admin/content').catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 403) return null;
    throw error;
  });

  if (!content) {
    return (
      <EmptyState
        icon={FileText}
        title="You cannot edit site content"
        description="Ask an admin to change the announcement, homepage or policy pages."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Content</h1>
        <p className="mt-1 text-sm text-muted-foreground">Changes go live on the next page load.</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <AnnouncementForm announcement={content.announcement} />
        <HeroForm hero={content.hero} />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle as="h2">Pages</CardTitle>
          <Button size="sm" variant="outline" asChild>
            <Link href="/admin/content/pages/new">
              <Plus aria-hidden="true" />
              New page
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {content.pages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pages yet.</p>
          ) : (
            <ul className="divide-y">
              {content.pages.map((page) => (
                <li
                  key={page.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3"
                >
                  <div>
                    <Link
                      href={`/admin/content/pages/${page.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {page.title}
                    </Link>
                    <span className="block text-xs text-muted-foreground">/pages/{page.slug}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {!page.isPublished && <Badge variant="secondary">unpublished</Badge>}
                    edited {relativeTime(page.updatedAt)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
