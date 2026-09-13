/**
 * Calendar days in the shop's own time zone.
 *
 * Admin date fields are whole days in Pakistan time: a promotion that "ends on
 * the 31st" should still run at 11pm on the 31st in Lahore, whatever time zone
 * the server or the admin's laptop is in. Formatting with an explicit zone also
 * keeps the server and browser renders identical, so the date inputs never
 * cause a hydration mismatch.
 */

export const SHOP_TIME_ZONE = 'Asia/Karachi';
export const SHOP_UTC_OFFSET = '+05:00';

/** An ISO timestamp as the YYYY-MM-DD day it falls on in Pakistan. */
export function shopDay(iso: string | null | undefined): string {
  if (!iso) return '';
  // en-CA formats as YYYY-MM-DD, which is what a date input expects.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SHOP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

/** The first moment of a Pakistan calendar day, or null for an empty field. */
export const startOfShopDay = (day: string): string | null =>
  day ? `${day}T00:00:00${SHOP_UTC_OFFSET}` : null;

/** The last moment of a Pakistan calendar day, or null for an empty field. */
export const endOfShopDay = (day: string): string | null =>
  day ? `${day}T23:59:59${SHOP_UTC_OFFSET}` : null;
