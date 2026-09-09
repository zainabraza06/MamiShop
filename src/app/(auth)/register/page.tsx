import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { RegisterForm } from '@/components/auth/register-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Create an account',
  description: 'Create a MomiShop account to save your measurements and track orders.',
  robots: { index: false, follow: true },
};

export default function RegisterPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1" className="text-2xl">
          Create your account
        </CardTitle>
        <CardDescription>
          Save your measurements once and reuse them on every order.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <Suspense fallback={null}>
          <RegisterForm />
        </Suspense>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-primary underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
