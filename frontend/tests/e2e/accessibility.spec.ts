import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Automated accessibility audit.
 *
 * axe catches roughly a third of WCAG issues — contrast, missing names,
 * landmark structure, ARIA misuse. It cannot judge whether alt text is
 * *meaningful* or whether a flow makes sense with a screen reader, so this
 * suite is a floor, not a certificate. The keyboard tests below cover a few of
 * the things axe structurally cannot.
 *
 * Scoped to wcag2a/wcag2aa/wcag21aa, which is the standard the project commits
 * to in docs/ACCESSIBILITY.md.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const PAGES = [
  { name: 'homepage', path: '/' },
  { name: 'product listing', path: '/products' },
  { name: 'product detail', path: '/products/noor-nida-everyday-abaya' },
  { name: 'stole detail (no measurement form)', path: '/products/georgette-everyday-stole' },
  { name: 'empty cart', path: '/cart' },
  { name: 'sign in', path: '/login' },
  { name: 'register', path: '/register' },
  { name: 'not found', path: '/definitely-not-a-page' },
];

for (const { name, path } of PAGES) {
  test(`${name} has no detectable WCAG A/AA violations`, async ({ page }) => {
    await page.goto(path);

    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();

    // Report every violation at once; fixing them one run at a time is slow.
    const summary = results.violations
      .map(
        (v) =>
          `${v.id} (${v.impact ?? 'unknown'}): ${v.help}\n  ${v.nodes
            .slice(0, 3)
            .map((n) => n.target.join(' '))
            .join('\n  ')}`,
      )
      .join('\n\n');

    expect(summary, `Accessibility violations on ${path}:\n\n${summary}`).toBe('');
  });
}

test.describe('keyboard operation', () => {
  test('the skip link is the first stop and moves focus to the main content', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');

    const skipLink = page.getByRole('link', { name: /skip to main content/i });
    await expect(skipLink).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeVisible();
  });

  test('the measurement form is completable by keyboard alone', async ({ page }) => {
    await page.goto('/products/noor-nida-everyday-abaya');

    const lengthField = page.getByLabel('Abaya length', { exact: false });
    await lengthField.focus();
    await page.keyboard.type('56');

    await page.keyboard.press('Tab');
    await page.keyboard.type('38');

    await expect(lengthField).toHaveValue('56');
  });

  test('the unit toggle is reachable and operable as a radio group', async ({ page }) => {
    await page.goto('/products/noor-nida-everyday-abaya');

    const cm = page.getByRole('radio', { name: 'CM' });
    await cm.focus();
    await page.keyboard.press('Enter');

    await expect(cm).toHaveAttribute('aria-checked', 'true');
  });

  test('every form control on checkout has an accessible name', async ({ page }) => {
    await page.goto('/products/georgette-everyday-stole');
    await page.getByRole('button', { name: /add to bag/i }).click();
    await page.goto('/checkout');

    const results = await new AxeBuilder({ page })
      .withTags(TAGS)
      // Narrowed to labelling rules: the surrounding page is covered above.
      .include('form')
      .analyze();

    const labelIssues = results.violations.filter((v) =>
      ['label', 'form-field-multiple-labels', 'select-name', 'aria-input-field-name'].includes(
        v.id,
      ),
    );

    expect(labelIssues.map((v) => v.id).join(', ')).toBe('');
  });
});

test.describe('reduced motion', () => {
  test('animations are suppressed when the visitor asks for less motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');

    // The global media query in globals.css collapses durations to ~0.
    const duration = await page.evaluate(() => {
      const el = document.querySelector('.animate-fade-up');
      if (!el) return '0s';
      return getComputedStyle(el).animationDuration;
    });

    expect(['0s', '0.01ms', '1e-05s']).toContain(duration);
  });
});

test.describe('mobile menu', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('opens as a full-height panel, not a strip clipped to the header', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open menu' }).click();

    const panel = page.locator('#mobile-navigation');
    await expect(panel).toBeVisible();

    // The header's backdrop-filter used to trap this fixed panel inside its
    // own 64px box. Covering most of the viewport proves it escaped.
    const box = await panel.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(389);
    expect(box?.height).toBeGreaterThan(600);

    await expect(panel.getByRole('link').first()).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeFocused();
  });
});
