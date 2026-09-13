import type { CustomRequestStatus } from '@momishop/shared/api-types';

/** How each status reads to a person, on both sides of the conversation. */
export const REQUEST_STATUS_LABELS: Record<CustomRequestStatus, string> = {
  OPEN: 'Open',
  QUOTED: 'Quote sent',
  ACCEPTED: 'Quote accepted',
  ORDERED: 'Ordered',
  DECLINED: 'Declined',
  CLOSED: 'Closed',
};

export const isClosedRequest = (status: CustomRequestStatus) =>
  status === 'CLOSED' || status === 'DECLINED';

/** The kinds of piece a request can be for, matching the measurement templates. */
export const PIECE_KINDS: { value: string; label: string }[] = [
  { value: 'WOMENS_STITCHED', label: 'Women’s outfit' },
  { value: 'ABAYA', label: 'Abaya' },
  { value: 'GIRLS_STITCHED', label: 'Girls’ outfit' },
  { value: 'BOYS_STITCHED', label: 'Boys’ outfit' },
  { value: 'STOLE', label: 'Stole or scarf' },
];

export const pieceKindLabel = (value: string | null) =>
  PIECE_KINDS.find((kind) => kind.value === value)?.label ?? 'Not specified';

/** Times in the shop's zone, so the server and browser render the same text. */
const timeFormat = new Intl.DateTimeFormat('en-PK', {
  timeZone: 'Asia/Karachi',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

export const messageTime = (iso: string) => timeFormat.format(new Date(iso));
