'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { MessageCircle, Scissors, Send, X } from 'lucide-react';
import type { AssistantProduct, AssistantReply } from '@momishop/shared/api-types';
import { formatMoney, type Currency } from '@momishop/shared/money';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * The shopping assistant's chat button, on every storefront page.
 *
 * The conversation lives in this tab's sessionStorage and is sent back with
 * each question: there is nothing to store on the server, and closing the tab
 * forgets it. Hidden entirely when the API has no assistant configured.
 */

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  products?: AssistantProduct[];
  customRequest?: { summary: string } | null;
}

const STORAGE_KEY = 'momishop.assistant';
/** Matches the API's limit on how much history a question may carry. */
const MAX_HISTORY = 20;

const GREETING =
  'Assalam o alaikum! Ask me what we have in stock, prices, fabrics or delivery. English or Roman Urdu is fine.';

function loadTurns(): Turn[] {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Turn[]) : [];
  } catch {
    return [];
  }
}

function saveTurns(turns: Turn[]) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(turns.slice(-MAX_HISTORY)));
  } catch {
    // Private windows and blocked storage: the chat still works, it just
    // will not survive a page change.
  }
}

/** The recent turns, starting with a question as the API requires. */
function historyFor(turns: Turn[]) {
  const recent = turns.slice(-MAX_HISTORY);
  const start = recent.findIndex((turn) => turn.role === 'user');
  return start === -1 ? [] : recent.slice(start).map(({ role, content }) => ({ role, content }));
}

export function AssistantWidget({ isSignedIn }: { isSignedIn: boolean }) {
  const [enabled, setEnabled] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [draft, setDraft] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const launcherRef = React.useRef<HTMLButtonElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const endRef = React.useRef<HTMLDivElement>(null);

  // Storage is read only in the browser, after mount, so the server and
  // client render the same markup.
  React.useEffect(() => {
    let cancelled = false;
    fetch('/api/assistant/status')
      .then((response) => (response.ok ? response.json() : { enabled: false }))
      .then((data: { enabled?: boolean }) => {
        if (cancelled) return;
        setEnabled(Boolean(data.enabled));
        setTurns(loadTurns());
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [open, turns.length, pending]);

  function close() {
    setOpen(false);
    launcherRef.current?.focus();
  }

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    const question = draft.trim();
    if (!question || pending) return;

    const withQuestion: Turn[] = [...turns, { role: 'user', content: question }];
    setTurns(withQuestion);
    setDraft('');
    setError(null);
    setPending(true);

    try {
      const response = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: historyFor(withQuestion) }),
      });
      const data = (await response.json().catch(() => null)) as
        (AssistantReply & { error?: string }) | null;
      if (!response.ok || !data) {
        throw new Error(data?.error ?? 'The assistant could not answer just now.');
      }

      const answered: Turn[] = [
        ...withQuestion,
        {
          role: 'assistant',
          content: data.reply,
          products: data.products,
          customRequest: data.customRequest,
        },
      ];
      setTurns(answered);
      saveTurns(answered);
    } catch (caught) {
      // Put the question back so it can be sent again without retyping.
      setTurns(turns);
      setDraft(question);
      setError(
        caught instanceof Error ? caught.message : 'The assistant could not answer just now.',
      );
    } finally {
      setPending(false);
    }
  }

  function startOver() {
    setTurns([]);
    setError(null);
    saveTurns([]);
    inputRef.current?.focus();
  }

  if (!enabled) return null;

  const customRequestHref = isSignedIn
    ? '/account/custom-requests/new'
    : '/login?callbackUrl=/account/custom-requests/new';

  return (
    <>
      {!open && (
        <button
          ref={launcherRef}
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-lg transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <MessageCircle className="size-5" aria-hidden="true" />
          Ask us
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Shopping assistant"
          onKeyDown={(event) => {
            if (event.key === 'Escape') close();
          }}
          className="fixed bottom-4 right-4 z-40 flex h-[min(36rem,calc(100dvh-2rem))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border bg-background shadow-2xl"
        >
          <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
            <div>
              <p className="font-medium">Shopping assistant</p>
              <p className="text-xs text-muted-foreground">
                An AI that checks our live catalogue. It can make mistakes.
              </p>
            </div>
            <div className="flex items-center gap-1">
              {turns.length > 0 && (
                <Button type="button" size="sm" variant="ghost" onClick={startOver}>
                  Start over
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={close}
                aria-label="Close the assistant"
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite">
            <Bubble role="assistant">{GREETING}</Bubble>

            {turns.map((turn, index) => (
              <div key={index} className="space-y-2">
                <Bubble role={turn.role}>{turn.content}</Bubble>

                {turn.products && turn.products.length > 0 && (
                  <ul className="space-y-2">
                    {turn.products.map((product) => (
                      <li key={product.slug}>
                        <ProductLink product={product} />
                      </li>
                    ))}
                  </ul>
                )}

                {turn.customRequest && (
                  <div className="rounded-md border border-dashed p-3 text-sm">
                    <p className="text-muted-foreground">
                      We can make it for you, stitched to your measurements.
                    </p>
                    <Button asChild size="sm" className="mt-2">
                      <Link href={customRequestHref} onClick={() => setOpen(false)}>
                        <Scissors className="size-4" aria-hidden="true" />
                        Request a custom piece
                      </Link>
                    </Button>
                  </div>
                )}
              </div>
            ))}

            {pending && (
              <p className="text-sm text-muted-foreground" role="status">
                Checking the shop…
              </p>
            )}
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <div ref={endRef} />
          </div>

          <form onSubmit={ask} className="flex gap-2 border-t p-3">
            <label htmlFor="assistant-question" className="sr-only">
              Your question
            </label>
            <Input
              ref={inputRef}
              id="assistant-question"
              value={draft}
              maxLength={2000}
              autoComplete="off"
              placeholder="e.g. black abaya under Rs 8,000"
              onChange={(event) => setDraft(event.target.value)}
            />
            <Button type="submit" disabled={pending || !draft.trim()} aria-label="Send">
              <Send className="size-4" aria-hidden="true" />
            </Button>
          </form>
        </div>
      )}
    </>
  );
}

function Bubble({ role, children }: { role: Turn['role']; children: React.ReactNode }) {
  return (
    <p
      className={
        role === 'user'
          ? 'ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground'
          : 'w-fit max-w-[85%] whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm'
      }
    >
      <span className="sr-only">{role === 'user' ? 'You: ' : 'Assistant: '}</span>
      {children}
    </p>
  );
}

function ProductLink({ product }: { product: AssistantProduct }) {
  return (
    <Link
      href={`/products/${product.slug}`}
      className="flex items-center gap-3 rounded-md border p-2 text-sm transition hover:bg-muted"
    >
      <span className="relative block h-16 w-12 shrink-0 overflow-hidden rounded bg-muted">
        {product.imageUrl && (
          <Image
            src={product.imageUrl}
            alt={product.imageAlt ?? ''}
            fill
            sizes="48px"
            className="object-cover"
          />
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium">{product.name}</span>
        <span className="block">
          {formatMoney(product.price, product.currency as Currency)}
          {product.compareAtPrice && product.compareAtPrice > product.price && (
            <span className="ml-2 text-muted-foreground line-through">
              {formatMoney(product.compareAtPrice, product.currency as Currency)}
            </span>
          )}
        </span>
      </span>
    </Link>
  );
}
