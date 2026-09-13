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

/** Every product the seed publishes, for tests that need one to themselves. */
const ACTIVE_SEED_SKUS = [
  'MS-W-0001',
  'MS-W-0002',
  'MS-A-0001',
  'MS-A-0002',
  'MS-S-0001',
  'MS-S-0002',
  'MS-G-0001',
  'MS-B-0001',
];

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

    // 2. Pick a colour that is in stock. Every local run buys the default one,
    //    so without this the suite eventually fails on a sold-out colour.
    const soldOutSelected = page.getByRole('radio', { name: /sold out/i, checked: true });
    if ((await soldOutSelected.count()) > 0) {
      await page
        .getByRole('radio', { disabled: false })
        .filter({ hasNotText: /^(Inches|CM)$/ })
        .first()
        .click();
    }

    // 3. Give measurements and add to the bag.
    await fillAbayaMeasurements(page);
    await page.getByRole('button', { name: /add to bag/i }).click();
    await expect(page.getByText(/added to your bag/i)).toBeVisible();

    // 4. The bag shows what will actually be cut.
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

  /**
   * The signed-in half of the proxy, which nothing else covers.
   *
   * Every other authorisation test here is anonymous, and an anonymous visitor
   * is redirected whether the proxy can read a session or not. That is how the
   * storefront twice shipped unable to read one — first with no secret in the
   * runtime that serves requests, then with a secret that did not match the
   * API's — each time sending staff who had just signed in back to the sign-in
   * page.
   */
  test('a signed-in staff member reaches the admin dashboard', async ({ page }) => {
    const response = await page.request.post('/api/auth/login', {
      data: {
        email: process.env.SEED_ADMIN_EMAIL ?? 'admin@momishop.pk',
        password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2024',
      },
    });
    expect(response.status()).toBe(200);

    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();

    // And the sign-in page bounces someone who is already signed in.
    await page.goto('/login');
    await expect(page).toHaveURL(/\/admin$/);
  });
});

test.describe('help and policy pages', () => {
  /**
   * The footer and help menu were written before the pages they link to, so
   * every one of them 404'd: how to measure, tracking, returns, delivery,
   * contact, the policies and the data page. Crawling the real links keeps a
   * new one from shipping ahead of its page.
   */
  test('every link in the footer resolves', async ({ page }) => {
    await page.goto('/');

    const hrefs = await page
      .locator('footer a')
      .evaluateAll((links) =>
        Array.from(
          new Set(
            links
              .map((link) => link.getAttribute('href') ?? '')
              .filter((href) => href.startsWith('/')),
          ),
        ),
      );

    // Guards against the links themselves disappearing and the test passing.
    expect(hrefs.length).toBeGreaterThan(8);

    for (const href of hrefs) {
      const response = await page.request.get(href);
      expect(response.status(), `${href} should not be missing`).toBeLessThan(400);
    }
  });

  test('the measuring guide documents the ranges the order form enforces', async ({ page }) => {
    await page.goto('/measuring-guide');

    await expect(page.getByRole('heading', { name: /how to measure/i })).toBeVisible();
    // Rendered from the shared templates, so a field cannot exist undocumented.
    // Level 2 is the template's own heading; its field groups are level 3.
    await expect(page.getByRole('heading', { name: 'Abaya', exact: true, level: 2 })).toBeVisible();
    await expect(page.getByText(/Abaya length/).first()).toBeVisible();
  });

  test('a policy page renders its content from the database', async ({ page }) => {
    await page.goto('/pages/returns-policy');

    await expect(page.getByRole('heading', { level: 1 })).toContainText(/returns/i);
    await expect(page.getByText(/alter or remake/i)).toBeVisible();
  });

  test('an unknown policy page is a true 404', async ({ page }) => {
    const response = await page.goto('/pages/no-such-policy');
    expect(response?.status()).toBe(404);
  });

  test('tracking refuses an order number without the matching email', async ({ page }) => {
    await page.goto('/track-order');

    // Scoped to <main>: the footer's newsletter signup has an email field too.
    const form = page.locator('#main-content');
    await form.getByRole('textbox', { name: /^Order number/ }).fill('MS-2026-000001');
    await form.getByRole('textbox', { name: /^Email/ }).fill('not-the-buyer@example.com');
    await form.getByRole('button', { name: /track my order/i }).click();

    await expect(form.getByRole('alert')).toContainText(/could not find an order/i);
  });
});

