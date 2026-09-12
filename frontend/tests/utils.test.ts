import { describe, expect, it } from 'vitest';
import { cn, slugify } from '@/lib/utils';

// The pure helpers are tested in shared/tests/text.test.ts, where they live.
describe('cn', () => {
  it('merges conflicting Tailwind classes, last one winning', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('a', false && 'b', 'c')).toBe('a c');
  });
});

describe('re-exports', () => {
  it('still exposes the shared text helpers through @/lib/utils', () => {
    expect(slugify('Noor Abaya')).toBe('noor-abaya');
  });
});
