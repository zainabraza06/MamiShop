/**
 * Pakistani administrative regions.
 *
 * Used for the checkout province selector and for shipping-zone matching, so
 * the strings here must exactly match the `states` values configured on
 * ShippingZone rows — zone resolution compares them case-insensitively but not
 * fuzzily.
 */
export const PAKISTAN_PROVINCES = [
  'Punjab',
  'Sindh',
  'Khyber Pakhtunkhwa',
  'Balochistan',
  'Islamabad Capital Territory',
  'Gilgit-Baltistan',
  'Azad Jammu and Kashmir',
] as const;

export type PakistanProvince = (typeof PAKISTAN_PROVINCES)[number];

/** Cities used for metro delivery zones and the city autocomplete. */
export const MAJOR_CITIES = [
  'Karachi',
  'Lahore',
  'Faisalabad',
  'Rawalpindi',
  'Islamabad',
  'Multan',
  'Gujranwala',
  'Peshawar',
  'Quetta',
  'Sialkot',
  'Hyderabad',
  'Bahawalpur',
  'Sargodha',
  'Sukkur',
  'Abbottabad',
] as const;

/** ISO codes for the countries the store can ship to. */
export const SUPPORTED_COUNTRIES = [
  { code: 'PK', name: 'Pakistan' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
] as const;
