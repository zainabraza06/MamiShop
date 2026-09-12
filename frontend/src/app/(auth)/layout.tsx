import Link from 'next/link';

/**
 * Auth shell.
 *
 * Deliberately minimal — no site navigation. A sign-in page with a full header
 * invites the user to wander off mid-task, and the fewer things on screen the
 * clearer the single action is.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-secondary/30">
      <header className="container flex h-16 items-center">
        <Link
          href="/"
          className="font-serif text-2xl font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          MomiShop
        </Link>
      </header>

      <main id="main-content" className="container flex flex-1 items-center justify-center py-12">
        <div className="w-full max-w-md">{children}</div>
      </main>

      <footer className="container py-6 text-center text-xs text-muted-foreground">
        <Link href="/pages/privacy-policy" className="underline-offset-4 hover:underline">
          Privacy
        </Link>
        <span className="mx-2" aria-hidden="true">
          ·
        </span>
        <Link href="/pages/terms" className="underline-offset-4 hover:underline">
          Terms
        </Link>
      </footer>
    </div>
  );
}
