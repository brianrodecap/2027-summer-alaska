import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

import { setStoredApiKey } from '../../config/aiKey';
import { DOCUMENT_ACCEPT, importErrorMessage, type QueuedImport } from '../../model/documentImport';
import { EDIT_KIND_LABEL, type Entity, entityStartAt, findByKind } from '../../model/editForms';
import { importByProposals, type ProposalImport } from '../../model/proposalImport';
import { dateOnly, entityLabel, formatDateLabel, formatTime } from '../../model/tripModel';
import type { TripData } from '../../model/types';
import type { DraftReview } from '../../state/EditContextObject';
import type { NoteDraft } from '../../state/NoteEditContextObject';
import { useEdit } from '../../state/useEdit';
import { useNoteEdit } from '../../state/useNoteEdit';
import { useTripData } from '../../state/useTripData';

// Wraps a drafted entity's own notes (if any) into the onSaved this panel's
// draft sequence needs — see EditContext's own note on why onSaved has to
// take and eventually call `advance` itself, rather than the queue moving
// on right away: two dialogs (this entity's next sibling, and
// NoteEditDialog) must never be open at once. A draft with nothing
// noteworthy just gets `undefined`, so the queue advances immediately.
function withNoteFollowUp(
  notes: NoteDraft[],
  openNoteDraftSequence: (drafts: NoteDraft[], onComplete?: () => void) => void,
): ((advance: () => void) => void) | undefined {
  if (!notes.length) return undefined;
  return (advance) => openNoteDraftSequence(notes, advance);
}

function existingEntry(data: TripData, draft: QueuedImport): Entity | null {
  return draft.overrideId ? (findByKind(draft.kind, draft.overrideId, data) ?? null) : null;
}

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

// One proposed change: what it is, whether it updates an entry already on
// the itinerary or adds a new one, and the AI's own reason for it.
export function ImportEntryRow({ draft, before }: { draft: QueuedImport; before: Entity | null }) {
  const kindLabel = EDIT_KIND_LABEL[draft.kind];
  const start = entityStartAt(draft.kind, draft.entity);
  const changes = before ? timeChange(draft, before) : null;
  const booking = draft.bookings[0];
  const details = [
    start ? formatDateLabel(dateOnly(start)) : null,
    booking?.confirmationNumber ? `booking ${booking.confirmationNumber}` : null,
    booking?.status === 'requested' ? 'awaiting confirmation' : null,
    draft.notes.length
      ? `${draft.notes.length} note${draft.notes.length > 1 ? 's' : ''} to review`
      : null,
  ].filter(Boolean);
  return (
    <Box sx={{ p: 1.5, borderRadius: 1, bgcolor: 'action.hover' }}>
      <Typography variant="subtitle2">
        {kindLabel}: {entityLabel(draft.kind, draft.entity)}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {details.join(' · ')}
      </Typography>
      <Typography variant="body2">
        {before ? (
          <>
            Updates <strong>{entityLabel(draft.kind, before)}</strong>
            {changes ? ` · ${changes}` : ''}
          </>
        ) : (
          `Adds a new ${kindLabel.toLowerCase()}`
        )}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {draft.why}
      </Typography>
    </Box>
  );
}

interface ImportDocumentPanelProps {
  apiKey: string;
  onClose: () => void;
}

// The trip assistant's document import (src/components/assistant/AssistantPanel.tsx,
// behind its paperclip button). Uploads a booking document (a PDF, a photo,
// or a saved email) and has the AI propose what it changes on the itinerary
// (src/model/proposalImport.ts): which placeholder each booking confirms,
// what's new, and why. Every proposal has already passed the trip's checks
// (src/model/proposals.ts); each opens for review one at a time through
// EditContext's openDraftSequence, where any can be skipped. This panel
// never commits anything itself.
export function ImportDocumentPanel({ apiKey, onClose }: ImportDocumentPanelProps) {
  const { openDraftSequence } = useEdit();
  const { openNoteDraftSequence } = useNoteEdit();
  const { data, view } = useTripData();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ProposalImport | null>(null);
  // The trip the import was read against; if it changes before the review
  // opens, the drafts are stale and must be read again.
  const [readAgainst, setReadAgainst] = useState<typeof data>(null);
  // Each update's entry as it stood when the import read it, so the summary
  // keeps saying what changes however the trip moves while it's open.
  const [before, setBefore] = useState<ReadonlyMap<string, Entity | null>>(new Map());

  const handleExtract = async () => {
    if (!file || !apiKey.trim() || !data || !view) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      setStoredApiKey(apiKey.trim());
      const imported = await importByProposals(file, apiKey.trim(), data, view);
      setBefore(new Map(imported.queue.map((d) => [d.entity._id, existingEntry(data, d)])));
      setReadAgainst(data);
      setResult(imported);
    } catch (err) {
      setErrorMessage(importErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = () => {
    if (!result) return;
    // Any change to the trip means a re-read, however unrelated (a reviewed
    // false positive): the drafts' ids, bookings and checks were made against
    // exactly this data, and a narrower test could pass a draft that no longer fits.
    if (data !== readAgainst) {
      setResult(null);
      setErrorMessage(
        'The trip changed since this document was read. Read it again to review against the latest.',
      );
      return;
    }
    const drafts = result.queue.map(({ notes, ...draft }): DraftReview => ({
      ...draft,
      onSaved: withNoteFollowUp(notes, openNoteDraftSequence),
      source: 'ai-import',
    }));
    openDraftSequence(drafts);
    onClose();
  };

  const handleFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0] ?? null);
    setResult(null);
    setErrorMessage(null);
  };

  const handleDownloadOriginal = () => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    // Revoked later: Safari cancels the download if the URL goes away first.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const reviewCount = result?.queue.length ?? 0;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography variant="subtitle2">Add from a document</Typography>
      {errorMessage && (
        <Alert severity="error" onClose={() => setErrorMessage(null)}>
          {errorMessage}
        </Alert>
      )}
      {file && (
        <Typography variant="body2" color="text.secondary">
          Selected: {file.name}
        </Typography>
      )}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button
          variant="outlined"
          component="label"
          disabled={loading}
          sx={{ alignSelf: 'flex-start' }}
        >
          Choose a file
          <input type="file" hidden accept={DOCUMENT_ACCEPT} onChange={handleFileChosen} />
        </Button>
        {!result && (
          <Button
            variant="contained"
            onClick={handleExtract}
            disabled={!file || !apiKey.trim() || loading}
            sx={{ alignSelf: 'flex-start' }}
          >
            {loading ? <CircularProgress size={20} /> : 'Read it'}
          </Button>
        )}
      </Box>
      {loading && (
        <Typography variant="body2" color="text.secondary">
          Reading the document against your itinerary — this takes about half a minute.
        </Typography>
      )}
      {result && data && (
        <Stack spacing={1}>
          <Typography variant="subtitle2">
            {reviewCount} change{reviewCount === 1 ? '' : 's'} to review
          </Typography>
          {result.queue.map((draft) => (
            <ImportEntryRow
              key={draft.entity._id}
              draft={draft}
              before={before.get(draft.entity._id) ?? null}
            />
          ))}
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button size="small" onClick={handleDownloadOriginal}>
              Download original file
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={handleContinue}
              disabled={!reviewCount}
            >
              Review {reviewCount === 1 ? 'it' : `all ${reviewCount}`}
            </Button>
          </Box>
        </Stack>
      )}
    </Box>
  );
}
