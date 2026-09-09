'use client';

import { cn } from '@/lib/utils';
import type { MeasurementTemplateKey } from '@/lib/measurements';

/**
 * Measuring guide.
 *
 * An inline SVG figure with a labelled line for each measurement. Drawn rather
 * than photographed for three reasons: it stays crisp at any size, it recolours
 * with the theme, and it adds no image request to a page that already loads
 * product photography.
 *
 * `activeRef` highlights the line matching the field the customer is currently
 * filling in, which is the whole point — "shoulder" means nothing until you can
 * see where the tape goes.
 *
 * The figure is `aria-hidden` because it is a redundant illustration: every
 * measurement already carries a text instruction in its field hint, which is
 * what a screen-reader user actually needs.
 */

interface DiagramProps {
  template: MeasurementTemplateKey;
  /** `diagramRef` of the focused field, e.g. "bust". */
  activeRef?: string | null;
  className?: string;
}

const ACTIVE = 'stroke-primary';
const IDLE = 'stroke-muted-foreground/40';
const LABEL_ACTIVE = 'fill-primary text-[7px] font-semibold';
const LABEL_IDLE = 'fill-muted-foreground/60 text-[7px]';

function line(active: boolean) {
  return cn('transition-colors duration-200', active ? ACTIVE : IDLE);
}

function label(active: boolean) {
  return cn('transition-colors duration-200', active ? LABEL_ACTIVE : LABEL_IDLE);
}

/** Shared body outline for the stitched-garment templates. */
function BodyFigure({ activeRef }: { activeRef?: string | null }) {
  const on = (ref: string) => activeRef === ref;

  return (
    <>
      {/* Silhouette */}
      <g className="fill-secondary stroke-border" strokeWidth="0.8">
        <circle cx="60" cy="16" r="9" />
        <path d="M45 30 Q60 25 75 30 L79 52 L74 54 L72 96 Q60 100 48 96 L46 54 L41 52 Z" />
        <path d="M45 30 L34 36 L30 66 L36 68 L41 40 Z" />
        <path d="M75 30 L86 36 L90 66 L84 68 L79 40 Z" />
        <path d="M48 96 L47 148 L55 148 L58 100 Z" />
        <path d="M72 96 L73 148 L65 148 L62 100 Z" />
      </g>

      {/* Shoulder */}
      <g>
        <line x1="43" y1="31" x2="77" y2="31" strokeWidth="1.2" className={line(on('shoulder'))} strokeDasharray="2 1.5" />
        <text x="60" y="27" textAnchor="middle" className={label(on('shoulder'))}>
          shoulder
        </text>
      </g>

      {/* Bust / chest */}
      <g>
        <ellipse cx="60" cy="46" rx="19" ry="4.5" fill="none" strokeWidth="1.2" className={line(on('bust'))} strokeDasharray="2 1.5" />
        <text x="94" y="47" textAnchor="start" className={label(on('bust'))}>
          bust
        </text>
      </g>

      {/* Waist */}
      <g>
        <ellipse cx="60" cy="66" rx="15" ry="4" fill="none" strokeWidth="1.2" className={line(on('waist'))} strokeDasharray="2 1.5" />
        <text x="94" y="67" textAnchor="start" className={label(on('waist'))}>
          waist
        </text>
      </g>

      {/* Hips */}
      <g>
        <ellipse cx="60" cy="88" rx="17" ry="4.5" fill="none" strokeWidth="1.2" className={line(on('hips'))} strokeDasharray="2 1.5" />
        <text x="94" y="89" textAnchor="start" className={label(on('hips'))}>
          hips
        </text>
      </g>

      {/* Armhole */}
      <g>
        <ellipse cx="40" cy="42" rx="6" ry="8" fill="none" strokeWidth="1.2" className={line(on('armhole'))} strokeDasharray="2 1.5" />
        <text x="14" y="38" textAnchor="start" className={label(on('armhole'))}>
          armhole
        </text>
      </g>

      {/* Shirt length */}
      <g>
        <line x1="24" y1="30" x2="24" y2="97" strokeWidth="1.2" className={line(on('shirt-length'))} />
        <line x1="21" y1="30" x2="27" y2="30" strokeWidth="1.2" className={line(on('shirt-length'))} />
        <line x1="21" y1="97" x2="27" y2="97" strokeWidth="1.2" className={line(on('shirt-length'))} />
        <text x="20" y="66" textAnchor="end" className={label(on('shirt-length'))}>
          shirt
        </text>
      </g>

      {/* Sleeve length */}
      <g>
        <line x1="88" y1="34" x2="92" y2="67" strokeWidth="1.2" className={line(on('sleeve-length'))} />
        <text x="96" y="30" textAnchor="start" className={label(on('sleeve-length'))}>
          sleeve
        </text>
      </g>

      {/* Sleeve opening */}
      <g>
        <line x1="84" y1="68" x2="90" y2="66" strokeWidth="1.6" className={line(on('sleeve-opening'))} />
        <text x="96" y="72" textAnchor="start" className={label(on('sleeve-opening'))}>
          cuff
        </text>
      </g>

      {/* Neck depths */}
      <g>
        <path d="M53 30 Q60 40 67 30" fill="none" strokeWidth="1.2" className={line(on('neck-front'))} />
        <text x="60" y="46" textAnchor="middle" className={label(on('neck-front'))}>
          neck
        </text>
      </g>

      {/* Trouser length */}
      <g>
        <line x1="100" y1="96" x2="100" y2="148" strokeWidth="1.2" className={line(on('trouser-length'))} />
        <line x1="97" y1="96" x2="103" y2="96" strokeWidth="1.2" className={line(on('trouser-length'))} />
        <line x1="97" y1="148" x2="103" y2="148" strokeWidth="1.2" className={line(on('trouser-length'))} />
        <text x="105" y="124" textAnchor="start" className={label(on('trouser-length'))}>
          trouser
        </text>
      </g>

      {/* Trouser waist */}
      <g>
        <ellipse cx="60" cy="97" rx="14" ry="3.5" fill="none" strokeWidth="1.2" className={line(on('trouser-waist'))} strokeDasharray="2 1.5" />
        <text x="24" y="100" textAnchor="end" className={label(on('trouser-waist'))}>
          t. waist
        </text>
      </g>

      {/* Thigh */}
      <g>
        <ellipse cx="53" cy="112" rx="7" ry="3" fill="none" strokeWidth="1.2" className={line(on('thigh'))} strokeDasharray="2 1.5" />
        <text x="24" y="115" textAnchor="end" className={label(on('thigh'))}>
          thigh
        </text>
      </g>

      {/* Bottom opening */}
      <g>
        <line x1="47" y1="148" x2="55" y2="148" strokeWidth="1.8" className={line(on('bottom-opening'))} />
        <text x="24" y="150" textAnchor="end" className={label(on('bottom-opening'))}>
          hem
        </text>
      </g>
    </>
  );
}

