import type { Metadata, Viewport } from 'next';
import { Inter, Cormorant_Garamond } from 'next/font/google';
import { Toaster } from 'sonner';
import { clientEnv } from '@/lib/env';
import { cn } from '@/lib/utils';
import './globals.css';

/**
 * Typography: a humanist sans for interface text paired with a high-contrast
 * serif for headings and prices. `display: 'swap'` renders fallback text
 * immediately rather than leaving headings invisible while the font loads,
 * which is the usual cause of a poor LCP on a font-heavy storefront.
 */
const sans = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
  preload: true,
});

const serif = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-serif',
  display: 'swap',
  preload: true,
});

const appUrl = clientEnv.NEXT_PUBLIC_APP_URL;

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: 'MomiShop — Made-to-measure modest fashion',
    // Every page supplies its own title; this frames it consistently.
    template: '%s | MomiShop',
  },
  description:
    'Stitched to your own measurements. Women’s, girls’ and boys’ clothing, abayas and stoles, cut and sewn to the numbers you give us.',
  keywords: [
    'made to measure clothing',
    'custom stitched shalwar kameez',
    'abaya Pakistan',
    'modest fashion',
    'stoles',
  ],
  authors: [{ name: 'MomiShop' }],
  openGraph: {
    type: 'website',
    locale: 'en_PK',
    url: appUrl,
    siteName: 'MomiShop',
    title: 'MomiShop — Made-to-measure modest fashion',
    description: 'Stitched to your own measurements. No standard sizes.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MomiShop — Made-to-measure modest fashion',
    description: 'Stitched to your own measurements. No standard sizes.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
  alternates: { canonical: '/' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FBF9F6' },
    { media: '(prefers-color-scheme: dark)', color: '#1C1917' },
  ],
  width: 'device-width',
  initialScale: 1,
  // Deliberately NOT capping maximum-scale: pinch-zoom is an accessibility
  // requirement (WCAG 1.4.4), and blocking it to stop iOS input zoom is the
  // wrong fix. The 16px input font-size in globals.css handles that instead.
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <body className={cn(sans.variable, serif.variable, 'font-sans')}>
        {/* First tab stop on every page. */}
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>

        {children}

        <Toaster
          position="bottom-right"
          closeButton
          richColors
          // Long enough to read a two-line message, short enough not to linger.
          duration={5000}
          toastOptions={{
            classNames: {
              toast: 'font-sans',
            },
          }}
        />
      </body>
    </html>
  );
}
