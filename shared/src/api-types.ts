import type { MeasurementTemplateKey } from './measurements';
import type { OrderStatus, PaymentStatus } from './order-status';
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

/** One group in the storefront filter panel. Price figures are minor units. */
export type FacetGroup =
  | { kind: 'COLOR'; label: string; colors: { name: string; hex: string | null; count: number }[] }
  | { kind: 'PRICE'; label: string; min: number; max: number }
  | { kind: 'FABRIC'; label: string; fabrics: { name: string; count: number }[] }
  | { kind: 'FIT'; label: string; madeToMeasure: number; readyMade: number }
  | {
      kind: 'ATTRIBUTE';
      label: string;
      slug: string;
      options: { label: string; slug: string; count: number }[];
    };

/**
 * The filter panel for the category or search in view, in the order staff
 * set. Groups with nothing to offer are left out.
 */
export interface ProductFacets {
  filters: FacetGroup[];
}

export type FilterKind = FacetGroup['kind'];

export interface AdminFilterOption {
  id: string;
  label: string;
  slug: string;
  position: number;
  productCount: number;
}

export interface AdminStorefrontFilter {
  id: string;
  kind: FilterKind;
  label: string;
  slug: string;
  position: number;
  isVisible: boolean;
  /** Always empty for built-in filters, whose choices come from product data. */
  options: AdminFilterOption[];
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

/** An editorial page: privacy policy, terms, returns, delivery. */
export interface CmsPage {
  slug: string;
  title: string;
  /** Plain text, blank-line separated. Never HTML — it is rendered as text. */
  body: string;
  metaTitle: string | null;
  metaDescription: string | null;
  updatedAt: IsoDateString;
}

/** What the tracking page shows, for someone who proved both order number and email. */
export interface OrderTracking {
  orderNumber: string;
  status: OrderStatus;
  placedAt: IsoDateString;
  currency: string;
  grandTotal: number;
  courier: string | null;
  trackingNumber: string | null;
  items: { id: string; quantity: number; productName: string; variantName: string | null }[];
  events: {
    id: string;
    status: OrderStatus;
    title: string;
    description: string | null;
    createdAt: IsoDateString;
  }[];
}

// ── Accounts and admin ─────────────────────────────────────────────────────

export interface AccountOverview {
  user: { name: string | null; email: string };
  orders: {
    orderNumber: string;
    status: OrderStatus;
    placedAt: IsoDateString;
    grandTotal: number;
    currency: string;
  }[];
  wishlistCount: number;
  measurementProfileCount: number;
  loyaltyBalance: number;
}

export type DataRequestKind = 'EXPORT' | 'DELETE';
export type DataRequestStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'REJECTED';

export interface DataRequest {
  id: string;
  kind: DataRequestKind;
  status: DataRequestStatus;
  createdAt: IsoDateString;
  completedAt: IsoDateString | null;
  downloadUrl: string | null;
  expiresAt: IsoDateString | null;
}

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
  badges: { orders: number; returns: number; reviews: number; requests: number };
}

// ── Custom requests ────────────────────────────────────────────────────────

export type CustomRequestStatus =
  'OPEN' | 'QUOTED' | 'ACCEPTED' | 'ORDERED' | 'DECLINED' | 'CLOSED';

export interface ChatMessage {
  id: string;
  authorRole: 'CUSTOMER' | 'STAFF' | 'SYSTEM';
  /** Only sent to staff. Customers see replies from "MomiShop", not a named employee. */
  authorName: string | null;
  body: string;
  attachments: string[];
  /** Present when this message sent a price quote. */
  quote: ChatQuote | null;
  createdAt: IsoDateString;
}

export type CustomQuoteStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'WITHDRAWN';

export interface ChatQuote {
  id: string;
  /** Minor units, before delivery and tax. */
  amount: number;
  stitchingDays: number;
  note: string | null;
  status: CustomQuoteStatus;
  expiresAt: IsoDateString;
  /** Set once the quote has been accepted and turned into an order. */
  orderNumber: string | null;
}

export interface QuoteCheckoutContext {
  request: { id: string; number: string; title: string };
  quote: ChatQuote;
  email: string;
  phone: string | null;
  defaultAddress: {
    fullName: string;
    phone: string;
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    postalCode: string | null;
  } | null;
}

export interface QuoteCheckoutPreview {
  subtotal: number;
  shippingTotal: number;
  taxTotal: number;
  grandTotal: number;
  breakdown: { label: string; amount: number; kind: 'charge' | 'credit' }[];
  rates: {
    id: string;
    name: string;
    description: string | null;
    amount: number;
    freeAbove: number | null;
    minDays: number;
    maxDays: number;
  }[];
  selectedRateId: string | null;
  /** Whether cash on delivery is offered for this total and address. */
  codAllowed: boolean;
}

