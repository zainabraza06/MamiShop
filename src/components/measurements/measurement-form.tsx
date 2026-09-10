'use client';

import * as React from 'react';
import { Ruler } from 'lucide-react';
import {
  TEMPLATES,
  convertValues,
  fieldsFor,
  inchToCm,
  validateMeasurements,
  type MeasurementField,
  type MeasurementIssue,
  type MeasurementTemplateKey,
  type MeasurementUnitKey,
} from '@/lib/measurements';
import { MeasurementDiagram } from '@/components/measurements/measurement-diagram';
import { FormField, FormErrorSummary } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * The made-to-measure form.
 *
 * Three decisions worth stating:
 *
 * 1. The unit toggle CONVERTS the values already entered rather than just
 *    relabelling them. Switching from inches to centimetres with "36" left in
 *    the bust field would otherwise silently order a doll-sized garment.
 *
 * 2. Validation runs on blur, not on every keystroke. Validating while someone
 *    is still typing "3" of "36" flashes an out-of-range error at them for
 *    every single field, which teaches people to ignore the errors entirely.
 *
 * 3. The diagram highlights whichever field has focus. This is the difference
 *    between a form people abandon and one they can finish — "shoulder" is
 *    meaningless as a word and obvious as a picture.
 */

export interface MeasurementFormValue {
  unit: MeasurementUnitKey;
  values: Record<string, number>;
}

interface MeasurementFormProps {
  template: MeasurementTemplateKey;
  value: MeasurementFormValue;
  onChange: (next: MeasurementFormValue) => void;
  /** Reports validity upward so the parent can gate its submit button. */
  onValidityChange?: (isValid: boolean) => void;
  /** Server-side issues, merged with the client's own. */
  externalIssues?: MeasurementIssue[];
  /**
   * Set by the parent on submit to promote every latent issue to visible.
   * Until then errors appear only for fields the customer has already left.
   */
  revealErrors?: boolean;
  disabled?: boolean;
  className?: string;
}

