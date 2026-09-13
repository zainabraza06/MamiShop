'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ExternalLink } from 'lucide-react';
import type { AdminAnnouncement, AdminHero, AdminPage } from '@momishop/shared/api-types';
import { slugify } from '@momishop/shared/text';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormErrorSummary, FormField } from '@/components/ui/form-field';
import { Input, Textarea } from '@/components/ui/input';
import { endOfShopDay, shopDay, startOfShopDay } from '@/lib/shop-time';

/**
 * The announcement bar, the homepage hero and policy pages.
 *
 * Each form saves on its own. They change different parts of the site and
 * have nothing to do with each other, so one big Save for all of them would
 * only make it harder to tell what just went live.
 */

type Issue = { field: string; message: string };

async function send(url: string, method: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const parsed = ((await response.json().catch(() => null)) ?? {}) as Record<string, unknown>;

  if (!response.ok) {
    const issues = (parsed.issues ?? parsed.details) as Issue[] | undefined;
    const error = new Error(
      typeof parsed.error === 'string' ? parsed.error : 'That did not go through.',
    ) as Error & { issues?: Issue[] };
    if (Array.isArray(issues)) error.issues = issues;
    throw error;
  }
  return parsed;
}

function useSaver() {
  const router = useRouter();
  const [isPending, setIsPending] = React.useState(false);
  const [errors, setErrors] = React.useState<Issue[]>([]);

  async function save(action: () => Promise<unknown>, success: string): Promise<unknown> {
    setIsPending(true);
    setErrors([]);
    try {
      const result = await action();
      toast.success(success);
      router.refresh();
      return result;
    } catch (error) {
      const issues = (error as { issues?: Issue[] }).issues;
      if (issues) setErrors(issues);
      toast.error(error instanceof Error ? error.message : 'That did not go through.');
      return null;
    } finally {
      setIsPending(false);
    }
  }

  const errorFor = (field: string) => errors.find((error) => error.field === field)?.message;
  return { isPending, errors, errorFor, save, router };
}

