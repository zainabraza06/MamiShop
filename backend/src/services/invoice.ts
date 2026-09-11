import type { Prisma } from '@prisma/client';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { formatMoney, type Currency } from '@momishop/shared/money';
import { formatDate } from '@momishop/shared/text';
import { describeMeasurements, type MeasurementTemplateKey } from '@momishop/shared/measurements';

/**
 * PDF invoice generation.
 *
 * pdf-lib rather than a headless browser: rendering HTML to PDF needs Chromium,
 * which does not fit in a serverless function's size or cold-start budget.
 * Drawing directly is more code but runs anywhere and produces a much smaller
 * file.
 *
 * Only the standard PDF fonts are used, so no font file has to be bundled.
 * That does mean the text must be WinAnsi-encodable — see `sanitizeForPdf`.
 */

export interface InvoiceData {
  orderNumber: string;
  placedAt: Date;
  currency: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  shippingAddress: {
    fullName: string;
    line1: string;
    line2?: string | null;
    city: string;
    state: string;
    postalCode?: string | null;
    country: string;
  };
  items: {
    productName: string;
    variantName: string | null;
    sku: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    measurementUnit: string | null;
    measurementSnapshot: unknown;
    measurementTemplate: string | null;
  }[];
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  taxTotal: number;
  grandTotal: number;
  paymentMethod: string;
  paymentStatus: string;
  couponCode: string | null;
  storeName: string;
  storeEmail: string;
  storePhone: string;
}

/**
 * The standard PDF fonts only cover WinAnsi (roughly Latin-1).
 *
 * A product name with a curly quote or an en dash — both of which our own copy
 * uses — would otherwise throw mid-render and fail the invoice job. Replacing
 * the common offenders and stripping the rest is far better than a DEAD job
 * and a customer with no invoice.
 */
function sanitizeForPdf(input: string): string {
  const replacements: Record<string, string> = {
    '‘': "'",
    '’': "'",
    '“': '"',
    '”': '"',
    '–': '-',
    '—': '-',
    '…': '...',
    ' ': ' ',
    '·': '-',
    '₹': 'Rs ',
    '₨': 'Rs ',
  };

  let out = '';
  for (const char of input) {
    const replacement = replacements[char];
    if (replacement !== undefined) {
      out += replacement;
      continue;
    }
    const code = char.codePointAt(0) ?? 0;
    // Printable WinAnsi range; anything else (Urdu, emoji) becomes '?'.
    out += code >= 0x20 && code <= 0xff ? char : '?';
  }
  return out;
}