export function MeasurementForm({
  template,
  value,
  onChange,
  onValidityChange,
  externalIssues = [],
  revealErrors = false,
  disabled,
  className,
}: MeasurementFormProps) {
  const definition = TEMPLATES[template];
  const fields = fieldsFor(template);

  // Raw strings, so a half-typed "3." survives a re-render instead of being
  // coerced to a number and snapping back.
  const [drafts, setDrafts] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(value.values).map(([k, v]) => [k, String(v)])),
  );
  const [touched, setTouched] = React.useState<Record<string, boolean>>({});
  const [activeRef, setActiveRef] = React.useState<string | null>(null);
  const [showAllErrors, setShowAllErrors] = React.useState(false);

  const validation = React.useMemo(
    () => validateMeasurements(template, drafts, value.unit),
    [template, drafts, value.unit],
  );

  React.useEffect(() => {
    onValidityChange?.(validation.ok);
  }, [validation.ok, onValidityChange]);

  const issueByField = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const issue of [...validation.issues, ...externalIssues]) {
      if (!map.has(issue.field)) map.set(issue.field, issue.message);
    }
    return map;
  }, [validation.issues, externalIssues]);

  /** Only surface an error once the field has been left, or on submit. */
  const errorFor = (key: string): string | null => {
    if (!showAllErrors && !touched[key]) return null;
    return issueByField.get(key) ?? null;
  };

  const commit = (nextDrafts: Record<string, string>, unit: MeasurementUnitKey) => {
    const result = validateMeasurements(template, nextDrafts, unit);
    onChange({ unit, values: result.normalised });
  };

  const handleFieldChange = (key: string, raw: string) => {
    const nextDrafts = { ...drafts, [key]: raw };
    setDrafts(nextDrafts);
    commit(nextDrafts, value.unit);
  };

  /**
   * Converts every entered value into the new unit. Blank fields stay blank —
   * converting "" would put a spurious 0 in an optional field.
   */
  const handleUnitChange = (nextUnit: MeasurementUnitKey) => {
    if (nextUnit === value.unit) return;

    const numeric: Record<string, number> = {};
    for (const [key, raw] of Object.entries(drafts)) {
      const n = Number(raw);
      if (raw !== '' && Number.isFinite(n)) numeric[key] = n;
    }

    const converted = convertValues(numeric, value.unit, nextUnit);
    const nextDrafts: Record<string, string> = {};
    for (const key of Object.keys(drafts)) {
      nextDrafts[key] = key in converted ? String(converted[key]) : '';
    }

    setDrafts(nextDrafts);
    commit(nextDrafts, nextUnit);
  };

  const suffix = value.unit === 'CM' ? 'cm' : 'in';

  // The parent flips `revealErrors` when its submit is pressed, which promotes
  // every latent issue to visible at once rather than field by field.
  React.useEffect(() => {
    if (revealErrors) setShowAllErrors(true);
  }, [revealErrors]);

  const summaryErrors = React.useMemo(
    () =>
      showAllErrors
        ? [...issueByField.entries()].map(([field, message]) => ({ field, message }))
        : [],
    [showAllErrors, issueByField],
  );

  if (fields.length === 0) {
    return (
      <p className={cn('text-sm text-muted-foreground', className)}>{definition.description}</p>
    );
  }

  return (
    <div className={cn('space-y-6', className)}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-prose">
          <h3 className="flex items-center gap-2 font-serif text-lg font-semibold">
            <Ruler className="size-4 text-primary" aria-hidden="true" />
            Your measurements
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{definition.description}</p>
        </div>

        <UnitToggle unit={value.unit} onChange={handleUnitChange} disabled={disabled} />
      </div>

      <FormErrorSummary errors={summaryErrors} />

      <div className="grid gap-8 lg:grid-cols-[1fr_auto]">
        <div className="space-y-8">
          {definition.groups.map((group) => (
            <fieldset key={group.title} className="space-y-4" disabled={disabled}>
              <legend className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {group.title}
              </legend>

              <div className="grid gap-4 sm:grid-cols-2">
                {group.fields.map((field) => (
                  <MeasurementInput
                    key={field.key}
                    field={field}
                    unit={value.unit}
                    suffix={suffix}
                    draft={drafts[field.key] ?? ''}
                    error={errorFor(field.key)}
                    onChange={(raw) => handleFieldChange(field.key, raw)}
                    onFocus={() => setActiveRef(field.diagramRef)}
                    onBlur={() => {
                      setTouched((t) => ({ ...t, [field.key]: true }));
                      setActiveRef(null);
                    }}
                  />
                ))}
              </div>
            </fieldset>
          ))}
        </div>

        {/* Sticky so the guide stays beside the field being filled in. */}
        <aside className="lg:sticky lg:top-24 lg:h-fit lg:w-[280px]">
          <div className="rounded-lg border bg-card p-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Where to measure
            </p>
            <MeasurementDiagram template={template} activeRef={activeRef} className="mx-auto" />
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Measure over light clothing, standing relaxed. Keep the tape snug but not tight — we
              add the ease for you.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function MeasurementInput({
  field,
  unit,
  suffix,
  draft,
  error,
  onChange,
  onFocus,
  onBlur,
}: {
  field: MeasurementField;
  unit: MeasurementUnitKey;
  suffix: string;
  draft: string;
  error: string | null;
  onChange: (raw: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const placeholder =
    unit === 'CM' ? String(inchToCm(field.placeholderInch)) : String(field.placeholderInch);

  return (
    <FormField
      label={field.label}
      id={field.key}
      required={field.required}
      error={error}
      hint={field.help}
    >
      {/*
        The Input must be FormField's DIRECT child: FormField clones it to attach
        the id and aria-describedby, so any wrapper here would receive them
        instead and leave the real input unlabelled. The unit suffix is
        therefore an Input prop rather than a sibling element.
      */}
      <Input
        // `inputMode="decimal"` gives phones a numeric keypad while still
        // allowing "36.5"; type="number" would add unwanted spinners and
        // swallow decimal separators on some Android keyboards.
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={draft}
        placeholder={placeholder}
        suffix={suffix}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
      />
    </FormField>
  );
}

function UnitToggle({
  unit,
  onChange,
  disabled,
}: {
  unit: MeasurementUnitKey;
  onChange: (unit: MeasurementUnitKey) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Label id="unit-toggle-label" className="text-xs text-muted-foreground">
        Units
      </Label>
      <div
        role="radiogroup"
        aria-labelledby="unit-toggle-label"
        className="inline-flex rounded-md border bg-muted p-0.5"
      >
        {(['INCH', 'CM'] as const).map((option) => {
          const selected = unit === option;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(option)}
              className={cn(
                'min-h-9 rounded px-4 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                selected
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option === 'INCH' ? 'Inches' : 'CM'}
            </button>
          );
        })}
      </div>
    </div>
  );
}