export function AnnouncementForm({ announcement }: { announcement: AdminAnnouncement | null }) {
  const { isPending, errors, errorFor, save } = useSaver();
  const [text, setText] = React.useState(announcement?.text ?? '');
  const [isActive, setIsActive] = React.useState(announcement?.isActive ?? true);
  const [startDay, setStartDay] = React.useState(shopDay(announcement?.startsAt));
  const [endDay, setEndDay] = React.useState(shopDay(announcement?.endsAt));

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Announcement bar</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save(
              () =>
                send('/api/admin/content/announcement', 'PUT', {
                  text,
                  isActive,
                  startsAt: startOfShopDay(startDay),
                  endsAt: endOfShopDay(endDay),
                }),
              isActive ? 'Announcement saved.' : 'Announcement switched off.',
            );
          }}
        >
          <FormErrorSummary errors={errors} />

          <FormField
            label="Message"
            id="announcement-text"
            required
            hint={`The strip across the top of every page. ${160 - text.length} characters left.`}
            error={errorFor('text')}
          >
            <Input
              value={text}
              maxLength={160}
              onChange={(event) => setText(event.target.value)}
              required
            />
          </FormField>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded border-input accent-primary"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
            />
            Show it
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="From"
              id="announcement-starts"
              hint="Pakistan time. Empty shows it now."
            >
              <Input
                type="date"
                value={startDay}
                onChange={(event) => setStartDay(event.target.value)}
              />
            </FormField>
            <FormField
              label="Until"
              id="announcement-ends"
              hint="Shown to the end of this day. Empty never ends."
              error={errorFor('endsAt')}
            >
              <Input
                type="date"
                value={endDay}
                onChange={(event) => setEndDay(event.target.value)}
              />
            </FormField>
          </div>

          <Button type="submit" isLoading={isPending} loadingText="Saving">
            Save announcement
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function HeroForm({ hero }: { hero: AdminHero | null }) {
  const { isPending, errors, errorFor, save } = useSaver();
  const [headline, setHeadline] = React.useState(hero?.headline ?? '');
  const [subhead, setSubhead] = React.useState(hero?.subhead ?? '');
  const [ctaLabel, setCtaLabel] = React.useState(hero?.ctaLabel ?? 'Shop the collection');
  const [ctaHref, setCtaHref] = React.useState(hero?.ctaHref ?? '/products');
  const [imageUrl, setImageUrl] = React.useState(hero?.imageUrl ?? '');
  const [imageAlt, setImageAlt] = React.useState(hero?.imageAlt ?? '');

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Homepage hero</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save(
              () =>
                send('/api/admin/content/hero', 'PUT', {
                  headline,
                  subhead: subhead || undefined,
                  ctaLabel,
                  ctaHref,
                  imageUrl,
                  imageAlt: imageAlt || undefined,
                  isActive: true,
                }),
              'Homepage hero saved.',
            );
          }}
        >
          <FormErrorSummary errors={errors} />

          <FormField label="Headline" id="hero-headline" required error={errorFor('headline')}>
            <Input
              value={headline}
              maxLength={120}
              onChange={(event) => setHeadline(event.target.value)}
              required
            />
          </FormField>

          <FormField label="Subheading" id="hero-subhead" error={errorFor('subhead')}>
            <Textarea
              rows={3}
              maxLength={300}
              value={subhead}
              onChange={(event) => setSubhead(event.target.value)}
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Button text"
              id="hero-cta-label"
              required
              error={errorFor('ctaLabel')}
            >
              <Input
                value={ctaLabel}
                maxLength={40}
                onChange={(event) => setCtaLabel(event.target.value)}
                required
              />
            </FormField>
            <FormField
              label="Button link"
              id="hero-cta-href"
              required
              hint="A page on this site, like /products?category=abayas."
              error={errorFor('ctaHref')}
            >
              <Input
                value={ctaHref}
                onChange={(event) => setCtaHref(event.target.value)}
                required
              />
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Image"
              id="hero-image"
              hint="A path like /hero.webp or a full https:// address."
              error={errorFor('imageUrl')}
            >
              <Input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} />
            </FormField>
            <FormField
              label="Image description"
              id="hero-image-alt"
              hint="What the photo shows, for people who cannot see it."
              error={errorFor('imageAlt')}
            >
              <Input
                value={imageAlt}
                maxLength={160}
                onChange={(event) => setImageAlt(event.target.value)}
              />
            </FormField>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" isLoading={isPending} loadingText="Saving">
              Save hero
            </Button>
            <Link
              href="/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
            >
              View homepage
              <ExternalLink className="size-3.5" aria-hidden="true" />
              <span className="sr-only"> (opens in a new tab)</span>
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function PageForm({ page }: { page: AdminPage | null }) {
  const { isPending, errors, errorFor, save, router } = useSaver();
  const isNew = page === null;

  const [title, setTitle] = React.useState(page?.title ?? '');
  const [slug, setSlug] = React.useState(page?.slug ?? '');
  const [body, setBody] = React.useState(page?.body ?? '');
  const [isPublished, setIsPublished] = React.useState(page?.isPublished ?? true);
  const [metaTitle, setMetaTitle] = React.useState(page?.metaTitle ?? '');
  const [metaDescription, setMetaDescription] = React.useState(page?.metaDescription ?? '');

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const fields = {
      title,
      body,
      isPublished,
      metaTitle: metaTitle || undefined,
      metaDescription: metaDescription || undefined,
    };

    const result = (await save(
      () =>
        isNew
          ? send('/api/admin/pages', 'POST', { ...fields, slug })
          : send(`/api/admin/pages/${page.id}`, 'PATCH', fields),
      isNew ? 'Page created.' : 'Page saved.',
    )) as { page?: { id: string } } | null;

    if (isNew && result?.page) router.push(`/admin/content/pages/${result.page.id}`);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <FormErrorSummary errors={errors} />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle as="h2">Page</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField label="Title" id="page-title" required error={errorFor('title')}>
              <Input
                value={title}
                maxLength={120}
                onChange={(event) => {
                  setTitle(event.target.value);
                  // The address follows the title until the page exists; after that
                  // it is fixed, because links point at it.
                  if (isNew) setSlug(slugify(event.target.value));
                }}
                required
              />
            </FormField>

            <FormField
              label="Web address"
              id="page-slug"
              required
              hint={
                isNew ? 'Cannot be changed once the page is created.' : 'Fixed: links point here.'
              }
              error={errorFor('slug')}
            >
              <Input
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                disabled={!isNew}
                required
              />
            </FormField>

            <FormField
              label="Text"
              id="page-body"
              required
              hint="Plain text. Leave a blank line to start a new paragraph."
              error={errorFor('body')}
            >
              <Textarea
                rows={18}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                required
              />
            </FormField>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle as="h2">Publishing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 rounded border-input accent-primary"
                  checked={isPublished}
                  onChange={(event) => setIsPublished(event.target.checked)}
                />
                Published
              </label>
              <p className="text-xs text-muted-foreground">
                An unpublished page answers “not found”, even to someone with the link.
              </p>
              {!isNew && page.isPublished && (
                <Link
                  href={`/pages/${page.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
                >
                  View page
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                  <span className="sr-only"> (opens in a new tab)</span>
                </Link>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">Search engines</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                label="Title in search results"
                id="page-meta-title"
                error={errorFor('metaTitle')}
              >
                <Input
                  value={metaTitle}
                  maxLength={70}
                  onChange={(event) => setMetaTitle(event.target.value)}
                />
              </FormField>
              <FormField
                label="Description in search results"
                id="page-meta-description"
                error={errorFor('metaDescription')}
              >
                <Textarea
                  rows={3}
                  maxLength={160}
                  value={metaDescription}
                  onChange={(event) => setMetaDescription(event.target.value)}
                />
              </FormField>
            </CardContent>
          </Card>

          <Button type="submit" fullWidth size="lg" isLoading={isPending} loadingText="Saving">
            {isNew ? 'Create page' : 'Save page'}
          </Button>
        </div>
      </div>
    </form>
  );
}