export interface CustomRequestSummary {
  id: string;
  number: string;
  title: string;
  status: CustomRequestStatus;
  lastMessageAt: IsoDateString;
  unread: boolean;
}

export interface CustomRequestDetail {
  id: string;
  number: string;
  title: string;
  description: string;
  template: string | null;
  measurementUnit: 'INCH' | 'CM' | null;
  measurementSnapshot: Record<string, number> | null;
  /** Minor units. */
  budget: number | null;
  neededBy: IsoDateString | null;
  status: CustomRequestStatus;
  createdAt: IsoDateString;
  messages: ChatMessage[];
}

export interface CustomRequestOptions {
  profiles: { id: string; label: string; template: string; unit: 'INCH' | 'CM' }[];
  uploadsEnabled: boolean;
}

export interface MessagesSince {
  messages: ChatMessage[];
  status: CustomRequestStatus;
}

export interface UploadSignature {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  folder: string;
  allowedFormats: string;
  signature: string;
}

export interface AdminCustomRequestSummary extends CustomRequestSummary {
  customer: { name: string | null; email: string };
  preview: string;
}

export interface AdminCustomRequestList {
  items: AdminCustomRequestSummary[];
  countsByStatus: Partial<Record<CustomRequestStatus, number>>;
}

export interface AdminCustomRequestDetail extends CustomRequestDetail {
  customer: { id: string; name: string | null; email: string; phone: string | null };
}

// ── Admin: orders ──────────────────────────────────────────────────────────

export interface AdminOrderSummary {
  id: string;
  orderNumber: string;
  email: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: string;
  grandTotal: number;
  refundedTotal: number;
  currency: string;
  placedAt: IsoDateString;
  isManual: boolean;
  itemCount: number;
}

export interface AdminOrderList {
  items: AdminOrderSummary[];
  nextCursor: string | null;
  total: number;
  /** Drives the filter tabs, so staff see what is waiting without clicking. */
  countsByStatus: Partial<Record<OrderStatus, number>>;
}

export interface AdminOrderItem {
  id: string;
  productId: string | null;
  productName: string;
  variantName: string | null;
  sku: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  measurementUnit: string | null;
  measurementSnapshot: Record<string, number> | null;
  measurementTemplate: string | null;
  customNote: string | null;
  productionStatus: string;
}

export interface AdminOrderEvent {
  id: string;
  status: OrderStatus;
  title: string;
  description: string | null;
  isPublic: boolean;
  createdAt: IsoDateString;
}

export interface AdminPaymentTransaction {
  id: string;
  kind: string;
  status: string;
  amount: number;
  currency: string;
  reference: string | null;
  createdAt: IsoDateString;
}

export interface AdminOrderDetail {
  id: string;
  orderNumber: string;
  email: string;
  phone: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: string;
  currency: string;
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  taxTotal: number;
  grandTotal: number;
  refundedTotal: number;
  couponCode: string | null;
  shippingSnapshot: ShippingAddressSnapshot;
  trackingNumber: string | null;
  courier: string | null;
  shippedAt: IsoDateString | null;
  deliveredAt: IsoDateString | null;
  cancelledAt: IsoDateString | null;
  cancelReason: string | null;
  customerNote: string | null;
  staffNote: string | null;
  isManual: boolean;
  placedAt: IsoDateString;
  items: AdminOrderItem[];
  events: AdminOrderEvent[];
  payments: AdminPaymentTransaction[];
  returnRequests: {
    id: string;
    requestNumber: string;
    status: string;
    kind: string;
    createdAt: IsoDateString;
  }[];
  user: { id: string; name: string | null; email: string } | null;
}

// ── Admin: catalogue ───────────────────────────────────────────────────────

export type ProductStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

export interface AdminProductSummary {
  id: string;
  sku: string;
  slug: string;
  name: string;
  status: ProductStatus;
  basePrice: number;
  currency: string;
  isFeatured: boolean;
  salesCount: number;
  updatedAt: IsoDateString;
  category: { name: string };
  image: { url: string; alt: string } | null;
  /** Across active variants only — what is actually sellable. */
  stockOnHand: number;
  lowStock: boolean;
  variants: {
    id: string;
    name: string;
    stockOnHand: number;
    lowStockAlert: number;
    isActive: boolean;
  }[];
}

