'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import type {
  AdminShippingRate,
  AdminShippingZone,
  AdminTaxRule,
} from '@momishop/shared/api-types';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';

/**
 * Forms for delivery zones, delivery options and tax rules.
 *
 * Prices are entered in rupees and sent in paisa; tax is entered as a
 * percentage and sent in basis points (17% is 1700), the integer form the
 * checkout calculates with.
 */

const rupees = (minor: number | null | undefined) =>
  minor === null || minor === undefined ? '' : String(minor / 100);
const paisa = (value: string) => Math.round(Number(value || '0') * 100);
const decimal = (value: string) => value.replace(/[^\d.]/g, '');
const whole = (value: string) => value.replace(/\D/g, '');
const listFrom = (value: string) =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

async function send(url: string, method: string, body?: unknown): Promise<void> {
  const response = await fetch(url, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });

  if (!response.ok) {
    const parsed = (await response.json().catch(() => null)) as {
      error?: string;
      issues?: { message: string }[];
      details?: { message: string }[];
    } | null;
    throw new Error(
      parsed?.issues?.[0]?.message ??
        parsed?.details?.[0]?.message ??
        parsed?.error ??
        'That did not go through.',
    );
  }
}

function useSubmit() {
  const router = useRouter();
  const [isPending, setIsPending] = React.useState(false);

  async function submit(action: () => Promise<void>, success: string): Promise<boolean> {
    setIsPending(true);
    try {
      await action();
      toast.success(success);
      router.refresh();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That did not go through.');
      return false;
    } finally {
      setIsPending(false);
    }
  }

  return { isPending, submit };
}

function ActiveCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex min-h-9 items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="size-4 rounded border-input accent-primary"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

export function ZoneForm({ zone, idPrefix }: { zone: AdminShippingZone | null; idPrefix: string }) {
  const { isPending, submit } = useSubmit();
  const [name, setName] = React.useState(zone?.name ?? '');
  const [states, setStates] = React.useState(zone?.states.join(', ') ?? '');
  const [cities, setCities] = React.useState(zone?.cities.join(', ') ?? '');
  const [priority, setPriority] = React.useState(String(zone?.priority ?? 0));
  const [isActive, setIsActive] = React.useState(zone?.isActive ?? true);

  return (
    <form
      className="grid gap-4 md:grid-cols-2"
      onSubmit={async (event) => {
        event.preventDefault();
        const payload = {
          name,
          country: 'PK',
          states: listFrom(states),
          cities: listFrom(cities),
          priority: Number(priority || '0'),
          isActive,
        };
        const saved = await submit(
          () =>
            zone
              ? send(`/api/admin/shipping-zones/${zone.id}`, 'PATCH', payload)
              : send('/api/admin/shipping-zones', 'POST', payload),
          zone ? 'Delivery zone saved.' : `${name} added.`,
        );
        if (saved && !zone) {
          setName('');
          setStates('');
          setCities('');
          setPriority('0');
        }
      }}
    >
      <FormField label="Zone name" id={`${idPrefix}-name`} required>
        <Input value={name} onChange={(event) => setName(event.target.value)} required />
      </FormField>
      <FormField
        label="Priority"
        id={`${idPrefix}-priority`}
        hint="When two zones match equally, the higher number wins."
      >
        <Input
          inputMode="numeric"
          value={priority}
          onChange={(event) => setPriority(whole(event.target.value))}
        />
      </FormField>
      <FormField
        label="Provinces"
        id={`${idPrefix}-states`}
        hint="Separate with commas, e.g. Punjab, Sindh."
      >
        <Input value={states} onChange={(event) => setStates(event.target.value)} />
      </FormField>
      <FormField
        label="Cities"
        id={`${idPrefix}-cities`}
        hint="A city match beats a province match. Leave both empty for everywhere else in Pakistan."
      >
        <Input value={cities} onChange={(event) => setCities(event.target.value)} />
      </FormField>
      <div className="flex flex-wrap items-center justify-between gap-3 md:col-span-2">
        <ActiveCheckbox checked={isActive} onChange={setIsActive} label="Switched on" />
        <Button type="submit" isLoading={isPending} loadingText="Saving">
          {zone ? 'Save zone' : 'Add zone'}
        </Button>
      </div>
    </form>
  );
}

