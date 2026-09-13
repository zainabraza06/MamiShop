'use client';

import * as React from 'react';
import Image from 'next/image';
import { toast } from 'sonner';
import { ImagePlus, X } from 'lucide-react';
import type { UploadSignature } from '@momishop/shared/api-types';
import { Button } from '@/components/ui/button';

/**
 * Attach photos to a request or a message.
 *
 * Files go straight from the browser to Cloudinary, using a signature the API
 * issues for one folder and image formats only. Only the resulting addresses
 * are sent with the message; the API then checks they are ours.
 */

const MAX_BYTES = 8 * 1024 * 1024;

async function uploadOne(file: File, signature: UploadSignature): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  form.append('api_key', signature.apiKey);
  form.append('timestamp', String(signature.timestamp));
  form.append('folder', signature.folder);
  form.append('allowed_formats', signature.allowedFormats);
  form.append('signature', signature.signature);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${signature.cloudName}/image/upload`,
    { method: 'POST', body: form },
  );
  const body = (await response.json().catch(() => null)) as {
    secure_url?: string;
    error?: { message?: string };
  } | null;

  if (!response.ok || !body?.secure_url) {
    throw new Error(body?.error?.message ?? `${file.name} could not be uploaded.`);
  }
  return body.secure_url;
}

export function PhotoPicker({
  photos,
  onChange,
  enabled,
  disabled,
  max = 6,
  onBusyChange,
}: {
  photos: string[];
  onChange: (photos: string[]) => void;
  /** Whether uploads are set up on the API. */
  enabled: boolean;
  disabled?: boolean;
  max?: number;
  onBusyChange?: (busy: boolean) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(0);

  if (!enabled) {
    return (
      <p className="text-xs text-muted-foreground">
        Photo uploads are not set up yet — describe the piece in words for now.
      </p>
    );
  }

  const remaining = max - photos.length;

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    const chosen = Array.from(files).slice(0, remaining);
    if (files.length > remaining) toast.error(`Up to ${max} photos at a time.`);

    const usable = chosen.filter((file) => {
      if (!file.type.startsWith('image/')) {
        toast.error(`${file.name} is not a photo.`);
        return false;
      }
      if (file.size > MAX_BYTES) {
        toast.error(`${file.name} is over 8 MB.`);
        return false;
      }
      return true;
    });
    if (usable.length === 0) return;

    setUploading(usable.length);
    onBusyChange?.(true);

    try {
      const response = await fetch('/api/uploads/signature', { method: 'POST' });
      const signature = (await response.json().catch(() => null)) as
        (UploadSignature & { error?: string }) | null;
      if (!response.ok || !signature) {
        throw new Error(signature?.error ?? 'Photos could not be uploaded right now.');
      }

      const uploaded: string[] = [];
      for (const file of usable) {
        try {
          uploaded.push(await uploadOne(file, signature));
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : `${file.name} could not be uploaded.`,
          );
        } finally {
          setUploading((count) => count - 1);
        }
      }
      if (uploaded.length > 0) onChange([...photos, ...uploaded]);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Photos could not be uploaded right now.',
      );
    } finally {
      setUploading(0);
      onBusyChange?.(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="space-y-2">
      {photos.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Photos to send">
          {photos.map((url, index) => (
            <li key={url} className="relative">
              <Image
                src={url}
                alt={`Photo ${index + 1}`}
                width={72}
                height={72}
                className="size-18 rounded-md border object-cover"
              />
              <button
                type="button"
                onClick={() => onChange(photos.filter((photo) => photo !== url))}
                className="absolute -end-2 -top-2 flex size-6 items-center justify-center rounded-full border bg-background shadow-sm"
                aria-label={`Remove photo ${index + 1}`}
                disabled={disabled}
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => void handleFiles(event.target.files)}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || remaining <= 0 || uploading > 0}
        isLoading={uploading > 0}
        loadingText="Uploading photos"
        onClick={() => inputRef.current?.click()}
      >
        <ImagePlus aria-hidden="true" />
        {uploading > 0 ? `Uploading ${uploading}…` : 'Add photos'}
      </Button>
    </div>
  );
}
