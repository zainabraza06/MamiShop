import type { Metadata } from 'next';
import { Settings } from 'lucide-react';
import type { AdminSettings, AdminShippingZone } from '@momishop/shared/api-types';
import { formatMoney } from '@momishop/shared/money';
import { DeleteButton, RateForm, TaxRuleForm, ZoneForm } from '@/components/admin/settings-forms';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ApiError, apiGet } from '@/lib/api';

export const metadata: Metadata = { title: 'Settings' };

const rs = (minor: number) => formatMoney(minor, 'PKR');

/** Where a zone applies, in the words a shopper's address would use. */
function coverage(zone: AdminShippingZone): string {
  if (zone.cities.length > 0) return zone.cities.join(', ');
  if (zone.states.length > 0) return zone.states.join(', ');
  return 'Everywhere else in Pakistan';
}

export default async function AdminSettingsPage() {
  const settings = await apiGet<AdminSettings>('/admin/settings').catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 403) return null;
    throw error;
  });

  if (!settings) {
    return (
      <EmptyState
        icon={Settings}
        title="You cannot change store settings"
        description="Ask an admin to change delivery prices or tax."
      />
    );
  }

  const { zones, taxRules, canShipping, canTax } = settings;

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Settings</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Delivery and tax, exactly as checkout uses them. A change applies to the next price a
          shopper sees; orders already placed keep what they were charged.
        </p>
      </div>

      {canShipping && (
        <section aria-labelledby="delivery-heading" className="space-y-4">
          <div>
            <h2 id="delivery-heading" className="font-serif text-xl font-semibold">
              Delivery
            </h2>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              A shopper gets the zone that best matches their address: a city beats a province,
              which beats everywhere else. Each zone offers its own delivery options.
            </p>
          </div>

          {zones.map((zone) => {
            const activeRates = zone.rates.filter((rate) => rate.isActive).length;

            return (
              <Card key={zone.id} className={zone.isActive ? undefined : 'border-dashed'}>
                <CardHeader className="space-y-1">
                  <CardTitle as="h3" className="flex flex-wrap items-center gap-2">
                    {zone.name}
                    {!zone.isActive && <Badge variant="secondary">switched off</Badge>}
                    {zone.isActive && activeRates === 0 && (
                      <Badge variant="destructive">
                        no options — shoppers here cannot check out
                      </Badge>
                    )}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">{coverage(zone)}</p>
                </CardHeader>

                <CardContent className="space-y-4">
                  {zone.rates.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No delivery options yet.</p>
                  ) : (
                    <ul className="divide-y rounded-md border">
                      {zone.rates.map((rate) => (
                        <li key={rate.id} className="p-3">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <p className="font-medium">
                              {rate.name}
                              {!rate.isActive && (
                                <Badge variant="secondary" className="ms-2">
                                  not offered
                                </Badge>
                              )}
                            </p>
                            <p className="text-sm tabular-nums">
                              {rate.amount === 0 ? 'Free' : rs(rate.amount)}
                              {rate.freeAbove !== null && (
                                <span className="text-muted-foreground">
                                  {' '}
                                  · free over {rs(rate.freeAbove)}
                                </span>
                              )}
                            </p>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {rate.minDays}–{rate.maxDays} days
                            {rate.codSurcharge > 0 &&
                              ` · cash on delivery +${rs(rate.codSurcharge)}`}
                            {rate.description && ` · ${rate.description}`}
                          </p>

                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                              Edit {rate.name}
                            </summary>
                            <div className="mt-3 space-y-3">
                              <RateForm zoneId={zone.id} rate={rate} idPrefix={`rate-${rate.id}`} />
                              <DeleteButton
                                url={`/api/admin/shipping-rates/${rate.id}`}
                                name={rate.name}
                                confirmText={`Delete ${rate.name} from ${zone.name}?`}
                              />
                            </div>
                          </details>
                        </li>
                      ))}
                    </ul>
                  )}

                  <details>
                    <summary className="cursor-pointer text-sm font-medium">
                      Add a delivery option to {zone.name}
                    </summary>
                    <div className="mt-3">
                      <RateForm zoneId={zone.id} rate={null} idPrefix={`new-rate-${zone.id}`} />
                    </div>
                  </details>

                  <details>
                    <summary className="cursor-pointer text-sm font-medium">Edit zone</summary>
                    <div className="mt-3 space-y-3">
                      <ZoneForm zone={zone} idPrefix={`zone-${zone.id}`} />
                      <DeleteButton
                        url={`/api/admin/shipping-zones/${zone.id}`}
                        name={zone.name}
                        confirmText={`Delete the ${zone.name} zone and all its delivery options?`}
                      />
                    </div>
                  </details>
                </CardContent>
              </Card>
            );
          })}

          <Card>
            <CardHeader>
              <CardTitle as="h3">Add a delivery zone</CardTitle>
            </CardHeader>
            <CardContent>
              <ZoneForm zone={null} idPrefix="new-zone" />
            </CardContent>
          </Card>
        </section>
      )}

      {canTax && (
        <section aria-labelledby="tax-heading" className="space-y-4">
          <div>
            <h2 id="tax-heading" className="font-serif text-xl font-semibold">
              Tax
            </h2>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              One rule applies per tax class. A province rule replaces the national rule for
              shoppers in that province rather than adding to it.
            </p>
          </div>

          {taxRules.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tax rules. Checkout charges no tax.</p>
          ) : (
            <ul className="divide-y rounded-lg border bg-background">
              {taxRules.map((rule) => (
                <li key={rule.id} className="p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium">
                      {rule.name}
                      {!rule.isActive && (
                        <Badge variant="secondary" className="ms-2">
                          not applied
                        </Badge>
                      )}
                    </p>
                    <p className="text-sm tabular-nums">{(rule.rateBps / 100).toFixed(2)}%</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {rule.state ?? 'All of Pakistan'} · {rule.taxClass.toLowerCase()} ·{' '}
                    {rule.isInclusive ? 'included in prices' : 'added at checkout'}
                  </p>

                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                      Edit {rule.name}
                    </summary>
                    <div className="mt-3 space-y-3">
                      <TaxRuleForm rule={rule} idPrefix={`tax-${rule.id}`} />
                      <DeleteButton
                        url={`/api/admin/tax-rules/${rule.id}`}
                        name={rule.name}
                        confirmText={`Delete the ${rule.name} tax rule?`}
                      />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}

          <Card>
            <CardHeader>
              <CardTitle as="h3">Add a tax rule</CardTitle>
            </CardHeader>
            <CardContent>
              <TaxRuleForm rule={null} idPrefix="new-tax" />
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}
