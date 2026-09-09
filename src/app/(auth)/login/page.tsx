import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { LoginForm } from '@/components/auth/login-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to your MomiShop account.',
  robots: { index: false, follow: true },
};

export default function LoginPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1" className="text-2xl">
          Welcome back
        </CardTitle>
        <CardDescription>
          Sign in to track your orders and reuse your saved measurements.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {/* useSearchParams needs a Suspense boundary to keep the page streamable. */}
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          New here?{' '}
          <Link href="/register" className="font-medium text-primary underline underline-offset-4">
            Create an account
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
