import type { Metadata } from 'next';
import Link from 'next/link';
import { Clock, Mail, Phone } from 'lucide-react';
import { ContactForm } from '@/components/marketing/contact-form';

export const metadata: Metadata = {
  title: 'Contact us',
  description:
    'Questions about measurements, an order or a return? Send us a message and we will reply within one working day.',
  alternates: { canonical: '/contact' },
};

const DETAILS = [
  { icon: Mail, label: 'Email', value: 'hello@momishop.pk' },
  { icon: Phone, label: 'Phone and WhatsApp', value: '+92 300 1234567' },
  { icon: Clock, label: 'Hours', value: 'Monday to Saturday, 10am – 7pm PKT' },
];

export default function ContactPage() {
  return (
    <div className="container max-w-2xl py-12">
      <h1 className="text-display font-semibold">Contact us</h1>
      <p className="mt-3 text-muted-foreground">
        Unsure about a measurement, or something wrong with an order? Tell us and we will sort it
        out. If the fit is wrong on a piece we made, see{' '}
        <Link href="/pages/returns-policy" className="underline underline-offset-4">
          returns and exchanges
        </Link>{' '}
        first — we alter or remake rather than refuse.
      </p>

      <ul className="mt-8 grid gap-4 rounded-lg border p-6 sm:grid-cols-3">
        {DETAILS.map(({ icon: Icon, label, value }) => (
          <li key={label}>
            <Icon className="size-4 text-primary" aria-hidden="true" />
            <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="text-sm">{value}</p>
          </li>
        ))}
      </ul>

      <ContactForm />
    </div>
  );
}
