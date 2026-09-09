import Link from 'next/link';
import { Button } from '@/components/ui/button';

/**
 * Global 404.
 *
 * Lives at the app root so it covers every segment, including routes outside
 * the storefront group. Offers a way onward rather than a dead end — a 404
 * with no navigation is where sessions end.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <p className="font-serif text-6xl font-semibold text-muted-foreground">404</p>
      <h1 className="mt-4 text-display font-semibold">We could not find that page</h1>
      <p className="mt-2 max-w-md text-muted-foreground">
        The link may be out of date, or the piece you are looking for may no longer be available.
      </p>

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button asChild size="lg">
          <Link href="/products">Browse the collection</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/">Go home</Link>
        </Button>
      </div>
    </div>
  );
}
