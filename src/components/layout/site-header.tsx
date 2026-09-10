'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Heart, Menu, Search, ShoppingBag, User, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { CategoryNode } from '@/server/catalogue';

/**
 * Site header.
 *
 * Sticky, because the cart and search are the two things a shopper reaches for
 * mid-scroll. The mobile panel is a plain overlay rather than a Radix dialog:
 * it needs to contain navigation links whose click should close it and
 * navigate, which fights a dialog's focus trap more than it benefits from it.
 * Escape-to-close and focus return are wired up by hand below.
 */

interface SiteHeaderProps {
  categories: CategoryNode[];
  cartCount: number;
  isSignedIn: boolean;
  announcement?: string | null;
}

export function SiteHeader({ categories, cartCount, isSignedIn, announcement }: SiteHeaderProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const menuButtonRef = React.useRef<HTMLButtonElement>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  // Any navigation closes the panel; otherwise it stays open over the new page.
  React.useEffect(() => {
    setMobileOpen(false);
    setSearchOpen(false);
  }, [pathname]);

  // Escape closes whichever overlay is open and returns focus to its trigger.
  React.useEffect(() => {
    if (!mobileOpen && !searchOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (mobileOpen) {
        setMobileOpen(false);
        menuButtonRef.current?.focus();
      }
      if (searchOpen) setSearchOpen(false);
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen, searchOpen]);

  // Stop the page scrolling behind the open mobile panel.
  React.useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  React.useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      {announcement && (
        <div className="bg-primary px-4 py-2 text-center text-xs font-medium text-primary-foreground">
          {announcement}
        </div>
      )}

      <div className="container flex h-16 items-center gap-4">
        <Button
          ref={menuButtonRef}
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-expanded={mobileOpen}
          aria-controls="mobile-navigation"
          onClick={() => setMobileOpen((open) => !open)}
        >
          {mobileOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          <span className="sr-only">{mobileOpen ? 'Close menu' : 'Open menu'}</span>
        </Button>

        <Link
          href="/"
          className="font-serif text-2xl font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          MomiShop
        </Link>

        <nav aria-label="Main" className="hidden lg:ml-6 lg:flex lg:items-center lg:gap-1">
          {categories.map((category) => (
            <CategoryMenu key={category.id} category={category} pathname={pathname} />
          ))}
          <Link
            href="/products?sort=newest"
            className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            New in
          </Link>
        </nav>

        <div className="ms-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-expanded={searchOpen}
            aria-controls="header-search"
            onClick={() => setSearchOpen((open) => !open)}
          >
            <Search aria-hidden="true" />
            <span className="sr-only">Search</span>
          </Button>

          <Button variant="ghost" size="icon" asChild className="hidden sm:inline-flex">
            <Link href="/account/wishlist">
              <Heart aria-hidden="true" />
              <span className="sr-only">Wishlist</span>
            </Link>
          </Button>

          <Button variant="ghost" size="icon" asChild>
            <Link href={isSignedIn ? '/account' : '/login'}>
              <User aria-hidden="true" />
              <span className="sr-only">{isSignedIn ? 'Your account' : 'Sign in'}</span>
            </Link>
          </Button>

          <Button variant="ghost" size="icon" asChild className="relative">
            <Link href="/cart">
              <ShoppingBag aria-hidden="true" />
              {cartCount > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute -end-0.5 -top-0.5 flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground"
                >
                  {cartCount > 9 ? '9+' : cartCount}
                </span>
              )}
              {/* The count is announced in words rather than read as a stray digit. */}
              <span className="sr-only">
                {cartCount === 0
                  ? 'Shopping bag, empty'
                  : `Shopping bag, ${cartCount} item${cartCount === 1 ? '' : 's'}`}
              </span>
            </Link>
          </Button>
        </div>
      </div>

      {searchOpen && (
        <div id="header-search" className="border-t bg-background px-4 py-3">
          <form action="/products" role="search" className="container flex gap-2">
            <Input
              ref={searchInputRef}
              type="search"
              name="q"
              placeholder="Search abayas, stoles, stitched suits…"
              aria-label="Search products"
              className="flex-1"
            />
            <Button type="submit">Search</Button>
          </form>
        </div>
      )}

      {mobileOpen && (
        <div
          id="mobile-navigation"
          className="fixed inset-x-0 bottom-0 top-16 z-50 overflow-y-auto border-t bg-background lg:hidden"
        >
          <nav aria-label="Mobile" className="container py-6">
            <ul className="space-y-1">
              {categories.map((category) => (
                <li key={category.id}>
                  <Link
                    href={`/products?category=${category.slug}`}
                    className="flex min-h-11 items-center justify-between rounded-md px-3 text-base font-medium hover:bg-accent"
                  >
                    {category.name}
                    <span className="text-xs text-muted-foreground">{category.productCount}</span>
                  </Link>

                  {category.children.length > 0 && (
                    <ul className="ms-3 border-s ps-3">
                      {category.children.map((child) => (
                        <li key={child.id}>
                          <Link
                            href={`/products?category=${child.slug}`}
                            className="flex min-h-11 items-center rounded-md px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                          >
                            {child.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        </div>
      )}
    </header>
  );
}

/**
 * Desktop category item with a hover/focus dropdown.
 *
 * Opens on focus-within as well as hover, so keyboard users reach the
 * subcategories without a mouse. A category with no children is a plain link
 * rather than an empty menu.
 */
function CategoryMenu({ category, pathname }: { category: CategoryNode; pathname: string }) {
  const href = `/products?category=${category.slug}`;
  const isActive = pathname.startsWith('/products') && pathname.includes(category.slug);

  if (category.children.length === 0) {
    return (
      <Link
        href={href}
        className={cn(
          'rounded-md px-3 py-2 text-sm font-medium transition-colors hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isActive ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {category.name}
      </Link>
    );
  }

  return (
    <div className="group relative">
      <Link
        href={href}
        className={cn(
          'inline-flex rounded-md px-3 py-2 text-sm font-medium transition-colors hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isActive ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {category.name}
      </Link>

      <div className="invisible absolute start-0 top-full z-50 min-w-56 rounded-md border bg-popover p-2 opacity-0 shadow-md transition-[opacity,visibility] group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
        <ul>
          {category.children.map((child) => (
            <li key={child.id}>
              <Link
                href={`/products?category=${child.slug}`}
                className="flex min-h-10 items-center justify-between rounded-sm px-3 text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                {child.name}
                <span className="text-xs text-muted-foreground">{child.productCount}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
