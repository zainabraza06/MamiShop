import { Router } from 'express';
import { accountRouter } from './account';
import { adminRouter } from './admin';
import { adminSettingsRouter } from './admin-settings';
import { adminAuditRouter } from './admin-audit';
import { adminStaffRouter } from './admin-staff';
import { adminCatalogueRouter } from './admin-catalogue';
import { adminContentRouter } from './admin-content';
import { adminCouponsRouter } from './admin-coupons';
import { adminCustomersRouter } from './admin-customers';
import { adminModerationRouter } from './admin-moderation';
import { adminOrdersRouter } from './admin-orders';
import { adminReportsRouter } from './admin-reports';
import { authRouter } from './auth';
import { cartRouter } from './cart';
import { catalogueRouter } from './catalogue';
import { checkoutRouter } from './checkout';
import { contactRouter } from './contact';
import { cronRouter } from './cron';
import { healthRouter } from './health';
import { newsletterRouter } from './newsletter';
import { ordersRouter } from './orders';
import { pagesRouter } from './pages';
import { storefrontRouter } from './storefront';
import { wishlistRouter } from './wishlist';

/** Every API route, mounted under /api by the app. */
export const apiRouter = Router();

apiRouter.use(
  healthRouter,
  storefrontRouter,
  catalogueRouter,
  pagesRouter,
  cartRouter,
  checkoutRouter,
  ordersRouter,
  authRouter,
  accountRouter,
  newsletterRouter,
  contactRouter,
  wishlistRouter,
  adminRouter,
  adminSettingsRouter,
  adminAuditRouter,
  adminStaffRouter,
  adminOrdersRouter,
  adminReportsRouter,
  adminModerationRouter,
  adminCatalogueRouter,
  adminContentRouter,
  adminCustomersRouter,
  adminCouponsRouter,
  cronRouter,
);
