import type { Metadata } from 'next';
import Link from 'next/link';
import { Ruler, Shirt, Info } from 'lucide-react';
import { MEASUREMENT_TEMPLATES, TEMPLATES } from '@momishop/shared/measurements';
import { Button } from '@/components/ui/button';

/**
 * How to measure.
 *
 * Built from the same templates the order form validates against, so the
 * guidance and the accepted ranges can never drift apart: add a field to a
 * template and it documents itself here.
 */
export const metadata: Metadata = {
  title: 'How to measure',
  description:
    'How to take each measurement we ask for, what it means, and the range we expect — so your garment is cut to numbers that fit.',
  alternates: { canonical: '/measuring-guide' },
};

const PRINCIPLES = [
  {
    icon: Ruler,
    title: 'Use a soft tape',
    body: 'A tailor’s tape, not a steel one. Keep it snug against the body but never tight enough to press in.',
  },
  {
    icon: Shirt,
    title: 'Measure over light clothing',
    body: 'Or over the underwear you would normally wear with the piece. Thick layers add inches that will not be there later.',
  },
  {
    icon: Info,
    title: 'Ask someone to help',
    body: 'Back and shoulder measurements are the ones people get wrong alone. Stand relaxed and look straight ahead.',
  },
];

export default function MeasuringGuidePage() {
  // Stoles need no measurements, so their template has no fields to document.
  const templates = MEASUREMENT_TEMPLATES.map((key) => TEMPLATES[key]).filter((template) =>
    template.groups.some((group) => group.fields.length > 0),
  );

  return (
    <div className="container max-w-3xl py-12">
      <h1 className="text-display font-semibold">How to measure</h1>
      <p className="mt-3 max-w-prose text-muted-foreground">
        Every piece is cut to the numbers you give us, so five careful minutes here decide how the
        finished garment fits. Measure once, save the profile to your account, and reuse it on every
        order.
      </p>

      <ul className="mt-8 grid gap-6 border-y py-8 sm:grid-cols-3">
        {PRINCIPLES.map(({ icon: Icon, title, body }) => (
          <li key={title} className="flex gap-3">
            <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold">{title}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          </li>
        ))}
      </ul>

      {templates.map((template) => (
        <section key={template.key} aria-labelledby={`t-${template.key}`} className="mt-12">
          <h2 id={`t-${template.key}`} className="font-serif text-xl font-semibold">
            {template.label}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{template.description}</p>

          {template.groups.map((group) => (
            <div key={group.title} className="mt-6">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {group.title}
              </h3>

              <dl className="mt-3 divide-y rounded-lg border">
                {group.fields.map((field) => (
                  <div key={field.key} className="p-4">
                    <dt className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">{field.label}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {field.minInch}–{field.maxInch} in
                        {field.required ? '' : ' · optional'}
                      </span>
                    </dt>
                    <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {field.help}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </section>
      ))}

      <div className="mt-12 rounded-lg border bg-secondary/40 p-6">
        <h2 className="font-serif text-lg font-semibold">Still unsure?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Send us the numbers you have and we will check them before cutting. We would rather ask
          than guess.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/products">Start shopping</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/contact">Ask us</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
