'use client';

import * as React from 'react';
import { formatMoney } from '@momishop/shared/money';

/**
 * Revenue by day, as columns.
 *
 * One series, so one colour and no legend: the card title says what is
 * plotted. The colour is --chart-series-1, validated for charts, not the
 * brand clay, which reads as grey as a data colour. Every column carries its
 * own hover and keyboard tooltip, the hit area is the whole column rather than
 * the painted bar, and a table view holds every value, so nothing is only
 * readable by hovering.
 *
 * The axis stops at a round number above the largest day, with a gridline at
 * half of it. Only the first, middle and last dates are labelled; the rest are
 * in the tooltip and the table.
 */

export interface RevenuePoint {
  day: string;
  revenue: number;
  orders: number;
}

const rs = (minor: number) => formatMoney(minor, 'PKR');

const dayFormat = new Intl.DateTimeFormat('en-PK', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
/** Day strings are calendar days already; formatting them in UTC keeps them from shifting. */
const shortDay = (day: string) => dayFormat.format(new Date(`${day}T00:00:00Z`));

/** The smallest of 1, 2 or 5 times a power of ten that is at least `value`. */
function niceCeiling(value: number): number {
  if (value <= 0) return 100_00;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    if (step * power >= value) return step * power;
  }
  return 10 * power;
}

export function RevenueChart({ points }: { points: RevenuePoint[] }) {
  const [active, setActive] = React.useState<number | null>(null);

  const top = niceCeiling(Math.max(0, ...points.map((point) => point.revenue)));
  const last = points.length - 1;
  const labelled = [0, Math.floor(last / 2), last].filter(
    (index, position, all) => all.indexOf(index) === position,
  );
  const current = active === null ? null : points[active];

  /** Keeps the tooltip inside the plot near either edge. */
  const tooltipShift = (index: number) => {
    const fraction = (index + 0.5) / points.length;
    if (fraction < 0.2) return '0%';
    if (fraction > 0.8) return '-100%';
    return '-50%';
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[auto_1fr] gap-x-3">
        {/* Y axis: round values, top to bottom. */}
        <div className="flex h-56 flex-col justify-between text-end text-[11px] tabular-nums text-muted-foreground">
          <span className="-translate-y-1/2">{rs(top)}</span>
          <span>{rs(top / 2)}</span>
          <span className="translate-y-1/2">{rs(0)}</span>
        </div>

        <div className="relative h-56">
          {/* Hairline gridlines at the top, middle and baseline. */}
          <div aria-hidden="true" className="absolute inset-x-0 top-0 border-t border-border" />
          <div aria-hidden="true" className="absolute inset-x-0 top-1/2 border-t border-border" />
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 border-t border-foreground/25"
          />

          <ul className="absolute inset-0 flex items-end gap-[2px]" aria-label="Revenue by day">
            {points.map((point, index) => {
              const height = top > 0 ? (point.revenue / top) * 100 : 0;
              const isActive = active === index;

              return (
                <li key={point.day} className="flex h-full min-w-0 flex-1">
                  <button
                    type="button"
                    className="flex h-full w-full items-end justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`${shortDay(point.day)}: ${rs(point.revenue)} from ${point.orders} order${point.orders === 1 ? '' : 's'}`}
                    onPointerEnter={() => setActive(index)}
                    onPointerLeave={() =>
                      setActive((current) => (current === index ? null : current))
                    }
                    onFocus={() => setActive(index)}
                    onBlur={() => setActive((current) => (current === index ? null : current))}
                  >
                    <span
                      aria-hidden="true"
                      className={`block w-full max-w-6 rounded-t-[4px] transition-opacity ${
                        active !== null && !isActive ? 'opacity-60' : ''
                      }`}
                      style={{ height: `${height}%`, backgroundColor: 'var(--chart-series-1)' }}
                    />
                  </button>
                </li>
              );
            })}
          </ul>

          {current && active !== null && (
            <div
              role="status"
              className="pointer-events-none absolute top-0 z-10 rounded-md border bg-popover px-3 py-2 text-xs shadow-md"
              style={{
                left: `${((active + 0.5) / points.length) * 100}%`,
                transform: `translateX(${tooltipShift(active)}) translateY(calc(-100% - 6px))`,
              }}
            >
              <p className="text-sm font-semibold text-popover-foreground">{rs(current.revenue)}</p>
              <p className="whitespace-nowrap text-muted-foreground">
                {shortDay(current.day)} · {current.orders} order{current.orders === 1 ? '' : 's'}
              </p>
            </div>
          )}
        </div>

        {/* X axis: only the first, middle and last days are labelled. */}
        <div />
        <div className="relative mt-2 h-4 text-[11px] text-muted-foreground" aria-hidden="true">
          {labelled.map((index) => {
            const fraction = (index + 0.5) / points.length;
            const align = index === 0 ? 'start' : index === last ? 'end' : 'center';
            return (
              <span
                key={index}
                className="absolute whitespace-nowrap"
                style={
                  align === 'start'
                    ? { left: 0 }
                    : align === 'end'
                      ? { right: 0 }
                      : { left: `${fraction * 100}%`, transform: 'translateX(-50%)' }
                }
              >
                {shortDay(points[index].day)}
              </span>
            );
          })}
        </div>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
          Show as a table
        </summary>
        <div className="scroll-x mt-2 max-h-72 overflow-y-auto rounded-md border">
          <table className="w-full text-sm">
            <caption className="sr-only">Revenue and orders by day</caption>
            <thead>
              <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                <th scope="col" className="p-2 text-start font-medium">
                  Day
                </th>
                <th scope="col" className="p-2 text-end font-medium">
                  Revenue
                </th>
                <th scope="col" className="p-2 text-end font-medium">
                  Orders
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {points.map((point) => (
                <tr key={point.day}>
                  <td className="p-2">{shortDay(point.day)}</td>
                  <td className="p-2 text-end tabular-nums">{rs(point.revenue)}</td>
                  <td className="p-2 text-end tabular-nums">{point.orders}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
