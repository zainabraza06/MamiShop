import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind-aware className merge used by every UI primitive. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * URL-safe slug. Collapses accents and punctuation so
 * "Noor — Embroidered Abaya (Ivory)" becomes "noor-embroidered-abaya-ivory".
 */
export function slugify(input: string): string {
  return (
    input
      .normalize('NFKD')
      // Drop the combining marks that NFKD just split off the base letters.
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 96)
  );
}

/** Appends a numeric suffix until the slug is unique within `taken`. */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  const slug = slugify(base);
  if (!taken.has(slug)) return slug;
  let n = 2;
  while (taken.has(`${slug}-${n}`)) n++;
  return `${slug}-${n}`;
}

/**
 * Strips HTML tags and control characters from free-text input.
 *
 * This is defence in depth, not the primary XSS control: React escapes by
 * default, so the real rule is "never call dangerouslySetInnerHTML on user
 * input". What this buys us is clean stored data for CSV exports, emails and
 * PDF invoices, none of which have React's escaping.
 *
 * Written as an explicit code-point filter rather than a regex character
 * range, because literal control characters in a source file are invisible in
 * diffs and get mangled by tooling.
 */
export function sanitizeText(input: string): string {
  let out = '';
  for (const ch of input.replace(/<[^>]*>/g, '')) {
    const code = ch.codePointAt(0) ?? 0;
    const isC0Control = code < 0x20 && code !== 0x09 && code !== 0x0a;
    const isDelete = code === 0x7f;
    if (isC0Control || isDelete) continue;
    out += ch;
  }
  return out.trim();
}

export function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Formats a Pakistani mobile number to E.164 (+923001234567). */
export function normalizePhonePK(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (/^03\d{9}$/.test(digits)) return `+92${digits.slice(1)}`;
  if (/^923\d{9}$/.test(digits)) return `+${digits}`;
  if (/^3\d{9}$/.test(digits)) return `+92${digits}`;
  return null;
}

/** Sequential, human-readable order number: MS-2026-000123. */
export function formatOrderNumber(sequence: number, year = new Date().getFullYear()): string {
  return `MS-${year}-${String(sequence).padStart(6, '0')}`;
}

export function formatReturnNumber(sequence: number, year = new Date().getFullYear()): string {
  return `RMA-${year}-${String(sequence).padStart(5, '0')}`;
}

/** Business-day estimate for a made-to-order garment (skips Sundays). */
export function addBusinessDays(from: Date, days: number): Date {
  const result = new Date(from);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    if (result.getDay() !== 0) added++;
  }
  return result;
}

export function formatDate(date: Date | string, locale = 'en-PK'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

export function formatDateTime(date: Date | string, locale = 'en-PK'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

/** "3 days ago" / "in 2 hours". */
export function relativeTime(date: Date | string, locale = 'en-PK'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const deltaSeconds = Math.round((d.getTime() - Date.now()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
    ['second', 1],
  ];
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, seconds] of units) {
    if (Math.abs(deltaSeconds) >= seconds || unit === 'second') {
      return rtf.format(Math.round(deltaSeconds / seconds), unit);
    }
  }
  return rtf.format(0, 'second');
}

/** Turns Prisma Date objects into JSON-safe values before crossing to a client component. */
export function serializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Drops null/undefined entries so partial Prisma updates stay clean. */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null),
  ) as Partial<T>;
}

export function absoluteUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

/**
 * Guards against open redirects: only same-origin relative paths are honoured
 * as a post-login `callbackUrl`. `//evil.com` is protocol-relative and would
 * otherwise navigate off-site, so it is rejected alongside absolute URLs.
 */
export function safeRedirectPath(candidate: string | null | undefined, fallback = '/'): string {
  if (!candidate) return fallback;
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return fallback;
  return candidate;
}

/** Stable star-rating buckets for rendering (4.3 -> 4 full, 1 half). */
export function ratingBreakdown(average: number): { full: number; half: number; empty: number } {
  const clamped = Math.max(0, Math.min(5, average));
  const full = Math.floor(clamped);
  const half = clamped - full >= 0.25 && clamped - full < 0.75 ? 1 : 0;
  const rounded = clamped - full >= 0.75 ? full + 1 : full;
  return { full: half ? full : rounded, half, empty: 5 - (half ? full : rounded) - half };
}
