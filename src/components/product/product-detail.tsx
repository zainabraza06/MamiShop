'use client';

import * as React from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, Heart, Minus, Plus, ShoppingBag, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { MeasurementForm, type MeasurementFormValue } from '@/components/measurements/measurement-form';
import { formatMoney, type Currency } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { MeasurementTemplateKey, MeasurementUnitKey } from '@/lib/measurements';

/**
 * Product detail: gallery, variant picker, measurement capture, add to cart.
 *
 * The measurement step is inline rather than behind a modal. Made-to-measure
 * is the product here, not an upsell — hiding it behind a "customise" button
 * makes it feel optional and produces orders with no measurements attached.
 */

interface Variant {
  id: string;
  sku: string;
  kind: string;
  name: string;
  colorHex: string | null;
  priceDelta: number;
  trackInventory: boolean;
  stockOnHand: number;
  stockReserved: number;
}

interface ProductImage {
  id: string;
  url: string;
  alt: string;
  variantId: string | null;
}

interface SavedProfile {
  id: string;
  label: string;
  unit: string;
  values: unknown;
  isDefault: boolean;
}

interface ProductDetailProps {
  product: {
    id: string;
    slug: string;
    name: string;
    sku: string;
    basePrice: number;
    compareAtPrice: number | null;
    currency: string;
    shortDescription: string | null;
    description: string | null;
    careInstructions: string | null;
    fabric: string | null;
    pieces: string | null;
    stitchingDays: number;
    requiresMeasurements: boolean;
    ratingAverage: number;
    ratingCount: number;
    variants: Variant[];
    images: ProductImage[];
  };
  template: MeasurementTemplateKey;
  savedProfiles: SavedProfile[];
  isSignedIn: boolean;
}