/** Abayas are cut loose and full-length, so they get their own outline. */
function AbayaFigure({ activeRef }: { activeRef?: string | null }) {
  const on = (ref: string) => activeRef === ref;

  return (
    <>
      <g className="fill-secondary stroke-border" strokeWidth="0.8">
        <circle cx="60" cy="16" r="9" />
        <path d="M44 30 Q60 25 76 30 L92 150 L28 150 Z" />
        <path d="M44 30 L30 38 L26 74 L34 76 L42 42 Z" />
        <path d="M76 30 L90 38 L94 74 L86 76 L78 42 Z" />
      </g>

      <g>
        <line x1="42" y1="31" x2="78" y2="31" strokeWidth="1.2" className={line(on('shoulder'))} strokeDasharray="2 1.5" />
        <text x="60" y="27" textAnchor="middle" className={label(on('shoulder'))}>
          shoulder
        </text>
      </g>

      <g>
        <ellipse cx="60" cy="48" rx="20" ry="4.5" fill="none" strokeWidth="1.2" className={line(on('bust'))} strokeDasharray="2 1.5" />
        <text x="97" y="49" textAnchor="start" className={label(on('bust'))}>
          bust
        </text>
      </g>

      <g>
        <ellipse cx="60" cy="80" rx="24" ry="5" fill="none" strokeWidth="1.2" className={line(on('hips'))} strokeDasharray="2 1.5" />
        <text x="97" y="81" textAnchor="start" className={label(on('hips'))}>
          hips
        </text>
      </g>

      <g>
        <line x1="18" y1="30" x2="18" y2="150" strokeWidth="1.2" className={line(on('abaya-length'))} />
        <line x1="15" y1="30" x2="21" y2="30" strokeWidth="1.2" className={line(on('abaya-length'))} />
        <line x1="15" y1="150" x2="21" y2="150" strokeWidth="1.2" className={line(on('abaya-length'))} />
        <text x="14" y="92" textAnchor="end" className={label(on('abaya-length'))}>
          length
        </text>
      </g>

      <g>
        <line x1="92" y1="36" x2="96" y2="75" strokeWidth="1.2" className={line(on('sleeve-length'))} />
        <text x="99" y="32" textAnchor="start" className={label(on('sleeve-length'))}>
          sleeve
        </text>
      </g>

      <g>
        <line x1="86" y1="76" x2="94" y2="74" strokeWidth="1.6" className={line(on('sleeve-opening'))} />
        <text x="99" y="80" textAnchor="start" className={label(on('sleeve-opening'))}>
          cuff
        </text>
      </g>
    </>
  );
}

export function MeasurementDiagram({ template, activeRef, className }: DiagramProps) {
  if (template === 'STOLE') return null;

  return (
    <svg
      viewBox="0 0 140 160"
      role="presentation"
      aria-hidden="true"
      focusable="false"
      className={cn('h-auto w-full max-w-[260px]', className)}
    >
      {template === 'ABAYA' ? (
        <AbayaFigure activeRef={activeRef} />
      ) : (
        <BodyFigure activeRef={activeRef} />
      )}
    </svg>
  );
}