export function RateForm({
  zoneId,
  rate,
  idPrefix,
}: {
  zoneId: string;
  rate: AdminShippingRate | null;
  idPrefix: string;
}) {
  const { isPending, submit } = useSubmit();
  const [name, setName] = React.useState(rate?.name ?? '');
  const [description, setDescription] = React.useState(rate?.description ?? '');
  const [amount, setAmount] = React.useState(rupees(rate?.amount));
  const [freeAbove, setFreeAbove] = React.useState(rupees(rate?.freeAbove));
  const [codSurcharge, setCodSurcharge] = React.useState(
    rate && rate.codSurcharge > 0 ? rupees(rate.codSurcharge) : '',
  );
  const [minDays, setMinDays] = React.useState(String(rate?.minDays ?? 3));
  const [maxDays, setMaxDays] = React.useState(String(rate?.maxDays ?? 5));
  const [isActive, setIsActive] = React.useState(rate?.isActive ?? true);

  return (
    <form
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const payload = {
          name,
          description: description || undefined,
          amount: paisa(amount),
          freeAbove: freeAbove ? paisa(freeAbove) : null,
          codSurcharge: codSurcharge ? paisa(codSurcharge) : 0,
          minDays: Number(minDays || '0'),
          maxDays: Number(maxDays || '0'),
          isActive,
        };
        const saved = await submit(
          () =>
            rate
              ? send(`/api/admin/shipping-rates/${rate.id}`, 'PATCH', payload)
              : send(`/api/admin/shipping-zones/${zoneId}/rates`, 'POST', payload),
          rate ? 'Delivery option saved.' : `${name} added.`,
        );
        if (saved && !rate) {
          setName('');
          setDescription('');
          setAmount('');
          setFreeAbove('');
          setCodSurcharge('');
        }
      }}
    >
      <FormField label="Option name" id={`${idPrefix}-name`} required className="sm:col-span-2">
        <Input
          value={name}
          placeholder="Standard delivery"
          onChange={(event) => setName(event.target.value)}
          required
        />
      </FormField>
      <FormField label="Note for shoppers" id={`${idPrefix}-description`} className="sm:col-span-2">
        <Input
          value={description}
          placeholder="Tracked, by TCS"
          onChange={(event) => setDescription(event.target.value)}
        />
      </FormField>
      <FormField label="Price (Rs)" id={`${idPrefix}-amount`} required>
        <Input
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(decimal(event.target.value))}
          required
        />
      </FormField>
      <FormField label="Free over (Rs)" id={`${idPrefix}-free`} hint="Empty: never free.">
        <Input
          inputMode="decimal"
          value={freeAbove}
          onChange={(event) => setFreeAbove(decimal(event.target.value))}
        />
      </FormField>
      <FormField label="Cash on delivery extra (Rs)" id={`${idPrefix}-cod`}>
        <Input
          inputMode="decimal"
          value={codSurcharge}
          onChange={(event) => setCodSurcharge(decimal(event.target.value))}
        />
      </FormField>
      <div className="grid grid-cols-2 gap-2">
        <FormField label="From (days)" id={`${idPrefix}-min`}>
          <Input
            inputMode="numeric"
            value={minDays}
            onChange={(event) => setMinDays(whole(event.target.value))}
          />
        </FormField>
        <FormField label="To (days)" id={`${idPrefix}-max`}>
          <Input
            inputMode="numeric"
            value={maxDays}
            onChange={(event) => setMaxDays(whole(event.target.value))}
          />
        </FormField>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2 lg:col-span-4">
        <ActiveCheckbox checked={isActive} onChange={setIsActive} label="Offered at checkout" />
        <Button type="submit" isLoading={isPending} loadingText="Saving">
          {rate ? 'Save option' : 'Add option'}
        </Button>
      </div>
    </form>
  );
}

export function TaxRuleForm({ rule, idPrefix }: { rule: AdminTaxRule | null; idPrefix: string }) {
  const { isPending, submit } = useSubmit();
  const [name, setName] = React.useState(rule?.name ?? '');
  const [state, setState] = React.useState(rule?.state ?? '');
  const [taxClass, setTaxClass] = React.useState(rule?.taxClass ?? 'STANDARD');
  const [percent, setPercent] = React.useState(rule ? String(rule.rateBps / 100) : '');
  const [isInclusive, setIsInclusive] = React.useState(rule?.isInclusive ?? true);
  const [isActive, setIsActive] = React.useState(rule?.isActive ?? true);

  return (
    <form
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const payload = {
          name,
          country: 'PK',
          state: state.trim() || null,
          taxClass: taxClass.trim() || 'STANDARD',
          rateBps: Math.round(Number(percent || '0') * 100),
          isInclusive,
          isActive,
        };
        const saved = await submit(
          () =>
            rule
              ? send(`/api/admin/tax-rules/${rule.id}`, 'PATCH', payload)
              : send('/api/admin/tax-rules', 'POST', payload),
          rule ? 'Tax rule saved.' : `${name} added.`,
        );
        if (saved && !rule) {
          setName('');
          setState('');
          setPercent('');
        }
      }}
    >
      <FormField label="Rule name" id={`${idPrefix}-name`} required className="sm:col-span-2">
        <Input
          value={name}
          placeholder="Sales tax"
          onChange={(event) => setName(event.target.value)}
          required
        />
      </FormField>
      <FormField label="Rate (%)" id={`${idPrefix}-percent`} required>
        <Input
          inputMode="decimal"
          value={percent}
          onChange={(event) => setPercent(decimal(event.target.value))}
          required
        />
      </FormField>
      <FormField
        label="Tax class"
        id={`${idPrefix}-class`}
        hint="Products use STANDARD unless set otherwise."
      >
        <Input
          value={taxClass}
          onChange={(event) => setTaxClass(event.target.value.toUpperCase())}
        />
      </FormField>
      <FormField
        label="Province"
        id={`${idPrefix}-state`}
        hint="Empty for all of Pakistan. A province rule replaces the national one there."
        className="sm:col-span-2"
      >
        <Input value={state} onChange={(event) => setState(event.target.value)} />
      </FormField>
      <div className="flex flex-col justify-center gap-1 sm:col-span-2">
        <ActiveCheckbox
          checked={isInclusive}
          onChange={setIsInclusive}
          label="Already included in prices"
        />
        <ActiveCheckbox checked={isActive} onChange={setIsActive} label="Applied at checkout" />
      </div>
      <div className="sm:col-span-2 lg:col-span-4">
        <Button type="submit" isLoading={isPending} loadingText="Saving">
          {rule ? 'Save rule' : 'Add rule'}
        </Button>
      </div>
    </form>
  );
}

export function DeleteButton({
  url,
  name,
  confirmText,
}: {
  url: string;
  name: string;
  confirmText: string;
}) {
  const { isPending, submit } = useSubmit();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      isLoading={isPending}
      loadingText="Deleting"
      onClick={() => {
        if (!window.confirm(confirmText)) return;
        void submit(() => send(url, 'DELETE'), `${name} deleted.`);
      }}
    >
      <Trash2 aria-hidden="true" />
      Delete<span className="sr-only"> {name}</span>
    </Button>
  );
}