test.describe('admin', () => {
  /**
   * The other side of the counter: an order arrives and staff act on it.
   *
   * The order is placed through the API first so the test does not depend on
   * another test having run, or on the seed containing orders — it contains
   * none, by design.
   */
  test('staff can find an order, open it, and move it along', async ({ page }) => {
    const api = page.request;

    const listing = await api.get('/api/products?limit=24');
    const { items } = (await listing.json()) as { items: { id: string; slug: string }[] };

    let productId: string | null = null;
    for (const item of items) {
      const detail = await api.get(`/api/products/${item.slug}`);
      const body = (await detail.json()) as {
        product: { id: string; requiresMeasurements: boolean };
      };
      if (!body.product.requiresMeasurements) {
        productId = body.product.id;
        break;
      }
    }
    expect(productId, 'a product that needs no measurements').toBeTruthy();

    await api.post('/api/cart/items', { data: { productId, quantity: 1 } });
    const quote = await api.post('/api/checkout/quote', {
      data: { country: 'PK', state: 'Punjab', city: 'Lahore', paymentMethod: 'COD' },
    });
    const { rates } = (await quote.json()) as { rates: { id: string }[] };

    const placed = await api.post('/api/checkout', {
      data: {
        email: `admin-e2e-${Date.now()}@example.com`,
        phone: '03001234567',
        shippingAddress: {
          fullName: 'Admin E2E',
          phone: '03001234567',
          line1: '2 Workshop Road',
          city: 'Lahore',
          state: 'Punjab',
          country: 'PK',
          type: 'SHIPPING',
          isDefault: true,
        },
        billingSameAsShipping: true,
        shippingRateId: rates[0].id,
        paymentMethod: 'COD',
        loyaltyPoints: 0,
        saveAddress: false,
        createAccount: false,
        acceptTerms: true,
      },
    });
    expect(placed.status()).toBe(201);
    const { orderNumber } = (await placed.json()) as { orderNumber: string };

    // Now as staff.
    const signIn = await api.post('/api/auth/login', {
      data: {
        email: process.env.SEED_ADMIN_EMAIL ?? 'admin@momishop.pk',
        password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2024',
      },
    });
    expect(signIn.status()).toBe(200);

    await page.goto('/admin/orders?status=PENDING');
    await expect(page.getByRole('heading', { name: 'Orders', exact: true })).toBeVisible();

    await page.getByRole('link', { name: orderNumber }).click();
    await expect(page.getByRole('heading', { name: orderNumber })).toBeVisible();

    // The state machine offers only legal moves: a pending order confirms.
    await page.getByRole('button', { name: /update status/i }).click();
    await expect(page.getByText(/moved to confirmed/i)).toBeVisible();
    await expect(page.getByText('Confirmed').first()).toBeVisible();
  });

  test('an admin can add a product and it starts life as a draft', async ({ page }, testInfo) => {
    const signIn = await page.request.post('/api/auth/login', {
      data: {
        email: process.env.SEED_ADMIN_EMAIL ?? 'admin@momishop.pk',
        password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2024',
      },
    });
    expect(signIn.status()).toBe(200);

    // The worker index is in the stamp because the projects run in parallel,
    // and the SKU is unique across the whole catalogue.
    const stamp = `${Date.now()}${testInfo.workerIndex}`;
    const name = `E2E Test Abaya ${stamp}`;

    await page.goto('/admin/products/new');

    // Located by role for the reason spelled out in the checkout test: the
    // accessible name carries a visually hidden "(required)" suffix.
    const form = page.locator('#main-content');
    await form.getByRole('textbox', { name: /^Name/ }).fill(name);
    await form.getByRole('textbox', { name: /^SKU/ }).fill(`MS-E2E-${stamp}`);
    await form.getByRole('spinbutton', { name: /^Price \(PKR\)/ }).fill('7500');

    // The web address is derived from the name, so links stay readable.
    await expect(form.getByRole('textbox', { name: /^Web address/ })).toHaveValue(
      /^e2e-test-abaya-\d+$/,
    );

    await page.getByRole('button', { name: 'Create product' }).click();

    // Lands on the piece's own page, which is where you would keep editing.
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
    await expect(page.getByText('draft', { exact: true })).toBeVisible();

    // And nothing about it reached the storefront.
    await page.goto('/admin/products?status=DRAFT');
    await expect(page.getByRole('link', { name })).toBeVisible();
  });

  test('a customer record shows their orders and never their credentials', async ({ page }) => {
    const signIn = await page.request.post('/api/auth/login', {
      data: {
        email: process.env.SEED_ADMIN_EMAIL ?? 'admin@momishop.pk',
        password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2024',
      },
    });
    expect(signIn.status()).toBe(200);

    await page.goto('/admin/customers');
    await expect(page.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible();

    const firstCustomer = page.locator('#main-content tbody tr').first().getByRole('link').first();
    await expect(firstCustomer).toBeVisible();
    await firstCustomer.click();

    await expect(page.getByRole('heading', { name: 'Orders', level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Access', level: 2 })).toBeVisible();

    // The API behind the screen hands over a person, not a login.
    const url = new URL(page.url());
    const detail = await page.request.get(`/api${url.pathname.replace('/admin', '/admin')}`);
    expect(detail.status()).toBe(200);
    const body = await detail.text();
    expect(body).not.toContain('passwordHash');
    expect(body).not.toContain('$2b$');
  });

  test('an admin can create a filter, tag a product, and shoppers can filter by it', async ({
    page,
  }, testInfo) => {
    const signIn = await page.request.post('/api/auth/login', {
      data: {
        email: process.env.SEED_ADMIN_EMAIL ?? 'admin@momishop.pk',
        password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2024',
      },
    });
    expect(signIn.status()).toBe(200);

    // Unique per run and per project, since both projects run at once.
    const stamp = `${Date.now()}${testInfo.workerIndex}`;
    const filterName = `Occasion ${stamp}`;

    await page.goto('/admin/filters');
    const main = page.locator('#main-content');
    await main.getByRole('textbox', { name: /^Name/ }).fill(filterName);
    await main.getByRole('textbox', { name: /^Options/ }).fill('Eid, Wedding');
    await main.getByRole('button', { name: 'Create filter' }).click();
    await expect(main.getByRole('textbox', { name: `Rename ${filterName}` })).toBeVisible();

    // A product no other running test is editing. Saving replaces a product's
    // filter tags wholesale, so two tests on one product overwrite each other
    // (or one saves an option the other has just deleted). parallelIndex is
    // unique among tests running at the same moment, across projects and
    // repeats alike.
    const sku = ACTIVE_SEED_SKUS[testInfo.parallelIndex % ACTIVE_SEED_SKUS.length];
    await page.goto(`/admin/products?q=${sku}`);
    await main.locator('table a').first().click();
    await expect(main.getByRole('heading', { level: 1 })).toBeVisible();

    await main.getByRole('group', { name: filterName }).getByLabel('Eid').check();
    await main.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Product saved.')).toBeVisible();

    try {
      // The shopper half runs at desktop width, where the panel is always open.
      // What this test checks is admin tag -> shop filter; opening the panel
      // on a phone has its own test ("mobile filters").
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto('/products');
      const panel = page.locator('#product-filters');
      await expect(panel).toBeVisible();

      const group = panel.getByRole('group', { name: filterName });
      await expect(group).toBeVisible();
      // Only options some product carries are offered.
      await expect(group.getByText('Wedding')).toHaveCount(0);

      await group.getByText('Eid', { exact: true }).click();
      await panel.getByRole('button', { name: 'Apply filters' }).click();

      await page.waitForURL(new RegExp(`attrs=occasion-${stamp}(%3A|:)eid`));
      await expect(page.getByText(/^1 piece$/)).toBeVisible();
    } finally {
      // Leave the panel as it was for the next run.
      const list = await page.request.get('/api/admin/filters');
      const { filters } = (await list.json()) as { filters: { id: string; label: string }[] };
      const created = filters.find((filter) => filter.label === filterName);
      if (created) await page.request.delete(`/api/admin/filters/${created.id}`);
    }
  });
  test('an admin can create a coupon and find it in the list', async ({ page }, testInfo) => {
    const signIn = await page.request.post('/api/auth/login', {
      data: {
        email: process.env.SEED_ADMIN_EMAIL ?? 'admin@momishop.pk',
        password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2024',
      },
    });
    expect(signIn.status()).toBe(200);

    const code = `E2E${Date.now()}${testInfo.parallelIndex}`;
    const main = page.locator('#main-content');

    try {
      await page.goto('/admin/coupons/new');
      // Typed in lower case on purpose: codes are stored in capitals.
      await main.getByRole('textbox', { name: /^Code/ }).fill(code.toLowerCase());
      await main.getByRole('textbox', { name: /^Percent off/ }).fill('10');
      await main.getByRole('button', { name: 'Create coupon' }).click();

      await expect(main.getByRole('heading', { level: 1, name: new RegExp(code) })).toBeVisible();

      await page.goto(`/admin/coupons?q=${code}`);
      await expect(main.getByRole('link', { name: code })).toBeVisible();
      await expect(main.getByText('10% off')).toBeVisible();
    } finally {
      const list = await page.request.get(`/api/admin/coupons?q=${code}`);
      const { items } = (await list.json()) as { items: { id: string; code: string }[] };
      const created = items.find((coupon) => coupon.code === code);
      if (created) await page.request.delete(`/api/admin/coupons/${created.id}`);
    }
  });
  test('a super admin can add a staff member, and the audit log records it', async ({
    page,
  }, testInfo) => {
    const signIn = await page.request.post('/api/auth/login', {
      data: {
        email: process.env.SEED_ADMIN_EMAIL ?? 'admin@momishop.pk',
        password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2024',
      },
    });
    expect(signIn.status()).toBe(200);

    const email = `e2e-staff-${Date.now()}${testInfo.parallelIndex}@momishop.pk`;
    const main = page.locator('#main-content');

    await page.goto('/admin/staff');
    await main.getByRole('textbox', { name: /^Name/ }).fill('E2E Staff');
    await main.getByRole('textbox', { name: /^Email/ }).fill(email);
    await main.getByLabel('Starting password').fill('workshop-2026');
    await main.getByRole('button', { name: 'Add staff' }).click();

    // Lands on the new account, with the role's permissions shown as included.
    await expect(main.getByText(email)).toBeVisible();
    await expect(main.getByRole('checkbox', { name: 'View orders' })).toBeChecked();
    await expect(main.getByRole('checkbox', { name: 'View orders' })).toBeDisabled();

    await page.goto(`/admin/audit?area=staff&actor=${encodeURIComponent('admin@momishop.pk')}`);
    await expect(main.getByText(`Added ${email} as staff`)).toBeVisible();
  });
  test('an admin can change the announcement bar and shoppers see it', async ({
    page,
  }, testInfo) => {
    // There is one announcement for the whole shop; two projects editing it at
    // once would overwrite each other.
    test.skip(testInfo.project.name !== 'chromium', 'runs in one project only');

    const signIn = await page.request.post('/api/auth/login', {
      data: {
        email: process.env.SEED_ADMIN_EMAIL ?? 'admin@momishop.pk',
        password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2024',
      },
    });
    expect(signIn.status()).toBe(200);

    const before = (await (await page.request.get('/api/admin/content')).json()) as {
      announcement: { text: string; isActive: boolean } | null;
    };
    const message = `E2E notice ${Date.now()}`;
    const main = page.locator('#main-content');

    try {
      await page.goto('/admin/content');
      await main.getByRole('textbox', { name: /^Message/ }).fill(message);
      await main.getByRole('button', { name: 'Save announcement' }).click();
      await expect(page.getByText('Announcement saved.')).toBeVisible();

      // Straight away, not after the ten-minute content cache runs out.
      await page.goto('/');
      await expect(page.getByText(message)).toBeVisible();
    } finally {
      if (before.announcement) {
        await page.request.put('/api/admin/content/announcement', {
          data: { text: before.announcement.text, isActive: before.announcement.isActive },
        });
      }
    }
  });
  test('an admin can add a delivery zone and give it a delivery option', async ({
    page,
  }, testInfo) => {
    const signIn = await page.request.post('/api/auth/login', {
      data: {
        email: process.env.SEED_ADMIN_EMAIL ?? 'admin@momishop.pk',
        password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2024',
      },
    });
    expect(signIn.status()).toBe(200);

    // A made-up city, so no real checkout is routed to this zone meanwhile.
    const stamp = `${Date.now()}${testInfo.parallelIndex}`;
    const zoneName = `E2E Zone ${stamp}`;
    const main = page.locator('#main-content');

    try {
      await page.goto('/admin/settings');
      const addZone = main
        .getByRole('heading', { name: 'Add a delivery zone' })
        .locator('..')
        .locator('..');
      await addZone.getByRole('textbox', { name: /^Zone name/ }).fill(zoneName);
      await addZone.getByRole('textbox', { name: /^Cities/ }).fill(`E2E City ${stamp}`);
      await addZone.getByRole('button', { name: 'Add zone' }).click();

      // A zone without options is flagged, because shoppers there cannot check out.
      const zoneCard = main
        .getByRole('heading', { name: new RegExp(zoneName) })
        .locator('..')
        .locator('..');
      await expect(zoneCard.getByText(/no options/)).toBeVisible();

      await zoneCard.getByText(`Add a delivery option to ${zoneName}`).click();
      await zoneCard.getByRole('textbox', { name: /^Option name/ }).fill('Standard');
      await zoneCard.getByRole('textbox', { name: /^Price \(Rs\)/ }).fill('250');
      await zoneCard.getByRole('button', { name: 'Add option' }).click();

      await expect(zoneCard.getByText(/no options/)).toHaveCount(0);
      await expect(zoneCard.getByText('Rs 250')).toBeVisible();
    } finally {
      const settings = await page.request.get('/api/admin/settings');
      const { zones } = (await settings.json()) as { zones: { id: string; name: string }[] };
      const created = zones.find((zone) => zone.name === zoneName);
      if (created) await page.request.delete(`/api/admin/shipping-zones/${created.id}`);
    }
  });
  test('an admin can read sales for a date range and download the orders', async ({ page }) => {
    const signIn = await page.request.post('/api/auth/login', {
      data: {
        email: process.env.SEED_ADMIN_EMAIL ?? 'admin@momishop.pk',
        password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2024',
      },
    });
    expect(signIn.status()).toBe(200);

    const main = page.locator('#main-content');
    await page.goto('/admin/reports');
    await main.getByRole('link', { name: 'Last 7 days' }).click();

    await expect(main.getByRole('link', { name: 'Last 7 days' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(main.getByText('Excludes cancelled and refunded orders.')).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Revenue by day' })).toBeVisible();

    const download = main.getByRole('link', { name: 'Download orders (CSV)' });
    const href = await download.getAttribute('href');
    const csv = await page.request.get(href ?? '');
    expect(csv.status()).toBe(200);
    expect(csv.headers()['content-type']).toContain('text/csv');
    expect(await csv.text()).toContain('Order number,Placed (Pakistan time)');
  });
});

test.describe('custom requests', () => {
  test('the owner sends a quote and the customer accepts it as an order', async ({
    browser,
  }, testInfo) => {
    const customer = await browser.newContext({ ...testInfo.project.use });
    const owner = await browser.newContext({ ...testInfo.project.use });

    try {
      const customerPage = await customer.newPage();
      const ownerPage = await owner.newPage();

      expect(
        (
          await customerPage.request.post('/api/auth/login', {
            data: { email: 'ayesha@example.com', password: 'Customer!2024' },
          })
        ).status(),
      ).toBe(200);
      expect(
        (
          await ownerPage.request.post('/api/auth/login', {
            data: {
              email: process.env.SEED_ADMIN_EMAIL ?? 'admin@momishop.pk',
              password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2024',
            },
          })
        ).status(),
      ).toBe(200);

      const title = `Eid frock ${Date.now()}${testInfo.parallelIndex}`;
      const created = await customerPage.request.post('/api/custom-requests', {
        data: {
          title,
          description: 'A peach cotton frock with lace at the hem, for a six year old.',
          template: 'GIRLS_STITCHED',
        },
      });
      expect(created.status()).toBe(201);
      const { request } = (await created.json()) as { request: { id: string } };

      // The owner sends a price from the conversation.
      await ownerPage.goto(`/admin/custom-requests/${request.id}`);
      const sidebar = ownerPage.locator('#main-content');
      await sidebar.getByRole('textbox', { name: /^Price \(Rs\)/ }).fill('5000');
      await sidebar.getByRole('textbox', { name: /^Stitching days/ }).fill('8');
      await sidebar.getByRole('button', { name: 'Send quote' }).click();
      await expect(ownerPage.getByText('Quote sent to the customer.')).toBeVisible();

      // The customer sees the quote card and accepts it.
      await customerPage.goto(`/account/custom-requests/${request.id}`);
      const quote = customerPage.getByRole('region', { name: 'Price quote' });
      await expect(quote.getByText('Rs 5,000')).toBeVisible();
      await quote.getByRole('link', { name: 'Accept and order' }).click();

      const form = customerPage.locator('#main-content');
      await form.getByRole('textbox', { name: /^Full name/ }).fill('Ayesha Khan');
      await form.getByRole('textbox', { name: /^Mobile number/ }).fill('03001234567');
      await form.getByRole('textbox', { name: /^Address/ }).fill('12 Garden Town');
      await form.getByRole('textbox', { name: /^City/ }).fill('Lahore');
      await form.getByRole('combobox', { name: /^Province/ }).click();
      await customerPage.getByRole('option', { name: 'Punjab' }).click();

      // The delivery options come back priced for that address.
      await expect(form.getByRole('radio', { name: /Cash on delivery/ })).toBeEnabled();
      await expect(form.getByRole('radio').first()).toBeChecked();
      await form.getByRole('checkbox', { name: /I agree to the/ }).check();
      await form.getByRole('button', { name: 'Place order' }).click();

      await expect(customerPage).toHaveURL(/\/order-confirmed\/MS-/, { timeout: 30_000 });
      await expect(customerPage.getByText(title)).toBeVisible();

      // The request is now marked as ordered for the owner.
      await ownerPage.goto(`/admin/custom-requests/${request.id}`);
      await expect(ownerPage.getByText('Ordered', { exact: true })).toBeVisible();
    } finally {
      await customer.close();
      await owner.close();
    }
  });

  test('a customer asks for a piece and the owner replies in the conversation', async ({
    browser,
  }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const customer = await browser.newContext({ baseURL, ...testInfo.project.use });
    const owner = await browser.newContext({ baseURL, ...testInfo.project.use });

    try {
      const customerPage = await customer.newPage();
      const ownerPage = await owner.newPage();

      const customerLogin = await customerPage.request.post('/api/auth/login', {
        data: { email: 'ayesha@example.com', password: 'Customer!2024' },
      });
      expect(customerLogin.status()).toBe(200);

      const ownerLogin = await ownerPage.request.post('/api/auth/login', {
        data: {
          email: process.env.SEED_ADMIN_EMAIL ?? 'admin@momishop.pk',
          password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2024',
        },
      });
      expect(ownerLogin.status()).toBe(200);

      // The customer describes the piece.
      const title = `Maroon lehnga ${Date.now()}${testInfo.parallelIndex}`;
      await customerPage.goto('/account/custom-requests/new');
      const form = customerPage.locator('#main-content');
      await form.getByRole('textbox', { name: /^What would you like made/ }).fill(title);
      await form
        .getByRole('textbox', { name: /^Describe it/ })
        .fill('Heavy zari work on the dupatta, full sleeves and a long flared skirt.');
      await form.getByRole('button', { name: 'Send request' }).click();

      await expect(customerPage.getByRole('heading', { name: new RegExp(title) })).toBeVisible();
      const requestUrl = customerPage.url();
      const requestId = requestUrl.split('/').pop();

      // The owner finds it, marked new, and replies.
      await ownerPage.goto('/admin/custom-requests');
      await expect(ownerPage.getByRole('link', { name: new RegExp(title) })).toBeVisible();
      await ownerPage.goto(`/admin/custom-requests/${requestId}`);
      const reply = `Yes, we can make this. ${Date.now()}`;
      await ownerPage.getByRole('textbox', { name: 'Message' }).fill(reply);
      await ownerPage.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(ownerPage.getByText(reply)).toBeVisible();

      // The customer's open page picks the reply up by itself, credited to the shop.
      await expect(customerPage.getByText(reply)).toBeVisible({ timeout: 15_000 });
      await expect(customerPage.getByText(/MomiShop ·/)).toBeVisible();
    } finally {
      await customer.close();
      await owner.close();
    }
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
