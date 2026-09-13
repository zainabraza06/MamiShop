'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import type {
  AdminCategory,
  AdminProductDetail,
  AdminStorefrontFilter,
} from '@momishop/shared/api-types';
import { MEASUREMENT_TEMPLATES } from '@momishop/shared/measurements';
import { slugify } from '@momishop/shared/text';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField, FormErrorSummary } from '@/components/ui/form-field';
import { Input, Textarea } from '@/components/ui/input';
import { SelectField } from '@/components/ui/select-field';

/**
 * The product editor, used for both new and existing pieces.
 *
 * Prices are entered in rupees and stored in paisa — money is an integer
 * everywhere behind this form, and this is the one place that converts.
 *
 * A variant is never deleted, only deactivated: order lines and stock ledger
 * rows point at it, and removing one would orphan an invoice.
 */

interface VariantDraft {
  id?: string;
  sku: string;
  name: string;
  kind: string;
  colorHex: string;
  priceDelta: string;
  stockOnHand: string;
  lowStockAlert: string;
  isActive: boolean;
  trackInventory: boolean;
}

interface ImageDraft {
  url: string;
  alt: string;
}

const VARIANT_KINDS = [
  { value: 'COLOR', label: 'Colour' },
  { value: 'FABRIC', label: 'Fabric' },
  { value: 'LENGTH', label: 'Length' },
  { value: 'STYLE', label: 'Style' },
  { value: 'BUNDLE', label: 'Bundle' },
];

const toMajor = (minor: number) => (minor / 100).toString();
const toMinor = (major: string) => Math.round(Number(major || '0') * 100);

function variantFrom(variant: AdminProductDetail['variants'][number]): VariantDraft {
  return {
    id: variant.id,
    sku: variant.sku,
    name: variant.name,
    kind: variant.kind,
    colorHex: variant.colorHex ?? '',
    priceDelta: toMajor(variant.priceDelta),
    stockOnHand: String(variant.stockOnHand),
    lowStockAlert: String(variant.lowStockAlert),
    isActive: variant.isActive,
    trackInventory: variant.trackInventory,
  };
}

