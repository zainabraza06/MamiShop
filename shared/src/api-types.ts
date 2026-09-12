import type { MeasurementTemplateKey } from './measurements';
import type { OrderStatus } from './order-status';
import type { UserRole } from './rbac';

/**
 * Response shapes of the MomiShop API.
 *
 * These describe the JSON as it arrives over the wire, so timestamps are ISO
 * strings rather than Date objects. The storefront types its API calls with
 * them. The API builds its responses from Prisma rows rather than from these
 * interfaces, so what keeps the two sides in step is the API's HTTP tests and
 * the end-to-end suite, which exercise both together.
 */

/** An ISO 8601 timestamp, as JSON serialises a Date. */
export type IsoDateString = string;

export interface ApiErrorBody {
  error: string;
  code: string;
  details?: unknown;
  issues?: { field: string; message: string }[];
  requestId?: string;
}

// ── Catalogue ──────────────────────────────────────────────────────────────

export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  sizingTemplate: string | null;
  /** Includes products in every subcategory. */
  productCount: number;
  children: CategoryNode[];
}

export interface CategoryDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  sizingTemplate: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  parent: { name: string; slug: string } | null;
  children: { id: string; name: string; slug: string; imageUrl: string | null }[];
}

export interface ProductCard {
  id: string;
  slug: string;
  name: string;
  basePrice: number;
  compareAtPrice: number | null;
  currency: string;
  ratingAverage: number;
  ratingCount: number;
  isNewArrival: boolean;
  stitchingDays: number;
  category: { name: string; slug: string };
  images: { url: string; alt: string; blurHash: string | null }[];
}

export interface ProductListResponse {
  items: ProductCard[];
  nextCursor: string | null;
  total: number;
}

export interface ProductVariant {
  id: string;
  sku: string;
  kind: string;
  name: string;
  colorHex: string | null;
  priceDelta: number;
  trackInventory: boolean;
  stockOnHand: number;
  stockReserved: number;
}

export interface ProductImage {
  id: string;
  url: string;
  alt: string;
  variantId: string | null;
  blurHash: string | null;
}

export interface ProductDetail {
  id: string;
  slug: string;
  name: string;
  sku: string;
  basePrice: number;
  compareAtPrice: number | null;
  currency: string;
  shortDescription: string | null;
  description: string | null;
  careInstructions: string | null;
  fabric: string | null;
  pieces: string | null;
  stitchingDays: number;
  requiresMeasurements: boolean;
  ratingAverage: number;
  ratingCount: number;
  metaTitle: string | null;
  metaDescription: string | null;
  sizingTemplate: string | null;
  categoryId: string;
  category: {
    id: string;
    name: string;
    slug: string;
    sizingTemplate: string | null;
    parent: { name: string; slug: string } | null;
  };
  variants: ProductVariant[];
  images: ProductImage[];
}

export interface Review {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  photos: string[];
  isVerifiedPurchase: boolean;
  createdAt: IsoDateString;
  user: { name: string | null; image: string | null };
}

export interface ReviewPage {
  items: Review[];
  nextCursor: string | null;
}

export interface SavedMeasurementProfile {
  id: string;
  label: string;
  unit: string;
  values: unknown;
  isDefault: boolean;
}

/** Everything the product page renders, in one response. */
export interface ProductPageData {
  product: ProductDetail;
  template: MeasurementTemplateKey;
  related: ProductCard[];
  reviews: ReviewPage;
  /** Approved review count per star rating, 1 to 5. */
  ratingBreakdown: Record<number, number>;
  /** The caller's saved profiles for this product's template; empty when signed out. */
  savedProfiles: SavedMeasurementProfile[];
  isSignedIn: boolean;
}

// ── Storefront ─────────────────────────────────────────────────────────────

export interface StorefrontShell {
  categories: CategoryNode[];
  cartCount: number;
  isSignedIn: boolean;
  announcement: string | null;
}

export interface ContentBlock {
  id: string;
  key: string;
  type: string;
  title: string | null;
  data: unknown;
}

export interface HomepageContent {
  blocks: ContentBlock[];
  categories: CategoryNode[];
  featured: ProductCard[];
  newArrivals: ProductCard[];
}

// ── Cart and checkout ──────────────────────────────────────────────────────

export interface CartLineIssue {
  itemId: string;
  productName: string;
  reason: 'UNAVAILABLE' | 'OUT_OF_STOCK' | 'QUANTITY_REDUCED';
  message: string;
  availableQuantity?: number;
}

export interface CartLine {
  id: string;
  quantity: number;
  productName: string;
  productSlug: string;
  variantName: string | null;
  unitPrice: number;
  currency: string;
  imageUrl: string | null;
  imageAlt: string;
  stitchingDays: number;
  measurementUnit: string | null;
  measurementValues: Record<string, number> | null;
  measurementTemplate: string | null;
  customNote: string | null;
  issue: CartLineIssue | null;
}

export interface CartContents {
  lines: CartLine[];
  couponCode: string | null;
  itemCount: number;
}

export interface CheckoutLine {
  id: string;
  quantity: number;
  productName: string;
  variantName: string | null;
  unitPrice: number;
  imageUrl: string | null;
  imageAlt: string;
}

export interface SavedAddress {
  id: string;
  fullName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string | null;
  country: string;
  isDefault: boolean;
}

/**
 * The checkout page's data, or why it cannot be shown. Anything other than
 * READY sends the customer somewhere better placed to help.
 */
export type CheckoutContext =
  | { status: 'EMPTY' | 'BLOCKED' | 'SIGN_IN_REQUIRED' }
  | {
      status: 'READY';
      lines: CheckoutLine[];
      currency: string;
      savedAddresses: SavedAddress[];
      loyaltyBalance: number;
      loyaltyEnabled: boolean;
      user: { id: string; email: string; name: string | null } | null;
      appliedCouponCode: string | null;
      maxStitchingDays: number;
    };

// ── Orders ─────────────────────────────────────────────────────────────────

export interface ShippingAddressSnapshot {
  fullName: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode?: string | null;
  country?: string;
}

export interface OrderConfirmation {
  orderNumber: string;
  email: string;
  status: OrderStatus;
  paymentMethod: string;
  placedAt: IsoDateString;
  currency: string;
  shippingAddress: ShippingAddressSnapshot;
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  taxTotal: number;
  grandTotal: number;
  items: {
    id: string;
    quantity: number;
    productName: string;
    variantName: string | null;
    lineTotal: number;
    measurementTemplate: string | null;
    measurementUnit: string | null;
    measurementSnapshot: Record<string, number> | null;
    customNote: string | null;
  }[];
}

// ── Accounts and admin ─────────────────────────────────────────────────────

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: UserRole;
  status: string;
  permissions: string[];
}

export interface AdminShell {
  user: { name: string | null; email: string; role: UserRole; permissions: string[] };
  badges: { orders: number; returns: number; reviews: number };
}

export interface AdminDashboard {
  revenueToday: number;
  ordersToday: number;
  revenueThisMonth: number;
  ordersThisMonth: number;
  /** Whole-number percentage, or null when last month had no revenue. */
  monthOverMonthChange: number | null;
  needsAction: number;
  customerCount: number;
  pendingReviews: number;
  recentOrders: {
    id: string;
    orderNumber: string;
    email: string;
    status: OrderStatus;
    grandTotal: number;
    currency: string;
    placedAt: IsoDateString;
    paymentMethod: string;
  }[];
  lowStock: {
    id: string;
    name: string;
    sku: string;
    stockOnHand: number;
    lowStockAlert: number;
    product: { name: string; slug: string };
  }[];
}