export function ProductDetail({
  product,
  template,
  savedProfiles,
  isSignedIn,
}: ProductDetailProps) {
  const router = useRouter();
  const currency = product.currency as Currency;

  const [selectedVariantId, setSelectedVariantId] = React.useState<string | null>(
    product.variants[0]?.id ?? null,
  );
  const [quantity, setQuantity] = React.useState(1);
  const [activeImage, setActiveImage] = React.useState(0);
  const [note, setNote] = React.useState('');
  const [isPending, setIsPending] = React.useState(false);
  const [revealErrors, setRevealErrors] = React.useState(false);
  const [measurementsValid, setMeasurementsValid] = React.useState(!product.requiresMeasurements);

  const defaultProfile = savedProfiles.find((p) => p.isDefault) ?? savedProfiles[0];

  const [profileId, setProfileId] = React.useState<string | null>(defaultProfile?.id ?? null);
  const [measurements, setMeasurements] = React.useState<MeasurementFormValue>(() => ({
    unit: (defaultProfile?.unit as MeasurementUnitKey) ?? 'INCH',
    values: (defaultProfile?.values as Record<string, number>) ?? {},
  }));

  const selectedVariant = product.variants.find((v) => v.id === selectedVariantId) ?? null;
  const unitPrice = product.basePrice + (selectedVariant?.priceDelta ?? 0);

  const available = selectedVariant?.trackInventory
    ? selectedVariant.stockOnHand - selectedVariant.stockReserved
    : Number.POSITIVE_INFINITY;
  const isOutOfStock = available <= 0;

  // Show variant-specific photography when a variant has its own images.
  const gallery = React.useMemo(() => {
    const variantImages = selectedVariantId
      ? product.images.filter((i) => i.variantId === selectedVariantId)
      : [];
    const shared = product.images.filter((i) => i.variantId === null);
    return variantImages.length > 0 ? [...variantImages, ...shared] : shared;
  }, [product.images, selectedVariantId]);

  React.useEffect(() => {
    setActiveImage(0);
  }, [selectedVariantId]);

  /** Applies a saved measurement set, or clears back to a blank form. */
  function applyProfile(id: string | null) {
    setProfileId(id);
    if (!id) {
      setMeasurements({ unit: 'INCH', values: {} });
      return;
    }
    const profile = savedProfiles.find((p) => p.id === id);
    if (profile) {
      setMeasurements({
        unit: profile.unit as MeasurementUnitKey,
        values: profile.values as Record<string, number>,
      });
    }
  }

  async function handleAddToCart() {
    if (product.requiresMeasurements && !measurementsValid) {
      setRevealErrors(true);
      toast.error('Please check your measurements before adding to the bag.');
      // Send focus to the first problem rather than leaving the user hunting.
      document.getElementById('measurements-section')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    setIsPending(true);
    try {
      const response = await fetch('/api/cart/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: product.id,
          variantId: selectedVariantId ?? undefined,
          quantity,
          measurementProfileId: profileId ?? undefined,
          measurementUnit: product.requiresMeasurements ? measurements.unit : undefined,
          measurementValues: product.requiresMeasurements ? measurements.values : undefined,
          customNote: note || undefined,
        }),
      });

      const body = (await response.json().catch(() => null)) as
        | { error?: string; issues?: { message: string }[] }
        | null;

      if (!response.ok) {
        throw new Error(body?.issues?.[0]?.message ?? body?.error ?? 'Could not add to bag');
      }

      toast.success(`${product.name} added to your bag`, {
        action: { label: 'View bag', onClick: () => router.push('/cart') },
      });

      // Refresh so the header count reflects the new item.
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add to bag');
    } finally {
      setIsPending(false);
    }
  }

  async function handleWishlist() {
    if (!isSignedIn) {
      router.push(`/login?callbackUrl=/products/${product.slug}`);
      return;
    }
    try {
      const response = await fetch('/api/wishlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product.id }),
      });
      if (!response.ok) throw new Error('Could not update your wishlist');
      toast.success('Saved to your wishlist');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update your wishlist');
    }
  }

  const onSale = product.compareAtPrice !== null && product.compareAtPrice > unitPrice;

  return (
    <div className="mt-6 grid gap-10 lg:grid-cols-2 lg:gap-16">
      {/* Gallery */}
      <div className="space-y-4">
        <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-muted">
          {gallery[activeImage] ? (
            <Image
              src={gallery[activeImage].url}
              alt={gallery[activeImage].alt}
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No image available
            </div>
          )}
        </div>

        {gallery.length > 1 && (
          <ul className="grid grid-cols-5 gap-2">
            {gallery.map((image, index) => (
              <li key={image.id}>
                <button
                  type="button"
                  onClick={() => setActiveImage(index)}
                  aria-label={`View image ${index + 1} of ${gallery.length}`}
                  aria-current={index === activeImage}
                  className={cn(
                    'relative block aspect-square w-full overflow-hidden rounded-md border-2 transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    index === activeImage ? 'border-primary' : 'border-transparent',
                  )}
                >
                  <Image
                    src={image.url}
                    alt=""
                    fill
                    sizes="20vw"
                    className="object-cover"
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Buy panel */}
      <div>
        <h1 className="text-display font-semibold">{product.name}</h1>

        {product.ratingCount > 0 && (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            <Star className="size-4 fill-current text-warning" aria-hidden="true" />
            <span>
              {product.ratingAverage.toFixed(1)}
              <span className="sr-only"> out of 5</span>
            </span>
            <a href="#reviews" className="underline underline-offset-4">
              {product.ratingCount} review{product.ratingCount === 1 ? '' : 's'}
            </a>
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-baseline gap-3">
          <p className="font-serif text-2xl font-semibold">{formatMoney(unitPrice, currency)}</p>
          {onSale && (
            <>
              <span aria-hidden="true" className="text-base text-muted-foreground line-through">
                {formatMoney(product.compareAtPrice!, currency)}
              </span>
              <span className="sr-only">
                reduced from {formatMoney(product.compareAtPrice!, currency)}
              </span>
            </>
          )}
          <Badge variant="muted">Inclusive of all taxes</Badge>
        </div>

        {product.shortDescription && (
          <p className="mt-4 leading-relaxed text-muted-foreground">{product.shortDescription}</p>
        )}

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {product.fabric && (
            <>
              <dt className="text-muted-foreground">Fabric</dt>
              <dd className="font-medium">{product.fabric}</dd>
            </>
          )}
          {product.pieces && (
            <>
              <dt className="text-muted-foreground">Pieces</dt>
              <dd className="font-medium">{product.pieces}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Stitching time</dt>
          <dd className="font-medium">~{product.stitchingDays} working days</dd>
        </dl>

        {/* Variants */}
        {product.variants.length > 0 && (
          <fieldset className="mt-6">
            <legend className="text-sm font-medium">
              {product.variants[0].kind === 'COLOR' ? 'Colour' : 'Option'}
              {selectedVariant && (
                <span className="ms-1 text-muted-foreground">— {selectedVariant.name}</span>
              )}
            </legend>

            <div role="radiogroup" className="mt-3 flex flex-wrap gap-2">
              {product.variants.map((variant) => {
                const selected = variant.id === selectedVariantId;
                const soldOut =
                  variant.trackInventory && variant.stockOnHand - variant.stockReserved <= 0;

                return (
                  <button
                    key={variant.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={soldOut}
                    onClick={() => setSelectedVariantId(variant.id)}
                    className={cn(
                      'inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      selected ? 'border-primary bg-accent' : 'border-input hover:bg-accent',
                      soldOut && 'cursor-not-allowed opacity-40 line-through',
                    )}
                  >
                    {variant.colorHex && (
                      <span
                        aria-hidden="true"
                        style={{ backgroundColor: variant.colorHex }}
                        className="size-4 rounded-full border"
                      />
                    )}
                    {variant.name}
                    {selected && <Check className="size-3.5" aria-hidden="true" />}
                    {soldOut && <span className="sr-only"> (sold out)</span>}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}

        {/* Measurements */}
        {product.requiresMeasurements && (
          <div id="measurements-section" className="mt-8 rounded-lg border p-5">
            {savedProfiles.length > 0 && (
              <div className="mb-6">
                <p className="mb-2 text-sm font-medium">Use a saved measurement profile</p>
                <div className="flex flex-wrap gap-2">
                  {savedProfiles.map((profile) => (
                    <button
                      key={profile.id}
                      type="button"
                      onClick={() => applyProfile(profile.id)}
                      aria-pressed={profileId === profile.id}
                      className={cn(
                        'min-h-10 rounded-md border px-3 text-sm transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        profileId === profile.id
                          ? 'border-primary bg-accent'
                          : 'border-input hover:bg-accent',
                      )}
                    >
                      {profile.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => applyProfile(null)}
                    aria-pressed={profileId === null}
                    className={cn(
                      'min-h-10 rounded-md border px-3 text-sm transition-colors',
                      profileId === null
                        ? 'border-primary bg-accent'
                        : 'border-input hover:bg-accent',
                    )}
                  >
                    Enter new
                  </button>
                </div>
              </div>
            )}

            <MeasurementForm
              template={template}
              value={measurements}
              onChange={(next) => {
                setMeasurements(next);
                // Editing the numbers detaches the line from the saved profile,
                // so the profile is not silently overwritten later.
                setProfileId(null);
              }}
              onValidityChange={setMeasurementsValid}
              revealErrors={revealErrors}
            />

            <div className="mt-6">
              <FormField
                label="Anything else we should know?"
                hint="Optional — e.g. “please keep the sleeves a little loose”."
              >
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={300}
                  rows={2}
                  placeholder="Special instructions for our tailor"
                />
              </FormField>
            </div>
          </div>
        )}

        {/* Quantity + actions */}
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center rounded-md border">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              disabled={quantity <= 1}
              aria-label="Decrease quantity"
            >
              <Minus aria-hidden="true" />
            </Button>
            <span aria-live="polite" className="w-10 text-center text-sm font-medium">
              {quantity}
              <span className="sr-only"> items</span>
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setQuantity((q) => Math.min(20, available, q + 1))}
              disabled={quantity >= Math.min(20, available)}
              aria-label="Increase quantity"
            >
              <Plus aria-hidden="true" />
            </Button>
          </div>

          <Button
            size="lg"
            className="flex-1"
            onClick={handleAddToCart}
            isLoading={isPending}
            loadingText="Adding to your bag"
            disabled={isOutOfStock}
          >
            <ShoppingBag aria-hidden="true" />
            {isOutOfStock ? 'Sold out' : 'Add to bag'}
          </Button>

          <Button size="icon" variant="outline" onClick={handleWishlist} aria-label="Save to wishlist">
            <Heart aria-hidden="true" />
          </Button>
        </div>

        {selectedVariant?.trackInventory && available > 0 && available <= 3 && (
          <p role="status" className="mt-3 text-sm font-medium text-warning">
            Only {available} left in {selectedVariant.name}.
          </p>
        )}

        {/* Details */}
        {(product.description || product.careInstructions) && (
          <>
            <Separator className="my-8" />
            <div className="space-y-6">
              {product.description && (
                <section aria-labelledby="product-description">
                  <h2 id="product-description" className="font-serif text-lg font-semibold">
                    Details
                  </h2>
                  <p className="mt-2 whitespace-pre-line leading-relaxed text-muted-foreground">
                    {product.description}
                  </p>
                </section>
              )}

              {product.careInstructions && (
                <section aria-labelledby="care-instructions">
                  <h2 id="care-instructions" className="font-serif text-lg font-semibold">
                    Care
                  </h2>
                  <p className="mt-2 whitespace-pre-line leading-relaxed text-muted-foreground">
                    {product.careInstructions}
                  </p>
                </section>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
