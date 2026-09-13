'use client';

import * as React from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Send } from 'lucide-react';
import type { ChatMessage, CustomRequestStatus, MessagesSince } from '@momishop/shared/api-types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { isClosedRequest, messageTime } from '@/lib/custom-requests';
import { cn } from '@/lib/utils';
import { PhotoPicker } from './photo-picker';
import { QuoteCard } from './quote-card';

/**
 * The conversation about a custom request, used by the customer and the shop.
 *
 * New messages arrive by asking the API every few seconds while the tab is
 * visible. A live connection would be quicker, but on a free host that sleeps
 * when idle it drops without warning; a short poll just works, and costs one
 * small request.
 *
 * When the other side writes, the new message is announced to screen readers
 * and the list scrolls to it — unless the reader has scrolled up to reread
 * something, in which case their place is kept.
 */

const POLL_MS = 5000;

export function ChatThread({
  endpoint,
  viewer,
  initialMessages,
  status,
  uploadsEnabled,
  customerName,
}: {
  /** e.g. /api/custom-requests/<id> or /api/admin/custom-requests/<id> */
  endpoint: string;
  viewer: 'CUSTOMER' | 'STAFF';
  initialMessages: ChatMessage[];
  status: CustomRequestStatus;
  uploadsEnabled: boolean;
  /** Shown to staff as the customer's name. */
  customerName?: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = React.useState(initialMessages);
  const [body, setBody] = React.useState('');
  const [photos, setPhotos] = React.useState<string[]>([]);
  const [isSending, setIsSending] = React.useState(false);
  const [photosBusy, setPhotosBusy] = React.useState(false);
  const [announcement, setAnnouncement] = React.useState('');
  const listRef = React.useRef<HTMLOListElement>(null);
  const nearBottom = React.useRef(true);

  const closed = isClosedRequest(status);
  const latest = messages.at(-1)?.createdAt;

  const addMessages = React.useCallback((incoming: ChatMessage[]) => {
    if (incoming.length === 0) return;
    setMessages((current) => {
      const known = new Set(current.map((message) => message.id));
      const fresh = incoming.filter((message) => !known.has(message.id));
      return fresh.length > 0 ? [...current, ...fresh] : current;
    });
  }, []);

  // Poll while the page is visible.
  React.useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (document.visibilityState !== 'visible') return;
      try {
        const query = latest ? `?after=${encodeURIComponent(latest)}` : '';
        const response = await fetch(`${endpoint}/messages${query}`, { cache: 'no-store' });
        if (!response.ok || cancelled) return;
        const data = (await response.json()) as MessagesSince;

        const fromOthers = data.messages.filter((message) => message.authorRole !== viewer);
        addMessages(data.messages);
        if (fromOthers.length > 0) {
          setAnnouncement(
            viewer === 'CUSTOMER' ? 'New message from MomiShop' : 'New message from the customer',
          );
        }
        // A status change (declined, closed, reopened) redraws the page around the chat.
        if (data.status !== status) router.refresh();
      } catch {
        // A missed poll is retried on the next tick.
      }
    }

    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [endpoint, latest, status, viewer, addMessages, router]);

  // Follow new messages when the reader is already at the bottom.
  React.useEffect(() => {
    const list = listRef.current;
    if (list && nearBottom.current) list.scrollTop = list.scrollHeight;
  }, [messages.length]);

  async function handleSend(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim() && photos.length === 0) return;

    setIsSending(true);
    try {
      const response = await fetch(`${endpoint}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, attachments: photos }),
      });
      const data = (await response.json().catch(() => null)) as {
        message?: ChatMessage;
        error?: string;
        issues?: { message: string }[];
      } | null;

      if (!response.ok || !data?.message) {
        throw new Error(data?.issues?.[0]?.message ?? data?.error ?? 'Your message was not sent.');
      }

      nearBottom.current = true;
      addMessages([data.message]);
      setBody('');
      setPhotos([]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Your message was not sent.');
    } finally {
      setIsSending(false);
    }
  }

  const authorLabel = (message: ChatMessage) => {
    if (message.authorRole === viewer) return 'You';
    if (message.authorRole === 'STAFF') return message.authorName ?? 'MomiShop';
    return customerName ?? 'Customer';
  };

  return (
    <div className="flex flex-col rounded-lg border bg-card">
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <ol
        ref={listRef}
        className="flex max-h-[32rem] min-h-72 flex-col gap-4 overflow-y-auto p-4"
        aria-label="Conversation"
        onScroll={(event) => {
          const list = event.currentTarget;
          nearBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
        }}
      >
        {messages.map((message) => {
          if (message.authorRole === 'SYSTEM') {
            return (
              <li key={message.id} className="mx-auto max-w-md text-center">
                <p className="whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                  {message.body}
                </p>
                <time
                  dateTime={message.createdAt}
                  className="mt-1 block text-[11px] text-muted-foreground"
                >
                  {messageTime(message.createdAt)}
                </time>
              </li>
            );
          }

          const mine = message.authorRole === viewer;

          return (
            <li
              key={message.id}
              className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}
            >
              <p className="mb-1 text-xs text-muted-foreground">
                {authorLabel(message)} ·{' '}
                <time dateTime={message.createdAt}>{messageTime(message.createdAt)}</time>
              </p>
              <div
                className={cn(
                  'max-w-[85%] space-y-2 rounded-lg px-3 py-2 text-sm sm:max-w-[70%]',
                  mine ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
                )}
              >
                {message.body && <p className="whitespace-pre-wrap break-words">{message.body}</p>}
                {message.quote && (
                  <QuoteCard
                    quote={message.quote}
                    viewer={viewer}
                    requestId={endpoint.split('/').pop() ?? ''}
                    onChanged={() => undefined}
                  />
                )}
                {message.attachments.length > 0 && (
                  <ul className="flex flex-wrap gap-2">
                    {message.attachments.map((url, index) => (
                      <li key={url}>
                        <a href={url} target="_blank" rel="noreferrer" className="block">
                          <Image
                            src={url}
                            alt={`Photo ${index + 1} from ${authorLabel(message)}`}
                            width={140}
                            height={140}
                            className="size-32 rounded-md object-cover"
                          />
                          <span className="sr-only"> (opens full size in a new tab)</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="border-t p-4">
        {closed ? (
          <p className="text-sm text-muted-foreground">
            {viewer === 'CUSTOMER'
              ? 'This request is closed, so no more messages can be sent. Start a new request if you would like something else made.'
              : 'This request is closed. Reopen it to reply.'}
          </p>
        ) : (
          <form onSubmit={handleSend} className="space-y-3">
            <label htmlFor="chat-message" className="sr-only">
              Message
            </label>
            <Textarea
              id="chat-message"
              rows={3}
              value={body}
              maxLength={4000}
              placeholder={viewer === 'CUSTOMER' ? 'Write to MomiShop…' : 'Reply to the customer…'}
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={(event) => {
                // Ctrl or Cmd + Enter sends; plain Enter is a new line.
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div className="flex flex-wrap items-start justify-between gap-3">
              <PhotoPicker
                photos={photos}
                onChange={setPhotos}
                enabled={uploadsEnabled}
                disabled={isSending}
                onBusyChange={setPhotosBusy}
              />
              <Button
                type="submit"
                isLoading={isSending}
                loadingText="Sending"
                disabled={photosBusy || (!body.trim() && photos.length === 0)}
              >
                <Send aria-hidden="true" />
                Send
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
