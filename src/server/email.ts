import 'server-only';
import { Resend } from 'resend';
import { logger } from '@/lib/logger';
import { absoluteUrl } from '@/lib/utils';

/**
 * Transactional email.
 *
 * Templates are plain functions returning HTML strings rather than React
 * Email components. Order confirmations have to render in Gmail, Outlook and
 * a decade of mobile clients, which in practice means table layouts and inline
 * styles — a component abstraction over that mostly hides the constraint
 * without removing it.
 *
 * Every send is idempotent at the queue level (see src/server/jobs.ts), so a
 * retried webhook cannot email the customer twice.
 */

let client: Resend | null = null;

function resend(): Resend | null {
  if (client) return client;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  client = new Resend(key);
  return client;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

/**
 * Sends one email.
 *
 * Throws on failure so the job queue can retry with backoff. In development,
 * with no API key configured, it logs the message instead of failing — a
 * developer without a Resend account should still be able to place a test
 * order end to end.
 */
export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const api = resend();

  if (!api) {
    logger.info('Email not sent: RESEND_API_KEY is not configured', {
      to: options.to,
      subject: options.subject,
    });
    return;
  }

  const { error } = await api.emails.send({
    from: process.env.EMAIL_FROM ?? 'MomiShop <orders@momishop.pk>',
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
    replyTo: options.replyTo ?? process.env.EMAIL_REPLY_TO,
  });

  if (error) {
    // Surfacing the provider's message keeps the DEAD-letter row diagnosable.
    throw new Error(`Resend rejected the message: ${error.message}`);
  }
}

// ── Template shell ───────────────────────────────────────────────────────────

/**
 * Wraps content in the shared email chrome.
 *
 * Table-based and inline-styled on purpose: Outlook still ignores most
 * embedded CSS, and flexbox is unreliable across mail clients. The 600px width
 * is the long-standing safe maximum.
 */
