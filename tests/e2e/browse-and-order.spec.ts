import { test, expect, type Page } from '@playwright/test';

/**
 * The critical path: browse → customise size → checkout → confirmation.
 *
 * This is the flow that, if broken, means the business takes no money. It runs
 * against a real build and a seeded database, so it exercises the same code a
 * customer would hit rather than mocks.
 *
 * Selectors prefer accessible roles and names over CSS classes. A test that
 * breaks when a class is renamed is noise; a test that breaks when a button
 * loses its accessible name has found a real accessibility regression.
 */

/** Fills the abaya measurement form with a plausible set of numbers. */
async function fillAbayaMeasurements(page: Page) {
  await page.getByLabel('Abaya length', { exact: false }).fill('56');
  await page.getByLabel('Bust', { exact: false }).fill('38');
  await page.getByLabel('Shoulder', { exact: false }).fill('15');
  await page.getByLabel('Sleeve length', { exact: false }).fill('23');
}

test.describe('storefront browsing', () => {
  test('the homepage loads and links into the catalogue', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /shop the collection/i })).toBeVisible();

    await page.getByRole('link', { name: /shop the collection/i }).click();
    await expect(page).toHaveURL(/\/products/);
    await expect(page.getByRole('heading', { name: /all products/i })).toBeVisible();
  });

  test('products can be filtered by category through the URL', async ({ page }) => {
    await page.goto('/products?category=abayas');

    await expect(page.getByRole('heading', { name: 'Abayas', exact: true })).toBeVisible();
    // The count is announced politely, so it is readable rather than decorative.
    await expect(page.getByText(/\d+ piece/)).toBeVisible();
  });

  test('an unknown product returns a 404 page', async ({ page }) => {
    const response = await page.goto('/products/this-product-does-not-exist');
    expect(response?.status()).toBe(404);
  });

  test('search results are excluded from indexing', async ({ page }) => {
    await page.goto('/products?q=abaya');
    const robots = page.locator('meta[name="robots"]');
    await expect(robots).toHaveAttribute('content', /noindex/);
  });
});

test.describe('measurement capture', () => {
  test('an implausible measurement is rejected before adding to the bag', async ({ page }) => {
    await page.goto('/products/noor-nida-everyday-abaya');

    // 560 inches is the classic extra-zero typo the range check exists for.
    await page.getByLabel('Abaya length', { exact: false }).fill('560');
    await page.getByLabel('Bust', { exact: false }).fill('38');
    // Blur, since validation deliberately waits until the field is left.
    await page.getByLabel('Bust', { exact: false }).blur();

    await expect(page.getByText(/should be between 40in and 70in/i)).toBeVisible();
  });

  test('the unit toggle converts entered values rather than relabelling them', async ({ page }) => {
    await page.goto('/products/noor-nida-everyday-abaya');

    const lengthField = page.getByLabel('Abaya length', { exact: false });
    await lengthField.fill('56');

    await page.getByRole('radio', { name: 'CM' }).click();

    // 56in is 142.2cm. If the toggle only relabelled, this would still read 56
    // and the customer would order a garment less than half the right length.
    await expect(lengthField).toHaveValue('142.2');

    await page.getByRole('radio', { name: 'Inches' }).click();
    await expect(lengthField).toHaveValue('56');
  });

  test('a stole needs no measurements at all', async ({ page }) => {
    await page.goto('/products/georgette-everyday-stole');

    await expect(page.getByRole('heading', { name: /georgette everyday stole/i })).toBeVisible();
    // Substring text matching also hits "Stitched to your measurements" in the
    // card copy, so assert on the section heading specifically.
    await expect(page.getByRole('heading', { name: 'Your measurements' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /add to bag/i })).toBeEnabled();
  });
});

