import { Router } from 'express';
import { adminRouter } from './admin';
import { authRouter } from './auth';
import { cartRouter } from './cart';
import { catalogueRouter } from './catalogue';
import { checkoutRouter } from './checkout';
import { cronRouter } from './cron';
import { healthRouter } from './health';
import { newsletterRouter } from './newsletter';
import { ordersRouter } from './orders';
import { storefrontRouter } from './storefront';
import { wishlistRouter } from './wishlist';

/** Every API route, mounted under /api by the app. */
export const apiRouter = Router();

apiRouter.use(
  healthRouter,
  storefrontRouter,
  catalogueRouter,
  cartRouter,
  checkoutRouter,
  ordersRouter,
  authRouter,
  newsletterRouter,
  wishlistRouter,
  adminRouter,
  cronRouter,
);