export async function generateInvoicePdf(data: InvoiceData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Invoice ${data.orderNumber}`);
  pdf.setAuthor(data.storeName);
  pdf.setCreator('MomiShop');

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([595.28, 841.89]); // A4 in points
  const { width, height } = page.getSize();

  const margin = 48;
  const ink = rgb(0.17, 0.15, 0.13);
  const muted = rgb(0.42, 0.39, 0.36);
  const line = rgb(0.9, 0.87, 0.83);
  const currency = data.currency as Currency;

  let y = height - margin;

  const text = (
    value: string,
    options: { x?: number; size?: number; font?: typeof regular; color?: typeof ink } = {},
  ) => {
    page.drawText(sanitizeForPdf(value), {
      x: options.x ?? margin,
      y,
      size: options.size ?? 10,
      font: options.font ?? regular,
      color: options.color ?? ink,
    });
  };

  const rightText = (
    value: string,
    right: number,
    options: { size?: number; font?: typeof regular; color?: typeof ink } = {},
  ) => {
    const safe = sanitizeForPdf(value);
    const font = options.font ?? regular;
    const size = options.size ?? 10;
    page.drawText(safe, {
      x: right - font.widthOfTextAtSize(safe, size),
      y,
      size,
      font,
      color: options.color ?? ink,
    });
  };

  const rule = () => {
    page.drawLine({
      start: { x: margin, y: y },
      end: { x: width - margin, y: y },
      thickness: 0.75,
      color: line,
    });
  };

  /** Starts a new page when the cursor runs past the bottom margin. */
  const ensureSpace = (needed: number) => {
    if (y - needed > margin + 60) return;
    page = pdf.addPage([595.28, 841.89]);
    y = height - margin;
  };

  // Header
  text(data.storeName, { size: 20, font: bold });
  rightText('INVOICE', width - margin, { size: 20, font: bold });
  y -= 18;
  text(`${data.storeEmail}  ·  ${data.storePhone}`, { size: 9, color: muted });
  rightText(data.orderNumber, width - margin, { size: 11, font: bold });
  y -= 14;
  rightText(formatDate(data.placedAt), width - margin, { size: 9, color: muted });

  y -= 20;
  rule();
  y -= 24;

  // Parties
  text('BILL TO', { size: 8, font: bold, color: muted });
  text('DELIVER TO', { x: width / 2, size: 8, font: bold, color: muted });
  y -= 14;

  const billLines = [data.customerName, data.customerEmail, data.customerPhone];
  const shipLines = [
    data.shippingAddress.fullName,
    data.shippingAddress.line1,
    ...(data.shippingAddress.line2 ? [data.shippingAddress.line2] : []),
    `${data.shippingAddress.city}, ${data.shippingAddress.state}${
      data.shippingAddress.postalCode ? ` ${data.shippingAddress.postalCode}` : ''
    }`,
    data.shippingAddress.country,
  ];

  const partyRows = Math.max(billLines.length, shipLines.length);
  for (let i = 0; i < partyRows; i++) {
    if (billLines[i]) text(billLines[i], { size: 9.5 });
    if (shipLines[i]) text(shipLines[i], { x: width / 2, size: 9.5 });
    y -= 13;
  }

  y -= 12;
  rule();
  y -= 18;

  // Line item header
  text('DESCRIPTION', { size: 8, font: bold, color: muted });
  rightText('QTY', width - margin - 190, { size: 8, font: bold, color: muted });
  rightText('UNIT', width - margin - 100, { size: 8, font: bold, color: muted });
  rightText('AMOUNT', width - margin, { size: 8, font: bold, color: muted });
  y -= 8;
  rule();
  y -= 16;

  for (const item of data.items) {
    ensureSpace(70);

    text(item.productName, { size: 10, font: bold });
    rightText(String(item.quantity), width - margin - 190, { size: 10 });
    rightText(formatMoney(item.unitPrice, currency), width - margin - 100, { size: 10 });
    rightText(formatMoney(item.lineTotal, currency), width - margin, { size: 10 });
    y -= 13;

    const details = [item.variantName, `SKU ${item.sku}`].filter(Boolean).join('  ·  ');
    text(details, { size: 8.5, color: muted });
    y -= 12;

    /**
     * The measurement snapshot is printed on the invoice on purpose. It is the
     * customer's record of exactly what was made, and the workshop's reference
     * if a fit dispute comes up months later.
     */
    if (item.measurementSnapshot && item.measurementTemplate) {
      const summary = describeMeasurements(
        item.measurementTemplate as MeasurementTemplateKey,
        item.measurementSnapshot as Record<string, number>,
        item.measurementUnit === 'CM' ? 'CM' : 'INCH',
      );

      if (summary) {
        // Wrap by hand: pdf-lib draws a single line and will happily run off
        // the page edge otherwise.
        for (const chunk of wrap(`Measured: ${summary}`, 95)) {
          ensureSpace(20);
          text(chunk, { size: 8, color: muted });
          y -= 10;
        }
      }
    }

    y -= 8;
  }

  y -= 4;
  rule();
  y -= 18;

  // Totals
  const totalsRight = width - margin;
  const labelRight = totalsRight - 110;

  const totalRow = (label: string, value: string, emphasis = false) => {
    ensureSpace(24);
    rightText(label, labelRight, {
      size: emphasis ? 11 : 9.5,
      font: emphasis ? bold : regular,
      color: emphasis ? ink : muted,
    });
    rightText(value, totalsRight, { size: emphasis ? 11 : 9.5, font: emphasis ? bold : regular });
    y -= emphasis ? 18 : 14;
  };

  totalRow('Subtotal', formatMoney(data.subtotal, currency));
  if (data.discountTotal > 0) {
    totalRow(
      data.couponCode ? `Discount (${data.couponCode})` : 'Discount',
      `-${formatMoney(data.discountTotal, currency)}`,
    );
  }
  totalRow(
    'Delivery',
    data.shippingTotal === 0 ? 'Free' : formatMoney(data.shippingTotal, currency),
  );
  if (data.taxTotal > 0) {
    totalRow('Includes GST', formatMoney(data.taxTotal, currency));
  }
  totalRow('Total', formatMoney(data.grandTotal, currency), true);

  y -= 6;
  rightText(`${data.paymentMethod} · ${data.paymentStatus}`, totalsRight, {
    size: 9,
    color: muted,
  });

  // Footer
  y = margin + 34;
  rule();
  y -= 14;
  text('Made-to-measure garments are cut individually and cannot be resold. If the fit is wrong,', {
    size: 8,
    color: muted,
  });
  y -= 10;
  text('contact us within 7 days of delivery and we will alter or remake the piece.', {
    size: 8,
    color: muted,
  });

  return pdf.save();
}

/** Naive width-based wrapping — adequate for the fixed-width invoice columns. */
function wrap(input: string, maxChars: number): string[] {
  const words = input.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if ((current + ' ' + word).trim().length > maxChars) {
      if (current) lines.push(current.trim());
      current = word;
    } else {
      current = `${current} ${word}`;
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
}

/** An order row with its items, as loaded for invoicing. */
type InvoiceOrder = Prisma.OrderGetPayload<{ include: { items: true } }>;

/** The shipping address as frozen onto the order at checkout. */
interface InvoiceAddress {
  fullName: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode?: string | null;
  country: string;
}

/**
 * Invoice data for an order.
 *
 * Shared by the render-check job and the download endpoint, so the PDF a
 * customer downloads is built exactly the way the job proved it could be.
 */
export function invoiceDataFromOrder(order: InvoiceOrder): InvoiceData {
  // shippingSnapshot is Prisma.JsonValue, which includes arrays and scalars,
  // so it needs the two-step cast through unknown.
  const address = order.shippingSnapshot as unknown as InvoiceAddress;

  return {
    orderNumber: order.orderNumber,
    placedAt: order.placedAt,
    currency: order.currency,
    customerName: address.fullName,
    customerEmail: order.email,
    customerPhone: order.phone,
    shippingAddress: address,
    items: order.items.map((item) => ({
      productName: item.productName,
      variantName: item.variantName,
      sku: item.sku,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      measurementUnit: item.measurementUnit,
      measurementSnapshot: item.measurementSnapshot,
      measurementTemplate: item.measurementTemplate,
    })),
    subtotal: order.subtotal,
    discountTotal: order.discountTotal,
    shippingTotal: order.shippingTotal,
    taxTotal: order.taxTotal,
    grandTotal: order.grandTotal,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    couponCode: order.couponCode,
    storeName: 'MomiShop',
    storeEmail: 'hello@momishop.pk',
    storePhone: '+92 300 1234567',
  };
}
