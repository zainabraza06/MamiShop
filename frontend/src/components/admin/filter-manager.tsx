'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import type { AdminStorefrontFilter } from '@momishop/shared/api-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';

/**
 * Managing the storefront filter panel.
 *
 * Filters are reordered with move up/down buttons rather than drag and drop:
 * dragging is unusable from a keyboard or a screen reader, and with a handful
 * of filters two buttons are quicker anyway.
 *
 * Built-in filters can be renamed, hidden and moved but not deleted; their
 * choices come from product details, so there are no options to manage.
 */

async function call(url: string, method: string, body?: unknown): Promise<void> {
  const response = await fetch(url, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });

  if (!response.ok) {
    const parsed = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(parsed?.error ?? 'That did not go through.');
  }
}

const BUILT_IN_SOURCE: Record<string, string> = {
  COLOR: 'Choices come from each product’s colour options.',
  PRICE: 'A price range across the products in view.',
  FABRIC: 'Choices come from each product’s fabric.',
  FIT: 'Made to measure or ready-made, shown when a category has both.',
};

type Run = (key: string, action: () => Promise<void>, success: string) => Promise<boolean>;

export function FilterManager({ filters }: { filters: AdminStorefrontFilter[] }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);

  const run: Run = async (key, action, success) => {
    setBusy(key);
    try {
      await action();
      toast.success(success);
      router.refresh();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That did not go through.');
      return false;
    } finally {
      setBusy(null);
    }
  };

  function move(index: number, offset: -1 | 1) {
    const ids = filters.map((filter) => filter.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + offset, 0, moved);
    void run(
      `move-${moved}`,
      () => call('/api/admin/filters/order', 'PUT', { ids }),
      'Order saved.',
    );
  }

  return (
    <div className="space-y-6">
      <NewFilterForm run={run} busy={busy === 'create'} />

      <ol className="space-y-4" aria-label="Filters, in the order shoppers see them">
        {filters.map((filter, index) => {
          const isCustom = filter.kind === 'ATTRIBUTE';

          return (
            <li key={filter.id}>
              <Card className={filter.isVisible ? undefined : 'border-dashed'}>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                      <RenameForm
                        key={filter.label}
                        id={`filter-${filter.id}`}
                        fieldLabel={`Rename ${filter.label}`}
                        label={filter.label}
                        busy={busy === `rename-${filter.id}`}
                        onSave={(next) =>
                          run(
                            `rename-${filter.id}`,
                            () => call(`/api/admin/filters/${filter.id}`, 'PATCH', { label: next }),
                            'Filter renamed.',
                          )
                        }
                      />
                      <Badge variant="secondary">{isCustom ? 'custom' : 'built in'}</Badge>
                      {!filter.isVisible && <Badge variant="destructive">hidden</Badge>}
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Move ${filter.label} up`}
                        disabled={index === 0 || busy !== null}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Move ${filter.label} down`}
                        disabled={index === filters.length - 1 || busy !== null}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        isLoading={busy === `visible-${filter.id}`}
                        loadingText="Saving"
                        onClick={() =>
                          void run(
                            `visible-${filter.id}`,
                            () =>
                              call(`/api/admin/filters/${filter.id}`, 'PATCH', {
                                isVisible: !filter.isVisible,
                              }),
                            filter.isVisible
                              ? `${filter.label} is hidden from the shop.`
                              : `${filter.label} is shown in the shop.`,
                          )
                        }
                      >
                        {filter.isVisible ? (
                          <>
                            <EyeOff aria-hidden="true" />
                            Hide
                            <span className="sr-only"> {filter.label}</span>
                          </>
                        ) : (
                          <>
                            <Eye aria-hidden="true" />
                            Show
                            <span className="sr-only"> {filter.label}</span>
                          </>
                        )}
                      </Button>
                      {isCustom && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${filter.label}`}
                          disabled={busy !== null}
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Delete the ${filter.label} filter and all its options? Products lose these tags.`,
                              )
                            ) {
                              return;
                            }
                            void run(
                              `delete-${filter.id}`,
                              () => call(`/api/admin/filters/${filter.id}`, 'DELETE'),
                              `${filter.label} deleted.`,
                            );
                          }}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>

                <CardContent>
                  {isCustom ? (
                    <OptionsEditor filter={filter} run={run} busy={busy} />
                  ) : (
                    <p className="text-sm text-muted-foreground">{BUILT_IN_SOURCE[filter.kind]}</p>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function NewFilterForm({ run, busy }: { run: Run; busy: boolean }) {
  const [label, setLabel] = React.useState('');
  const [options, setOptions] = React.useState('');

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const name = label.trim();
    if (!name) return;

    const list = options
      .split(',')
      .map((option) => option.trim())
      .filter(Boolean);

    const created = await run(
      'create',
      () => call('/api/admin/filters', 'POST', { label: name, options: list }),
      `${name} created.`,
    );

    if (created) {
      setLabel('');
      setOptions('');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">New filter</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-[1fr_2fr]">
          <FormField label="Name" id="new-filter-label" required hint="For example, Occasion.">
            <Input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={40}
              required
            />
          </FormField>
          <FormField
            label="Options"
            id="new-filter-options"
            hint="Separate with commas, for example: Everyday, Eid, Wedding. You can add more later."
          >
            <Input value={options} onChange={(event) => setOptions(event.target.value)} />
          </FormField>
          <div className="md:col-span-2">
            <Button type="submit" isLoading={busy} loadingText="Creating">
              <Plus aria-hidden="true" />
              Create filter
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function RenameForm({
  id,
  fieldLabel,
  label,
  busy,
  onSave,
}: {
  id: string;
  fieldLabel: string;
  label: string;
  busy: boolean;
  onSave: (next: string) => Promise<boolean>;
}) {
  const [value, setValue] = React.useState(label);
  const next = value.trim();
  const changed = next.length > 0 && next !== label;

  return (
    <form
      className="flex min-w-0 flex-1 items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (changed) void onSave(next);
      }}
    >
      <FormField label={fieldLabel} id={id} hideLabel className="min-w-0 flex-1 space-y-0">
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          maxLength={40}
          className="font-medium"
        />
      </FormField>
      {changed && (
        <Button type="submit" size="sm" isLoading={busy} loadingText="Saving">
          Save
        </Button>
      )}
    </form>
  );
}

function OptionsEditor({
  filter,
  run,
  busy,
}: {
  filter: AdminStorefrontFilter;
  run: Run;
  busy: string | null;
}) {
  const [label, setLabel] = React.useState('');

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    const next = label.trim();
    if (!next) return;

    const added = await run(
      `add-${filter.id}`,
      () => call(`/api/admin/filters/${filter.id}/options`, 'POST', { label: next }),
      `${next} added.`,
    );
    if (added) setLabel('');
  }

  return (
    <div className="space-y-3">
      {filter.options.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No options yet. A filter with no options is not shown in the shop.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {filter.options.map((option) => (
            <li key={option.id} className="flex flex-wrap items-center gap-2 p-2">
              <RenameForm
                key={option.label}
                id={`option-${option.id}`}
                fieldLabel={`Rename ${option.label}`}
                label={option.label}
                busy={busy === `rename-${option.id}`}
                onSave={(next) =>
                  run(
                    `rename-${option.id}`,
                    () => call(`/api/admin/filter-options/${option.id}`, 'PATCH', { label: next }),
                    'Option renamed.',
                  )
                }
              />
              <span className="text-xs tabular-nums text-muted-foreground">
                {option.productCount} product{option.productCount === 1 ? '' : 's'}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Delete ${option.label}`}
                disabled={busy !== null}
                onClick={() => {
                  const warning =
                    option.productCount > 0
                      ? `Delete ${option.label}? It is ticked on ${option.productCount} product${option.productCount === 1 ? '' : 's'} and will be removed from them.`
                      : `Delete ${option.label}?`;
                  if (!window.confirm(warning)) return;

                  void run(
                    `delete-${option.id}`,
                    () => call(`/api/admin/filter-options/${option.id}`, 'DELETE'),
                    `${option.label} deleted.`,
                  );
                }}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleAdd} className="flex gap-2">
        <FormField
          label={`New option for ${filter.label}`}
          id={`new-option-${filter.id}`}
          hideLabel
          className="flex-1"
        >
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Add an option"
            maxLength={40}
          />
        </FormField>
        <Button
          type="submit"
          variant="outline"
          isLoading={busy === `add-${filter.id}`}
          loadingText="Adding"
        >
          <Plus aria-hidden="true" />
          Add
        </Button>
      </form>
    </div>
  );
}
