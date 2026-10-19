import type { QueuedImport } from './documentImport';
import { EDIT_KIND_LABEL, type Entity, entityStartAt } from './editForms';
import { countLabel } from './formatting';
import { dateOnly, entityLabel, formatDateLabel, formatTime } from './tripModel';

// What reviewing an update will change, in the reader's terms — the times
// are what a delayed or rescheduled booking most often moves.
function timeChange(draft: QueuedImport, before: Entity): string | null {
  const start = entityStartAt(draft.kind, before);
  const after = entityStartAt(draft.kind, draft.entity);
  if (!start || !after || start === after) return null;
  const verb = draft.kind === 'transit' ? 'departs' : 'starts';
  return dateOnly(start) === dateOnly(after)
    ? `${verb} ${formatTime(start)} → ${formatTime(after)}`
    : `${verb} ${formatDateLabel(dateOnly(start))} ${formatTime(start)} → ${formatDateLabel(dateOnly(after))} ${formatTime(after)}`;
}

// One proposed change in the import panel: what it is, its date, booking and
// notes, and whether it updates an entry already on the itinerary (with what
// moves) or adds a new one.
export function importRowSummary(draft: QueuedImport, before: Entity | null) {
  const kindLabel = EDIT_KIND_LABEL[draft.kind];
  const start = entityStartAt(draft.kind, draft.entity);
  const booking = draft.bookings[0];
  const details = [
    start ? formatDateLabel(dateOnly(start)) : null,
    booking?.confirmationNumber ? `booking ${booking.confirmationNumber}` : null,
    booking?.status === 'requested' ? 'awaiting confirmation' : null,
    draft.notes.length ? `${countLabel(draft.notes.length, 'note')} to review` : null,
  ].filter(Boolean);
  return {
    title: `${kindLabel}: ${entityLabel(draft.kind, draft.entity)}`,
    details: details.join(' · '),
    effect: before
      ? {
          kind: 'updates' as const,
          label: entityLabel(draft.kind, before),
          changes: timeChange(draft, before),
        }
      : { kind: 'adds' as const, label: `Adds a new ${kindLabel.toLowerCase()}` },
  };
}
