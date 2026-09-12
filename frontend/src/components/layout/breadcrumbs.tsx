import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { absoluteUrl } from '@/lib/utils';

export interface Crumb {
  label: string;
  /** Omitted on the final item, which is the current page. */
  href?: string;
}

/**
 * Breadcrumb trail.
 *
 * Emits BreadcrumbList structured data alongside the visible markup, which is
 * what lets Google show the category path instead of a raw URL in results.
 * The current page is marked `aria-current="page"` and is deliberately not a
 * link — a link to where you already are is noise for screen-reader users.
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.label,
      ...(item.href ? { item: absoluteUrl(item.href) } : {}),
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
          {items.map((item, index) => {
            const isLast = index === items.length - 1;
            return (
              <li key={`${item.label}-${index}`} className="flex items-center gap-1">
                {item.href && !isLast ? (
                  <Link
                    href={item.href}
                    className="rounded underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span aria-current="page" className="font-medium text-foreground">
                    {item.label}
                  </span>
                )}
                {!isLast && <ChevronRight className="size-3.5" aria-hidden="true" />}
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}
