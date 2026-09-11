import { Router } from 'express';
import { requirePermission, requireStaff } from '../auth/current-user';
import { getAdminBadges, getDashboardSummary } from '../services/admin-dashboard';

/**
 * Admin reads.
 *
 * The storefront proxy already redirects anonymous and non-staff visitors away
 * from /admin, but it decides from the session token, which reflects the role
 * at sign-in. These routes check the live user row, so a staff member demoted
 * five minutes ago loses access on their very next request.
 */
export const adminRouter = Router();

/** The admin shell: who is signed in, and the sidebar badge counts. */
adminRouter.get('/admin/shell', async (req, res) => {
  const user = await requireStaff(req);

  res.json({
    user: { name: user.name, email: user.email, role: user.role, permissions: user.permissions },
    badges: await getAdminBadges(),
  });
});

adminRouter.get('/admin/dashboard', async (req, res) => {
  await requirePermission(req, 'order.read');
  res.json(await getDashboardSummary());
});