export function ProductForm({
  product,
  categories,
  filters,
}: {
  product: AdminProductDetail | null;
  categories: AdminCategory[];
  filters: AdminStorefrontFilter[];
}) {
  const router = useRouter();
  const isNew = product === null;

  const [name, setName] = React.useState(product?.name ?? '');
  const [slug, setSlug] = React.useState(product?.slug ?? '');
  const [sku, setSku] = React.useState(product?.sku ?? '');
  const [categoryId, setCategoryId] = React.useState(
    product?.categoryId ?? categories[0]?.id ?? '',
  );
  const [status, setStatus] = React.useState(product?.status ?? 'DRAFT');
  const [basePrice, setBasePrice] = React.useState(product ? toMajor(product.basePrice) : '');
  const [compareAtPrice, setCompareAtPrice] = React.useState(
    product?.compareAtPrice ? toMajor(product.compareAtPrice) : '',
  );
  const [shortDescription, setShortDescription] = React.useState(product?.shortDescription ?? '');
  const [description, setDescription] = React.useState(product?.description ?? '');
  const [fabric, setFabric] = React.useState(product?.fabric ?? '');
  const [careInstructions, setCareInstructions] = React.useState(product?.careInstructions ?? '');
  const [stitchingDays, setStitchingDays] = React.useState(String(product?.stitchingDays ?? 7));
  const [requiresMeasurements, setRequiresMeasurements] = React.useState(
    product?.requiresMeasurements ?? true,
  );
  const [sizingTemplate, setSizingTemplate] = React.useState(product?.sizingTemplate ?? '');
  const [isFeatured, setIsFeatured] = React.useState(product?.isFeatured ?? false);
  const [isNewArrival, setIsNewArrival] = React.useState(product?.isNewArrival ?? false);

  const [variants, setVariants] = React.useState<VariantDraft[]>(
    product?.variants.map(variantFrom) ?? [],
  );
  const [images, setImages] = React.useState<ImageDraft[]>(
    product?.images.map((image) => ({ url: image.url, alt: image.alt })) ?? [],
  );

  const [filterOptionIds, setFilterOptionIds] = React.useState<string[]>(
    product?.filterOptionIds ?? [],
  );
  const customFilters = filters.filter((filter) => filter.kind === 'ATTRIBUTE');

  const [errors, setErrors] = React.useState<{ field: string; message: string }[]>([]);
  const [isPending, setIsPending] = React.useState(false);

  // A slug is a URL people share; it is derived while it has never been
  // edited, and left alone afterwards so an existing link cannot break.
  function handleName(value: string) {
    setName(value);
    if (isNew) setSlug(slugify(value));
  }

  function updateVariant(index: number, patch: Partial<VariantDraft>) {
    setVariants((current) =>
      current.map((variant, i) => (i === index ? { ...variant, ...patch } : variant)),
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsPending(true);
    setErrors([]);

    const payload = {
      name,
      slug,
      sku,
      categoryId,
      status,
      basePrice: toMinor(basePrice),
      // null, not undefined: an empty "Was" price has to reach the API to end a sale.
      compareAtPrice: compareAtPrice ? toMinor(compareAtPrice) : null,
      shortDescription: shortDescription || undefined,
      description: description || undefined,
      fabric: fabric || undefined,
      careInstructions: careInstructions || undefined,
      stitchingDays: Number(stitchingDays),
      requiresMeasurements,
      sizingTemplate: sizingTemplate || undefined,
      isFeatured,
      isNewArrival,
      tags: [],
      filterOptionIds,
      variants: variants.map((variant, index) => ({
        ...(variant.id ? { id: variant.id } : {}),
        sku: variant.sku,
        name: variant.name,
        kind: variant.kind,
        colorHex: variant.colorHex || undefined,
        priceDelta: toMinor(variant.priceDelta),
        position: index,
        stockOnHand: Number(variant.stockOnHand),
        lowStockAlert: Number(variant.lowStockAlert),
        isActive: variant.isActive,
        trackInventory: variant.trackInventory,
      })),
      images: images
        .filter((image) => image.url.trim())
        .map((image, index) => ({ url: image.url, alt: image.alt, position: index })),
    };

    try {
      const response = await fetch(
        isNew ? '/api/admin/products' : `/api/admin/products/${product.id}`,
        {
          method: isNew ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );

      const body = (await response.json().catch(() => null)) as {
        error?: string;
        issues?: { field: string; message: string }[];
        product?: { id: string };
      } | null;

      if (!response.ok) {
        if (body?.issues) setErrors(body.issues);
        throw new Error(body?.error ?? 'We could not save this product.');
      }

      toast.success(isNew ? 'Product created.' : 'Product saved.');

      /*
       * A new piece opens on its own page so the next edit is one click away.
       * An existing one stays where it is — being thrown back to the list
       * after every save makes a run of small corrections tedious.
       *
       * Only one of push/refresh runs: refreshing the page you are leaving
       * races the navigation away from it, and the navigation loses.
       */
      if (isNew && body?.product) {
        router.push(`/admin/products/${body.product.id}`);
      } else {
        router.refresh();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'We could not save this product.');
    } finally {
      setIsPending(false);
    }
  }

  const errorFor = (field: string) => errors.find((e) => e.field === field)?.message;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <FormErrorSummary errors={errors} />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle as="h2">The piece</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField label="Name" id="product-name" required error={errorFor('name')}>
                <Input value={name} onChange={(e) => handleName(e.target.value)} required />
              </FormField>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  label="Web address"
                  id="product-slug"
                  required
                  hint="Changing this breaks existing links."
                  error={errorFor('slug')}
                >
                  <Input value={slug} onChange={(e) => setSlug(e.target.value)} required />
                </FormField>

                <FormField label="SKU" id="product-sku" required error={errorFor('sku')}>
                  <Input value={sku} onChange={(e) => setSku(e.target.value)} required />
                </FormField>
              </div>

              <FormField
                label="Short description"
                id="product-short"
                hint="One line, shown on the product card."
                error={errorFor('shortDescription')}
              >
                <Input
                  value={shortDescription}
                  onChange={(e) => setShortDescription(e.target.value)}
                />
              </FormField>

              <FormField label="Description" id="product-description">
                <Textarea
                  rows={5}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </FormField>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Fabric" id="product-fabric">
                  <Input value={fabric} onChange={(e) => setFabric(e.target.value)} />
                </FormField>

                <FormField label="Care instructions" id="product-care">
                  <Input
                    value={careInstructions}
                    onChange={(e) => setCareInstructions(e.target.value)}
                  />
                </FormField>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle as="h2">Options</CardTitle>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setVariants((current) => [
                    ...current,
                    {
                      sku: `${sku || 'SKU'}-${current.length + 1}`,
                      name: '',
                      kind: 'COLOR',
                      colorHex: '',
                      priceDelta: '0',
                      stockOnHand: '0',
                      lowStockAlert: '3',
                      isActive: true,
                      trackInventory: true,
                    },
                  ])
                }
              >
                <Plus aria-hidden="true" />
                Add option
              </Button>
            </CardHeader>
            <CardContent>
              {variants.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No options — the piece is sold as one thing. Add colours or fabrics if it comes in
                  more than one.
                </p>
              ) : (
                <ul className="space-y-4">
                  {variants.map((variant, index) => (
                    <li key={variant.id ?? `new-${index}`} className="rounded-lg border p-4">
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <FormField label="Name" id={`variant-name-${index}`} required>
                          <Input
                            value={variant.name}
                            onChange={(e) => updateVariant(index, { name: e.target.value })}
                            required
                          />
                        </FormField>
                        <FormField label="SKU" id={`variant-sku-${index}`} required>
                          <Input
                            value={variant.sku}
                            onChange={(e) => updateVariant(index, { sku: e.target.value })}
                            required
                          />
                        </FormField>
                        <SelectField
                          label="Kind"
                          id={`variant-kind-${index}`}
                          value={variant.kind}
                          onValueChange={(value) => updateVariant(index, { kind: value })}
                          options={VARIANT_KINDS}
                        />
                        <FormField
                          label="Swatch colour"
                          id={`variant-color-${index}`}
                          hint="Hex, like #1B1B1B."
                        >
                          <Input
                            value={variant.colorHex}
                            placeholder="#1B1B1B"
                            onChange={(e) => updateVariant(index, { colorHex: e.target.value })}
                          />
                        </FormField>
                        <FormField label="Price difference" id={`variant-delta-${index}`}>
                          <Input
                            type="number"
                            step="1"
                            value={variant.priceDelta}
                            onChange={(e) => updateVariant(index, { priceDelta: e.target.value })}
                          />
                        </FormField>
                        <FormField label="In stock" id={`variant-stock-${index}`}>
                          <Input
                            type="number"
                            min="0"
                            value={variant.stockOnHand}
                            onChange={(e) => updateVariant(index, { stockOnHand: e.target.value })}
                          />
                        </FormField>
                      </div>

                      <label className="mt-3 flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={variant.isActive}
                          onChange={(e) => updateVariant(index, { isActive: e.target.checked })}
                          className="size-4 rounded border-input"
                        />
                        Available to buy
                        {variant.id && (
                          <span className="text-xs text-muted-foreground">
                            — uncheck to retire it; past orders keep working
                          </span>
                        )}
                      </label>

                      {!variant.id && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="mt-2"
                          onClick={() =>
                            setVariants((current) => current.filter((_, i) => i !== index))
                          }
                        >
                          <Trash2 aria-hidden="true" />
                          Remove
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle as="h2">Images</CardTitle>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setImages((current) => [...current, { url: '', alt: '' }])}
              >
                <Plus aria-hidden="true" />
                Add image
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {images.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No images yet. Paste a URL — uploads arrive with the Cloudinary integration.
                </p>
              )}
              {images.map((image, index) => (
                <div key={index} className="grid gap-3 sm:grid-cols-[2fr_2fr_auto]">
                  <FormField label="URL" id={`image-url-${index}`} hideLabel>
                    <Input
                      value={image.url}
                      placeholder="/products/example.webp"
                      onChange={(e) =>
                        setImages((current) =>
                          current.map((img, i) =>
                            i === index ? { ...img, url: e.target.value } : img,
                          ),
                        )
                      }
                    />
                  </FormField>
                  <FormField label="Alt text" id={`image-alt-${index}`} hideLabel>
                    <Input
                      value={image.alt}
                      required
                      placeholder="What the photo shows"
                      onChange={(e) =>
                        setImages((current) =>
                          current.map((img, i) =>
                            i === index ? { ...img, alt: e.target.value } : img,
                          ),
                        )
                      }
                    />
                  </FormField>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove image ${index + 1}`}
                    onClick={() => setImages((current) => current.filter((_, i) => i !== index))}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle as="h2">Shop filters</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {customFilters.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No custom filters yet.{' '}
                  <Link href="/admin/filters" className="underline underline-offset-4">
                    Create one
                  </Link>{' '}
                  — Occasion, say — and tick it here so shoppers can find this piece.
                </p>
              ) : (
                customFilters.map((filter) => (
                  <fieldset key={filter.id}>
                    <legend className="mb-2 text-sm font-medium">{filter.label}</legend>
                    {filter.options.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No options yet — add them under Filters.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-x-5 gap-y-1">
                        {filter.options.map((option) => (
                          <label
                            key={option.id}
                            className="flex min-h-9 cursor-pointer items-center gap-2 text-sm"
                          >
                            <input
                              type="checkbox"
                              className="size-4 rounded border-input accent-primary"
                              checked={filterOptionIds.includes(option.id)}
                              onChange={() =>
                                setFilterOptionIds((current) =>
                                  current.includes(option.id)
                                    ? current.filter((id) => id !== option.id)
                                    : [...current, option.id],
                                )
                              }
                            />
                            {option.label}
                          </label>
                        ))}
                      </div>
                    )}
                  </fieldset>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle as="h2">Publishing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <SelectField
                label="Status"
                id="product-status"
                value={status}
                onValueChange={(value) => setStatus(value as typeof status)}
                options={[
                  { value: 'DRAFT', label: 'Draft — not on the storefront' },
                  { value: 'ACTIVE', label: 'Live' },
                  { value: 'ARCHIVED', label: 'Archived' },
                ]}
              />

              <SelectField
                label="Category"
                id="product-category"
                required
                value={categoryId}
                onValueChange={setCategoryId}
                options={categories.map((category) => ({
                  value: category.id,
                  label: category.name,
                }))}
                error={errorFor('categoryId')}
              />

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isFeatured}
                  onChange={(e) => setIsFeatured(e.target.checked)}
                  className="size-4 rounded border-input"
                />
                Feature on the homepage
              </label>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isNewArrival}
                  onChange={(e) => setIsNewArrival(e.target.checked)}
                  className="size-4 rounded border-input"
                />
                Show as a new arrival
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">Price</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                label="Price (PKR)"
                id="product-price"
                required
                error={errorFor('basePrice')}
              >
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={basePrice}
                  onChange={(e) => setBasePrice(e.target.value)}
                  required
                />
              </FormField>

              <FormField
                label="Was (PKR)"
                id="product-compare"
                hint="Shown struck through, if higher."
              >
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={compareAtPrice}
                  onChange={(e) => setCompareAtPrice(e.target.value)}
                />
              </FormField>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">Making it</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                label="Stitching days"
                id="product-days"
                hint="Feeds the delivery estimate."
              >
                <Input
                  type="number"
                  min="0"
                  max="90"
                  value={stitchingDays}
                  onChange={(e) => setStitchingDays(e.target.value)}
                />
              </FormField>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={requiresMeasurements}
                  onChange={(e) => setRequiresMeasurements(e.target.checked)}
                  className="size-4 rounded border-input"
                />
                Made to the customer&apos;s measurements
              </label>

              {requiresMeasurements && (
                <SelectField
                  label="Sizing template"
                  id="product-template"
                  value={sizingTemplate}
                  onValueChange={setSizingTemplate}
                  placeholder="Inherit from the category"
                  options={MEASUREMENT_TEMPLATES.map((template) => ({
                    value: template,
                    label: template.replace(/_/g, ' ').toLowerCase(),
                  }))}
                  hint="Which measurements we ask for."
                />
              )}
            </CardContent>
          </Card>

          <Button type="submit" fullWidth size="lg" isLoading={isPending} loadingText="Saving">
            {isNew ? 'Create product' : 'Save changes'}
          </Button>
        </div>
      </div>
    </form>
  );
}
