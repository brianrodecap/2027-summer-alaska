import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

import { setStoredApiKey } from '../../config/aiKey';
import {
  DocumentImportError,
  draftEntityFromExtraction,
  draftIncludedTransfers,
  type ExtractedFields,
  extractEntityFromDocument,
  findConflictCandidate,
  notesFromExtraction,
  type ResolvedPlaces,
  resolveLegAndDateForFields,
  resolvePlacesForFields,
} from '../../model/documentImport';
import { COLLECTION_FOR_KIND, type EditKind, entityLabel } from '../../model/editForms';
import { formatDateLabel } from '../../model/tripModel';
import type { Activity, Stay, Transit } from '../../model/types';
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

const KIND_LABEL: Record<EditKind, string> = {
  activity: 'Activity',
  stay: 'Stay',
  transit: 'Transit',
};

function collectionFor(
  kind: EditKind,
  data: ReturnType<typeof useTripData>['data'],
): (Activity | Stay | Transit)[] {
  return data ? (data[COLLECTION_FOR_KIND[kind]] as (Activity | Stay | Transit)[]) : [];
}

interface ImportDocumentPanelProps {
  apiKey: string;
  onClose: () => void;
}

type Status = 'idle' | 'loading' | 'error' | 'success';

// The document-import half of AskAIDialog (src/components/day/AskAIDialog.tsx —
// the two sit in one dialog, not behind tabs). Uploads a booking document (PDF
// or photo), sends it to the Anthropic API for extraction
// (src/model/documentImport.ts), and hands the result to EditContext's
// openFromDraft — which opens the same EditDialog a manual "Add" uses,
// pre-filled, for human review before Save. This panel never commits
// anything itself.
//
// Launched trip-wide rather than from a specific day's "Add to this day" menu, so
// there's no legId/date already in hand the way there used to be —
// resolveLegAndDateForFields figures out which day (and Leg) the extracted document's
// own date falls on instead, once extraction has actually returned one.
export function ImportDocumentPanel({ apiKey, onClose }: ImportDocumentPanelProps) {
  const { openDraftSequence } = useEdit();
  const { openNoteDraftSequence } = useNoteEdit();
  const { data, view } = useTripData();
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractedFields | null>(null);
  const [draft, setDraft] = useState<Activity | Stay | Transit | null>(null);
  const [placement, setPlacement] = useState<{ legId: string; date: string } | null>(null);
  const [conflictId, setConflictId] = useState<string | null>(null);
  const [resolvedPlaces, setResolvedPlaces] = useState<ResolvedPlaces>({});

  const handleExtract = async () => {
    if (!file || !apiKey.trim()) return;
    setStatus('loading');
    setErrorMessage(null);
    try {
      setStoredApiKey(apiKey.trim());
      const fields = await extractEntityFromDocument(file, apiKey.trim());
      const resolved = resolveLegAndDateForFields(fields, view?.days ?? []);
      if (!resolved) {
        setErrorMessage(
          "Couldn't tell which day this belongs to — the document didn't include a date within the trip.",
        );
        setStatus('error');
        return;
      }
      // A real Places lookup (never the model itself — see documentImport.ts's
      // own note on this), so the review form's place picker opens already
      // pointed at the right business instead of a plain-text guess.
      const places = await resolvePlacesForFields(fields);
      const entityDraft = draftEntityFromExtraction(fields, resolved.legId, resolved.date, places);
      const existing = collectionFor(fields.kind, data);
      setConflictId(findConflictCandidate(fields.kind, entityDraft, existing));
      setResolvedPlaces(places);
      setExtracted(fields);
      setDraft(entityDraft);
      setPlacement(resolved);
      setStatus('success');
    } catch (err) {
      setErrorMessage(
        err instanceof DocumentImportError
          ? err.message
          : 'Something went wrong reading that document.',
      );
      setStatus('error');
    }
  };

  const handleContinue = () => {
    if (!extracted || !placement || !draft) return;
    // openDraftSequence overrides the saved entity's _id to conflictId when
    // one's set (replacing an existing entry) — the note refs need to point
    // at whichever id the entity actually ends up saved under, not draft._id's
    // own throwaway random uuid.
    const stayNotes = notesFromExtraction(extracted, conflictId ?? draft._id);
    // A stay whose rate bundles round-trip shuttle/transfer transportation
    // (see documentImport.ts's includedTransfers/draftIncludedTransfers)
    // gets two sibling Transit drafts queued right after it, so a human
    // reviews and confirms each leg individually rather than the shuttle
    // only ever showing up as a Package line and a Note. Each transfer
    // carries its own notes (a pickup schedule, an arrival-mode choice to
    // confirm) alongside its Transit already.
    const transferDrafts =
      extracted.kind === 'stay'
        ? draftIncludedTransfers(extracted, draft as Stay, placement.legId, resolvedPlaces)
        : [];
    openDraftSequence([
      {
        kind: extracted.kind,
        entity: draft,
        overrideId: conflictId ?? undefined,
        onSaved: withNoteFollowUp(stayNotes, openNoteDraftSequence),
      },
      ...transferDrafts.map(({ transit, notes }) => ({
        kind: 'transit' as const,
        entity: transit,
        onSaved: withNoteFollowUp(notes, openNoteDraftSequence),
      })),
    ]);
    onClose();
  };

  const handleFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0] ?? null);
    setStatus('idle');
    setExtracted(null);
    setDraft(null);
  };

  const handleDownloadOriginal = () => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const conflictEntity = conflictId
    ? collectionFor(extracted?.kind ?? 'activity', data).find((e) => e._id === conflictId)
    : undefined;
  const matchedPlace = resolvedPlaces.lodging ?? resolvedPlaces.place;

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
          disabled={status === 'loading'}
          sx={{ alignSelf: 'flex-start' }}
        >
          Choose a file
          <input type="file" hidden accept=".pdf,image/*" onChange={handleFileChosen} />
        </Button>
        {status !== 'success' && (
          <Button
            variant="contained"
            onClick={handleExtract}
            disabled={!file || !apiKey.trim() || status === 'loading'}
            sx={{ alignSelf: 'flex-start' }}
          >
            {status === 'loading' ? <CircularProgress size={20} /> : 'Extract'}
          </Button>
        )}
      </Box>
      {status === 'success' && extracted && placement && (
        <Box sx={{ p: 2, borderRadius: 1, bgcolor: 'action.hover' }}>
          <Typography variant="subtitle2">Detected: {KIND_LABEL[extracted.kind]}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Placing on {formatDateLabel(placement.date)}.
          </Typography>
          {matchedPlace && (
            <Typography variant="body2" color="text.secondary">
              Matched place: {matchedPlace.label} — double-check this in the review form's picker
              before saving.
            </Typography>
          )}
          {extracted.includedTransfers?.length ? (
            <Typography variant="body2" color="text.secondary">
              Also queues {extracted.includedTransfers.length * 2} shuttle transit
              {extracted.includedTransfers.length > 1 ? 's' : ''} (arrival + departure) for review
              right after this.
            </Typography>
          ) : null}
          {extracted.noteworthy?.length ? (
            <Typography variant="body2" color="text.secondary">
              {extracted.noteworthy.length === 1
                ? 'Also flags 1 note'
                : `Also flags ${extracted.noteworthy.length} notes`}{' '}
              for review right after this.
            </Typography>
          ) : null}
          {conflictEntity && (
            <Typography variant="body2" sx={{ mt: 1 }}>
              This looks like it may replace an existing {KIND_LABEL[extracted.kind].toLowerCase()}:{' '}
              <strong>{entityLabel(extracted.kind, conflictEntity)}</strong>.
            </Typography>
          )}
          <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
            <Button size="small" onClick={handleDownloadOriginal}>
              Download original file
            </Button>
            <Button size="small" variant="contained" onClick={handleContinue}>
              Continue to review
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
}
