import type { Locator, Page } from '@playwright/test';

/**
 * Waits until React has hydrated an element, so a click on it is handled.
 *
 * A click that lands before hydration is either lost or replayed by React once
 * hydration finishes. Retrying the click does not help: the retry can race the
 * replay, and a toggle opened by one is closed again by the other. Waiting for
 * React's own props on the element makes the first click count.
 */
export async function waitForHydration(page: Page, locator: Locator): Promise<void> {
  const handle = await locator.elementHandle();
  if (!handle) throw new Error('waitForHydration: element not found');

  await page.waitForFunction(
    (element) => Object.keys(element).some((key) => key.startsWith('__reactProps$')),
    handle,
  );
}
