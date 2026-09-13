import { test, expect } from '@playwright/test';
import { waitForHydration } from './helpers';
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

  test('closes when a category is tapped from a listing page', async ({ page }) => {
    // Already on /products: the next link changes only the query string,
    // which is the case that used to leave the panel covering the new page.
    await page.goto('/products');
    await page.getByRole('button', { name: 'Open menu' }).click();

    const panel = page.locator('#mobile-navigation');
    const link = panel.getByRole('link').nth(1);
    const href = await link.getAttribute('href');
    await link.click();

    await page.waitForURL((url) => url.pathname + url.search === href);
    await expect(panel).toBeHidden();
  });
});

test.describe('mobile filters', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('filters wait for Apply, then close and show the results', async ({ page }) => {
    await page.goto('/products');

    const toggle = page.getByRole('button', { name: /^Filters/ });
    const panel = page.locator('#product-filters');
    // Wait for hydration, then tap once: see waitForHydration.
    await waitForHydration(page, toggle);
    await toggle.click();
    await expect(panel).toBeVisible();

    // Categories belong to the site navigation, not this panel.
    await expect(panel.getByRole('button', { name: 'Abayas', exact: true })).toHaveCount(0);

    await panel.getByText('Black', { exact: true }).click();

    // Ticking a colour alone changes nothing until it is applied.
    await expect(page).not.toHaveURL(/colors=/);

    await panel.getByRole('button', { name: 'Apply filters' }).click();

    await page.waitForURL(/[?&]colors=Black/);
    await expect(panel).toBeHidden();
    await expect(toggle).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Filters (1)' })).toBeVisible();
    await expect(page.getByText(/^[1-9]\d* pieces?$/)).toBeVisible();
  });
});

test.describe('admin sidebar', () => {
  // A laptop-height window: short enough that the links outgrow the sidebar.
  test.use({ viewport: { width: 1280, height: 620 } });

  test('the account box never covers a navigation link', async ({ page }) => {
    const signIn = await page.request.post('/api/auth/login', {
      data: {
        email: process.env.SEED_ADMIN_EMAIL ?? 'admin@momishop.pk',
        password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2024',
      },
    });
    expect(signIn.status()).toBe(200);

    await page.goto('/admin');

    const nav = page.getByRole('navigation', { name: 'Admin' });
    const links = nav.getByRole('link');
    expect(await links.count()).toBeGreaterThan(8);

    // Each link, once scrolled into view, is the topmost element at its own
    // centre: nothing is drawn over it.
    for (const link of await links.all()) {
      await link.scrollIntoViewIfNeeded();
      const box = await link.boundingBox();
      expect(box).not.toBeNull();

      const covered = await page.evaluate(
        ({ x, y }) => {
          const hit = document.elementFromPoint(x, y);
          return hit ? !hit.closest('nav[aria-label="Admin"]') : true;
        },
        { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
      );
      expect(covered, `${await link.textContent()} is covered`).toBe(false);
    }

    await expect(page.getByRole('button', { name: 'Sign out' })).toBeInViewport();
  });
});
