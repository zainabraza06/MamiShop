import Link from 'next/link';
import { NewsletterForm } from '@/components/marketing/newsletter-form';
import type { CategoryNode } from '@/server/catalogue';

/**
 * Site footer.
 *
 * Carries the legal links every e-commerce store is expected to expose, all of
 * which are CMS-editable pages rather than hardcoded copy — a returns policy
 * that needs a redeploy to change never gets changed.
 */
export function SiteFooter({ categories }: { categories: CategoryNode[] }) {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-20 border-t bg-secondary/40">
      <div className="container py-12">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="font-serif text-xl font-semibold">MomiShop</p>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">
              Modest clothing stitched to your own measurements. No standard sizes, no
              guesswork — just the numbers you give us.
            </p>
          </div>

          <nav aria-labelledby="footer-shop">
            <h2 id="footer-shop" className="text-sm font-semibold">
              Shop
            </h2>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              {categories.slice(0, 5).map((category) => (
                <li key={category.id}>
                  <Link
                    href={`/products?category=${category.slug}`}
                    className="hover:text-foreground hover:underline underline-offset-4"
                  >
                    {category.name}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/products" className="hover:text-foreground hover:underline underline-offset-4">
                  All products
                </Link>
              </li>
            </ul>
          </nav>

          <nav aria-labelledby="footer-help">
            <h2 id="footer-help" className="text-sm font-semibold">
              Help
            </h2>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li>
                <Link href="/measuring-guide" className="hover:text-foreground hover:underline underline-offset-4">
                  How to measure
                </Link>
              </li>
              <li>
                <Link href="/track-order" className="hover:text-foreground hover:underline underline-offset-4">
                  Track your order
                </Link>
              </li>
              <li>
                <Link href="/pages/returns-policy" className="hover:text-foreground hover:underline underline-offset-4">
                  Returns &amp; exchanges
                </Link>
              </li>
              <li>
                <Link href="/pages/shipping" className="hover:text-foreground hover:underline underline-offset-4">
                  Delivery
                </Link>
              </li>
              <li>
                <Link href="/contact" className="hover:text-foreground hover:underline underline-offset-4">
                  Contact us
                </Link>
              </li>
            </ul>
          </nav>

          <div>
            <h2 className="text-sm font-semibold">Stay in touch</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              New arrivals and occasional offers. No more than twice a month.
            </p>
            <NewsletterForm source="FOOTER" className="mt-4" />
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-4 border-t pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; {year} MomiShop. All rights reserved.</p>
          <nav aria-label="Legal">
            <ul className="flex flex-wrap gap-x-5 gap-y-2">
              <li>
                <Link href="/pages/privacy-policy" className="hover:text-foreground hover:underline underline-offset-4">
                  Privacy
                </Link>
              </li>
              <li>
                <Link href="/pages/terms" className="hover:text-foreground hover:underline underline-offset-4">
                  Terms
                </Link>
              </li>
              <li>
                <Link href="/pages/returns-policy" className="hover:text-foreground hover:underline underline-offset-4">
                  Returns
                </Link>
              </li>
              <li>
                <Link href="/account/privacy" className="hover:text-foreground hover:underline underline-offset-4">
                  Your data
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      </div>
    </footer>
  );
}
