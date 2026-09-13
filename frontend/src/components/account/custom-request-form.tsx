'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { CustomRequestOptions } from '@momishop/shared/api-types';
import { PhotoPicker } from '@/components/chat/photo-picker';
import { Button } from '@/components/ui/button';
import { FormErrorSummary, FormField } from '@/components/ui/form-field';
import { Input, Textarea } from '@/components/ui/input';
import { SelectField } from '@/components/ui/select-field';
import { PIECE_KINDS } from '@/lib/custom-requests';

/**
 * Asking for a piece the shop does not list.
 *
 * The description opens the conversation with the owner, so the form asks
 * for what a tailor needs to answer: what it is, how it should look, the
 * measurements to use, and when it is needed.
 */

type Issue = { field: string; message: string };

const NO_CHOICE = 'none';

export function CustomRequestForm({ options }: { options: CustomRequestOptions }) {
  const router = useRouter();
  const [title, setTitle] = React.useState('');
  const [kind, setKind] = React.useState(NO_CHOICE);
  const [description, setDescription] = React.useState('');
  const [profileId, setProfileId] = React.useState(NO_CHOICE);
  const [budget, setBudget] = React.useState('');
  const [neededBy, setNeededBy] = React.useState('');
  const [photos, setPhotos] = React.useState<string[]>([]);
  const [photosBusy, setPhotosBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Issue[]>([]);
  const [isPending, setIsPending] = React.useState(false);

  const errorFor = (field: string) => errors.find((error) => error.field === field)?.message;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsPending(true);
    setErrors([]);

    try {
      const response = await fetch('/api/custom-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          template: kind === NO_CHOICE ? undefined : kind,
          measurementProfileId: profileId === NO_CHOICE ? undefined : profileId,
          budget: budget ? Math.round(Number(budget) * 100) : undefined,
          neededBy: neededBy || undefined,
          attachments: photos,
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        request?: { id: string };
        error?: string;
        issues?: Issue[];
        details?: Issue[];
      } | null;

      if (!response.ok || !data?.request) {
        const issues = data?.issues ?? data?.details;
        if (Array.isArray(issues)) setErrors(issues);
        throw new Error(data?.error ?? 'Your request was not sent.');
      }

      toast.success('Request sent. We will reply here.');
      router.push(`/account/custom-requests/${data.request.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Your request was not sent.');
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <FormErrorSummary errors={errors} />

      <FormField
        label="What would you like made?"
        id="request-title"
        required
        hint="A short name, like “Maroon bridal lehnga” or “Eid frock for my daughter”."
        error={errorFor('title')}
      >
        <Input
          value={title}
          maxLength={120}
          onChange={(event) => setTitle(event.target.value)}
          required
        />
      </FormField>

      <SelectField
        label="Kind of piece"
        id="request-kind"
        value={kind}
        onValueChange={setKind}
        options={[{ value: NO_CHOICE, label: 'Not sure yet' }, ...PIECE_KINDS]}
      />

      <FormField
        label="Describe it"
        id="request-description"
        required
        hint="Fabric, colours, neckline, sleeves, embroidery, length — anything you have in mind."
        error={errorFor('description')}
      >
        <Textarea
          rows={7}
          maxLength={4000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          required
        />
      </FormField>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Reference photos</legend>
        <p className="text-xs text-muted-foreground">
          A screenshot or a photo of something similar helps us understand what you want.
        </p>
        <PhotoPicker
          photos={photos}
          onChange={setPhotos}
          enabled={options.uploadsEnabled}
          disabled={isPending}
          onBusyChange={setPhotosBusy}
        />
      </fieldset>

      {options.profiles.length > 0 ? (
        <SelectField
          label="Measurements to use"
          id="request-profile"
          value={profileId}
          onValueChange={setProfileId}
          options={[
            { value: NO_CHOICE, label: 'I will send them later' },
            ...options.profiles.map((profile) => ({ value: profile.id, label: profile.label })),
          ]}
          hint="We keep a copy with this request, so later edits to your profile do not change it."
          error={errorFor('measurementProfileId')}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          No saved measurements yet. You can send them in the conversation, or save a profile when
          you next order from the{' '}
          <Link href="/products" className="underline underline-offset-4">
            shop
          </Link>
          .
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Budget (Rs)"
          id="request-budget"
          hint="Optional. A guide for us, not a price."
          error={errorFor('budget')}
        >
          <Input
            inputMode="numeric"
            value={budget}
            onChange={(event) => setBudget(event.target.value.replace(/\D/g, ''))}
          />
        </FormField>
        <FormField
          label="Needed by"
          id="request-needed-by"
          hint="Optional."
          error={errorFor('neededBy')}
        >
          <Input
            type="date"
            value={neededBy}
            onChange={(event) => setNeededBy(event.target.value)}
          />
        </FormField>
      </div>

      <Button
        type="submit"
        size="lg"
        isLoading={isPending}
        loadingText="Sending"
        disabled={photosBusy}
      >
        Send request
      </Button>
    </form>
  );
}