test.describe('checkout', () => {
  test('a guest can browse, customise, and place a cash-on-delivery order', async ({ page }) => {
    // 1. Browse to a made-to-measure product.
    await page.goto('/products?category=abayas');
    await page
      .getByRole('link', { name: /noor nida everyday abaya/i })
      .first()
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/noor nida/i);

    // 2. Give measurements and add to the bag.
    await fillAbayaMeasurements(page);
    await page.getByRole('button', { name: /add to bag/i }).click();
    await expect(page.getByText(/added to your bag/i)).toBeVisible();

    // 3. The bag shows what will actually be cut.
    await page.goto('/cart');
    await expect(page.getByRole('heading', { name: /your bag/i })).toBeVisible();
    await expect(page.getByText(/Abaya length 56in/)).toBeVisible();

    // 4. Checkout.
    await page.getByRole('link', { name: /continue to checkout/i }).click();
    await expect(page).toHaveURL(/\/checkout/);

    /*
     * getByRole('textbox') rather than getByLabel.
     *
     * getByLabel also honours aria-labelledby, so getByLabel('Address') matched
     * the <section aria-labelledby="address-heading"> wrapper before it reached
     * the input. Restricting to the textbox role removes that ambiguity, and the
     * name regex tolerates the visually hidden "(required)" suffix.
     *
     * Scoped to <main> because the footer newsletter has its own email field.
     */
    const form = page.locator('#main-content');

    await form.getByRole('textbox', { name: /^Email/ }).fill('e2e-buyer@example.com');
    await form.getByRole('textbox', { name: /^Mobile number/ }).fill('03001234567');
    await form.getByRole('textbox', { name: /^Full name/ }).fill('E2E Buyer');
    await form.getByRole('textbox', { name: /^Address/ }).fill('45 Model Town');
    await form.getByRole('textbox', { name: /^City/ }).fill('Lahore');

    // The province combobox is a Radix Select; it has a real accessible name
    // only because it uses SelectField rather than FormField.
    await form.getByRole('combobox', { name: /^Province/ }).click();
    await page.getByRole('option', { name: 'Punjab' }).click();

    // Delivery options are quoted server-side once the address resolves.
    await expect(page.getByText(/standard/i).first()).toBeVisible({ timeout: 15_000 });
    await page
      .getByRole('radio', { name: /standard/i })
      .first()
      .check();

    await page.getByRole('radio', { name: /cash on delivery/i }).check();
    await page.getByLabel(/I confirm my measurements/i).check();

    await page.getByRole('button', { name: /place order/i }).click();

    // 5. Confirmation, with the measurements echoed back.
    await expect(page).toHaveURL(/\/order-confirmed\/MS-/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: /thank you/i })).toBeVisible();
    await expect(page.getByText(/Abaya length 56in/)).toBeVisible();
  });

  test('an empty bag redirects away from checkout', async ({ page }) => {
    await page.goto('/checkout');
    await expect(page).toHaveURL(/\/cart/);
  });

  test('the empty bag offers a way onward rather than a dead end', async ({ page }) => {
    await page.goto('/cart');
    await expect(page.getByRole('heading', { name: /your bag is empty/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /start shopping/i })).toBeVisible();
  });
});

test.describe('authorisation', () => {
  test('an anonymous visitor is sent to sign in for the admin area', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fadmin/);
  });

  test('an anonymous visitor is sent to sign in for their account', async ({ page }) => {
    await page.goto('/account');
    await expect(page).toHaveURL(/\/login/);
  });

  test('a crafted callbackUrl cannot turn login into an open redirect', async ({ page }) => {
    await page.goto('/login?callbackUrl=https://evil.example.com');
    // The page must still be our own login form, not a redirect off-site.
    await expect(page).toHaveURL(/localhost/);
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
  });
});

test.describe('operational endpoints', () => {
  test('health reports the database as a hard dependency', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);

    const body = (await response.json()) as {
      status: string;
      checks: { database: { status: string } };
    };
    expect(body.checks.database.status).toBe('ok');
  });

  test('the cron worker refuses an unauthenticated call', async ({ request }) => {
    const response = await request.post('/api/cron/jobs');
    expect(response.status()).toBe(403);
  });
});