export interface AdminProductList {
  items: AdminProductSummary[];
  nextCursor: string | null;
  total: number;
  countsByStatus: Partial<Record<ProductStatus, number>>;
}

export interface AdminProductVariant {
  id: string;
  sku: string;
  kind: string;
  name: string;
  colorHex: string | null;
  priceDelta: number;
  position: number;
  isActive: boolean;
  trackInventory: boolean;
  stockOnHand: number;
  lowStockAlert: number;
}

export interface AdminProductDetail {
  id: string;
  sku: string;
  slug: string;
  name: string;
  categoryId: string;
  status: ProductStatus;
  shortDescription: string | null;
  description: string | null;
  careInstructions: string | null;
  fabric: string | null;
  pieces: string | null;
  tags: string[];
  basePrice: number;
  compareAtPrice: number | null;
  currency: string;
  taxClass: string;
  requiresMeasurements: boolean;
  sizingTemplate: string | null;
  stitchingDays: number;
  isFeatured: boolean;
  isNewArrival: boolean;
  weightGrams: number;
  metaTitle: string | null;
  metaDescription: string | null;
  archivedAt: IsoDateString | null;
  variants: AdminProductVariant[];
  images: { id: string; url: string; alt: string; position: number }[];
  category: { id: string; name: string };
  /** Custom filter options this product is tagged with. */
  filterOptionIds: string[];
}

export interface AdminCategory {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  isActive: boolean;
  sizingTemplate: string | null;
  productCount: number;
}

// ── Admin: reports ─────────────────────────────────────────────────────────

export interface AdminReport {
  /** Pakistan calendar days, inclusive. */
  range: { from: string; to: string };
  /** Minor units. Revenue excludes cancelled and refunded orders. */
  summary: {
    revenue: number;
    orders: number;
    averageOrder: number;
    discounts: number;
    refunded: number;
    cancelled: number;
  };
  /** Every day in the range, including days without orders. */
  byDay: { day: string; revenue: number; orders: number }[];
  topProducts: { name: string; quantity: number; revenue: number }[];
  byPayment: { method: string; orders: number; revenue: number }[];
  canExport: boolean;
}

// ── Admin: settings ────────────────────────────────────────────────────────

export interface AdminShippingRate {
  id: string;
  zoneId: string;
  name: string;
  description: string | null;
  /** Minor units. */
  amount: number;
  /** Order subtotal, in minor units, at or above which delivery is free. */
  freeAbove: number | null;
  codSurcharge: number;
  minDays: number;
  maxDays: number;
  isActive: boolean;
  position: number;
}

export interface AdminShippingZone {
  id: string;
  name: string;
  country: string;
  cities: string[];
  states: string[];
  priority: number;
  isActive: boolean;
  rates: AdminShippingRate[];
}

export interface AdminTaxRule {
  id: string;
  name: string;
  country: string;
  state: string | null;
  taxClass: string;
  /** Basis points: 1700 is 17%. */
  rateBps: number;
  isInclusive: boolean;
  priority: number;
  isActive: boolean;
}

export interface AdminSettings {
  zones: AdminShippingZone[];
  taxRules: AdminTaxRule[];
  canShipping: boolean;
  canTax: boolean;
}

// ── Admin: content ─────────────────────────────────────────────────────────

export interface AdminAnnouncement {
  text: string;
  isActive: boolean;
  startsAt: IsoDateString | null;
  endsAt: IsoDateString | null;
  updatedAt: IsoDateString;
}

/** Every field is optional: the block holds whatever was last saved or seeded. */
export interface AdminHero {
  headline?: string;
  subhead?: string;
  ctaLabel?: string;
  ctaHref?: string;
  imageUrl?: string;
  imageAlt?: string;
  isActive: boolean;
  updatedAt: IsoDateString;
}

export interface AdminPageSummary {
  id: string;
  slug: string;
  title: string;
  isPublished: boolean;
  updatedAt: IsoDateString;
}

export interface AdminPage extends AdminPageSummary {
  body: string;
  metaTitle: string | null;
  metaDescription: string | null;
}

export interface AdminContent {
  announcement: AdminAnnouncement | null;
  hero: AdminHero | null;
  pages: AdminPageSummary[];
}

// ── Admin: audit log ───────────────────────────────────────────────────────

export interface AdminAuditEntry {
  id: string;
  /** "area.verb", e.g. "order.refund". */
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  /** Only the fields that changed, with sensitive values redacted. */
  diff: unknown;
  createdAt: IsoDateString;
}

export interface AdminAuditList {
  items: AdminAuditEntry[];
  nextCursor: string | null;
  areas: { name: string; count: number }[];
}

