import Link from 'next/link';
import { SignOutButton } from '@/components/account/sign-out-button';

/**
 * The customer's account area.
 *
 * The proxy already redirects an anonymous visitor to sign in, and each page
 * below calls an API endpoint that checks the live user row — so an expired or
 * revoked session is caught here too, not just at the edge.
 */
export const dynamic = 'force-dynamic';

const NAV = [
  { href: '/account', label: 'Overview' },
  { href: '/account/wishlist', label: 'Saved pieces' },
  { href: '/account/custom-requests', label: 'Custom requests' },
  { href: '/account/privacy', label: 'Your data' },
];

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="container py-10">
      <h1 className="text-display font-semibold">Your account</h1>

      <div className="mt-8 grid gap-8 lg:grid-cols-[200px_1fr]">
        <nav aria-label="Account">
          <ul className="flex gap-2 lg:flex-col">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {item.label}
                </Link>
              </li>
            ))}
            <li className="lg:mt-2 lg:border-t lg:pt-2">
              <SignOutButton className="w-full" />
            </li>
          </ul>
        </nav>

        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