function shell(content: string, preheader: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MomiShop</title>
</head>
<body style="margin:0;padding:0;background:#FBF9F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#2C2622;">
  <!-- Preheader: the preview line in the inbox, hidden in the body itself. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBF9F6;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #E5DDD4;border-radius:8px;">
          <tr>
            <td style="padding:24px 32px;border-bottom:1px solid #E5DDD4;">
              <span style="font-size:22px;font-weight:600;letter-spacing:-0.01em;">MomiShop</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">${content}</td>
          </tr>
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #E5DDD4;font-size:12px;color:#6B635D;">
              <p style="margin:0 0 8px;">Questions? Just reply to this email and a person will answer.</p>
              <p style="margin:0;">
                <a href="${absoluteUrl('/pages/returns-policy')}" style="color:#7E5A48;">Returns policy</a> &nbsp;·&nbsp;
                <a href="${absoluteUrl('/pages/privacy-policy')}" style="color:#7E5A48;">Privacy</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Escapes interpolated values.
 *
 * React is not doing it for us here — these are raw strings that go straight
 * into an HTML document. A customer whose name contains a bracket must not be
 * able to inject markup into their own confirmation email.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr><td style="background:#7E5A48;border-radius:6px;">
      <a href="${href}" style="display:inline-block;padding:12px 24px;color:#FBF9F6;text-decoration:none;font-weight:600;font-size:14px;">${escapeHtml(label)}</a>
    </td></tr>
  </table>`;
}

// ── Templates ────────────────────────────────────────────────────────────────

export interface OrderEmailData {
  orderNumber: string;
  customerName: string;
  email: string;
  items: {
    productName: string;
    variantName: string | null;
    quantity: number;
    lineTotal: string;
    measurementSummary: string | null;
  }[];
  subtotal: string;
  shipping: string;
  discount: string | null;
  total: string;
  paymentMethod: string;
  estimatedDelivery: string;
  shippingAddress: string;
}

export function orderConfirmationEmail(data: OrderEmailData): {
  subject: string;
  html: string;
  text: string;
} {
  const rows = data.items
    .map(
      (item) => `<tr>
        <td style="padding:12px 0;border-bottom:1px solid #F0EBE4;">
          <strong style="font-size:14px;">${escapeHtml(item.productName)}</strong>
          ${item.variantName ? `<br><span style="font-size:13px;color:#6B635D;">${escapeHtml(item.variantName)}</span>` : ''}
          <br><span style="font-size:13px;color:#6B635D;">Quantity: ${item.quantity}</span>
          ${
            item.measurementSummary
              ? `<br><span style="font-size:12px;color:#6B635D;">Cut to: ${escapeHtml(item.measurementSummary)}</span>`
              : ''
          }
        </td>
        <td align="right" style="padding:12px 0;border-bottom:1px solid #F0EBE4;font-size:14px;white-space:nowrap;">${escapeHtml(item.lineTotal)}</td>
      </tr>`,
    )
    .join('');

  const content = `
    <h1 style="margin:0 0 8px;font-size:22px;">Thank you, ${escapeHtml(data.customerName)}</h1>
    <p style="margin:0 0 4px;font-size:15px;line-height:1.6;">
      We have your order and our workshop is getting started.
    </p>
    <p style="margin:0 0 24px;font-size:15px;">
      Order number: <strong>${escapeHtml(data.orderNumber)}</strong>
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;font-size:14px;">
      <tr><td style="padding:4px 0;color:#6B635D;">Subtotal</td><td align="right">${escapeHtml(data.subtotal)}</td></tr>
      ${data.discount ? `<tr><td style="padding:4px 0;color:#296550;">Discount</td><td align="right" style="color:#296550;">−${escapeHtml(data.discount)}</td></tr>` : ''}
      <tr><td style="padding:4px 0;color:#6B635D;">Delivery</td><td align="right">${escapeHtml(data.shipping)}</td></tr>
      <tr><td style="padding:10px 0 0;font-weight:600;border-top:1px solid #E5DDD4;">Total</td><td align="right" style="padding:10px 0 0;font-weight:600;border-top:1px solid #E5DDD4;">${escapeHtml(data.total)}</td></tr>
    </table>

    <p style="margin:24px 0 0;font-size:14px;line-height:1.6;">
      <strong>Estimated delivery:</strong> ${escapeHtml(data.estimatedDelivery)}<br>
      <span style="color:#6B635D;">Made-to-measure pieces are cut and stitched after your order is confirmed, so this is longer than an off-the-shelf delivery.</span>
    </p>

    <p style="margin:16px 0 0;font-size:14px;line-height:1.6;">
      <strong>Delivering to:</strong><br>
      <span style="color:#6B635D;">${escapeHtml(data.shippingAddress)}</span>
    </p>

    <p style="margin:16px 0 0;font-size:14px;">
      <strong>Payment:</strong> ${escapeHtml(data.paymentMethod)}
    </p>

    ${button(absoluteUrl(`/track-order?order=${data.orderNumber}`), 'Track your order')}

    <p style="margin:0;font-size:13px;color:#6B635D;line-height:1.6;">
      Please check the measurements above carefully. If anything looks wrong, reply to this
      email within 24 hours and we can still change it before cutting begins.
    </p>
  `;

  const text = [
    `Thank you, ${data.customerName}`,
    '',
    `Order ${data.orderNumber}`,
    '',
    ...data.items.map(
      (i) =>
        `${i.quantity} x ${i.productName}${i.variantName ? ` (${i.variantName})` : ''} — ${i.lineTotal}` +
        (i.measurementSummary ? `\n    Cut to: ${i.measurementSummary}` : ''),
    ),
    '',
    `Subtotal: ${data.subtotal}`,
    ...(data.discount ? [`Discount: -${data.discount}`] : []),
    `Delivery: ${data.shipping}`,
    `Total: ${data.total}`,
    '',
    `Estimated delivery: ${data.estimatedDelivery}`,
    `Payment: ${data.paymentMethod}`,
    '',
    `Track your order: ${absoluteUrl(`/track-order?order=${data.orderNumber}`)}`,
    '',
    'Please check your measurements. If anything looks wrong, reply within 24 hours.',
  ].join('\n');

  return {
    subject: `Order ${data.orderNumber} confirmed — MomiShop`,
    html: shell(content, `Your order ${data.orderNumber} is confirmed.`),
    text,
  };
}

export function orderShippedEmail(data: {
  orderNumber: string;
  customerName: string;
  courier: string;
  trackingNumber: string;
}): { subject: string; html: string; text: string } {
  const content = `
    <h1 style="margin:0 0 8px;font-size:22px;">Your order is on its way</h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;">
      ${escapeHtml(data.customerName)}, order <strong>${escapeHtml(data.orderNumber)}</strong>
      has left our workshop.
    </p>
    <p style="margin:0;font-size:14px;">
      <strong>Courier:</strong> ${escapeHtml(data.courier)}<br>
      <strong>Tracking number:</strong> ${escapeHtml(data.trackingNumber)}
    </p>
    ${button(absoluteUrl(`/track-order?order=${data.orderNumber}`), 'Track your parcel')}
  `;

  return {
    subject: `Order ${data.orderNumber} has shipped — MomiShop`,
    html: shell(content, `${data.orderNumber} is on its way.`),
    text: `Your order ${data.orderNumber} has shipped.\n\nCourier: ${data.courier}\nTracking: ${data.trackingNumber}\n\n${absoluteUrl(`/track-order?order=${data.orderNumber}`)}`,
  };
}

export function abandonedCartEmail(data: {
  customerName: string;
  itemNames: string[];
  recoveryUrl: string;
}): { subject: string; html: string; text: string } {
  const content = `
    <h1 style="margin:0 0 8px;font-size:22px;">You left something behind</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
      ${escapeHtml(data.customerName)}, your bag is still here whenever you are ready.
    </p>
    <ul style="margin:0 0 8px;padding-left:20px;font-size:14px;line-height:1.8;">
      ${data.itemNames.map((name) => `<li>${escapeHtml(name)}</li>`).join('')}
    </ul>
    ${button(data.recoveryUrl, 'Return to your bag')}
    <p style="margin:0;font-size:13px;color:#6B635D;">
      Everything is stitched to your measurements, so nothing is reserved until you check out.
    </p>
  `;

  return {
    subject: 'Your MomiShop bag is waiting',
    html: shell(content, 'Your bag is still here.'),
    text: `Your bag is still here:\n\n${data.itemNames.map((n) => `- ${n}`).join('\n')}\n\n${data.recoveryUrl}`,
  };
}

export function welcomeEmail(data: { customerName: string }): {
  subject: string;
  html: string;
  text: string;
} {
  const content = `
    <h1 style="margin:0 0 8px;font-size:22px;">Welcome to MomiShop</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
      ${escapeHtml(data.customerName)}, thank you for joining us. Everything we make is cut to
      your own measurements — no size charts, no guessing.
    </p>
    <p style="margin:0 0 8px;font-size:15px;line-height:1.6;">
      Save your measurements once and we will reuse them on every order.
    </p>
    ${button(absoluteUrl('/account/measurements'), 'Add your measurements')}
  `;

  return {
    subject: 'Welcome to MomiShop',
    html: shell(content, 'Save your measurements and shop made-to-measure.'),
    text: `Welcome to MomiShop, ${data.customerName}.\n\nSave your measurements once: ${absoluteUrl('/account/measurements')}`,
  };
}

/**
 * Sent when someone tries to register with an address that already has an
 * account. The registration endpoint responds identically either way, so this
 * is how the genuine account holder finds out.
 */
export function duplicateRegistrationEmail(data: { customerName: string }): {
  subject: string;
  html: string;
  text: string;
} {
  const content = `
    <h1 style="margin:0 0 8px;font-size:22px;">Someone tried to create an account</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
      ${escapeHtml(data.customerName)}, someone just tried to register with your email address.
      You already have a MomiShop account, so nothing was created and nothing has changed.
    </p>
    <p style="margin:0 0 8px;font-size:15px;line-height:1.6;">
      If that was you, simply sign in. If it was not, you can safely ignore this — but if you
      are concerned, reset your password.
    </p>
    ${button(absoluteUrl('/login'), 'Sign in')}
  `;

  return {
    subject: 'Sign-in help for your MomiShop account',
    html: shell(content, 'Someone tried to register with your email.'),
    text: `Someone tried to register with your email. You already have an account, so nothing changed.\n\nSign in: ${absoluteUrl('/login')}`,
  };
}