// ── Admin: staff ───────────────────────────────────────────────────────────

export type StaffRole = 'STAFF' | 'ADMIN' | 'SUPER_ADMIN';

export interface AdminStaffMember {
  id: string;
  name: string | null;
  email: string;
  role: StaffRole;
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  /** Extra permissions on top of the role's defaults. */
  permissions: string[];
  lastLoginAt: IsoDateString | null;
  createdAt: IsoDateString;
  isSelf: boolean;
  /** Whether the signed-in user may change this account. */
  canManage: boolean;
}

export interface AdminStaffList {
  items: AdminStaffMember[];
  /** Roles the signed-in user may give someone. */
  assignableRoles: StaffRole[];
  canWrite: boolean;
}

export interface AdminStaffDetail {
  staff: AdminStaffMember;
  assignableRoles: StaffRole[];
  canWrite: boolean;
}

// ── Admin: coupons ─────────────────────────────────────────────────────────

export type CouponType = 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE_SHIPPING';

export interface AdminCoupon {
  id: string;
  code: string;
  type: CouponType;
  /** Percent (1-100) for PERCENTAGE, minor units for FIXED_AMOUNT. */
  value: number;
  maxDiscount: number | null;
  minOrderSubtotal: number;
  usageLimit: number | null;
  usageLimitPerUser: number | null;
  usedCount: number;
  appliesToCategoryIds: string[];
  appliesToProductIds: string[];
  firstOrderOnly: boolean;
  description: string | null;
  isActive: boolean;
  startsAt: IsoDateString | null;
  endsAt: IsoDateString | null;
  createdAt: IsoDateString;
  orderCount: number;
}

export interface AdminCouponList {
  items: AdminCoupon[];
  total: number;
}

// ── Admin: customers ───────────────────────────────────────────────────────

export type CustomerStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';

export interface AdminCustomerSummary {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  status: CustomerStatus;
  marketingOptIn: boolean;
  createdAt: IsoDateString;
  lastLoginAt: IsoDateString | null;
  orderCount: number;
  /** Minor units, banked orders only — see BANKED_STATUSES. */
  lifetimeSpend: number;
  lastOrderAt: IsoDateString | null;
}

export interface AdminCustomerList {
  items: AdminCustomerSummary[];
  total: number;
  nextCursor: string | null;
}

export interface AdminCustomerOrder {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  grandTotal: number;
  currency: string;
  placedAt: IsoDateString;
}

export interface AdminCustomerDetail {
  id: string;
  name: string | null;
  email: string;
  emailVerified: IsoDateString | null;
  phone: string | null;
  status: CustomerStatus;
  marketingOptIn: boolean;
  locale: string;
  currency: string;
  createdAt: IsoDateString;
  lastLoginAt: IsoDateString | null;
  deletedAt: IsoDateString | null;
  addresses: {
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
  }[];
  measurementProfiles: {
    id: string;
    label: string;
    template: string;
    unit: string;
    updatedAt: IsoDateString;
  }[];
  loyaltyAccount: { balance: number; lifetimeEarned: number; lifetimeSpent: number } | null;
  reviewCount: number;
  returnCount: number;
  lifetimeSpend: number;
  paidOrderCount: number;
}

// ── Admin: moderation ──────────────────────────────────────────────────────

export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface AdminReview {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  photos: string[];
  isVerifiedPurchase: boolean;
  status: ReviewStatus;
  createdAt: IsoDateString;
  user: { name: string | null; email: string };
  product: { name: string; slug: string };
}

export interface AdminReviewList {
  items: AdminReview[];
  nextCursor: string | null;
  countsByStatus: Partial<Record<ReviewStatus, number>>;
}

export type ReturnStatus =
  | 'REQUESTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'IN_TRANSIT'
  | 'RECEIVED'
  | 'REFUNDED'
  | 'EXCHANGED'
  | 'CLOSED';

export interface AdminReturn {
  id: string;
  requestNumber: string;
  kind: 'RETURN' | 'EXCHANGE';
  status: ReturnStatus;
  reason: string;
  detail: string | null;
  photos: string[];
  refundAmount: number | null;
  staffNote: string | null;
  createdAt: IsoDateString;
  order: {
    id: string;
    orderNumber: string;
    email: string;
    currency: string;
    grandTotal: number;
  };
  items: { id: string; quantity: number; reason: string | null }[];
}

export interface AdminReturnList {
  items: AdminReturn[];
  nextCursor: string | null;
  countsByStatus: Partial<Record<ReturnStatus, number>>;
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
