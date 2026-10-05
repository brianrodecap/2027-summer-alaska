import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';

import { setStoredApiKey } from '../../config/aiKey';
import {
  type DocumentExtraction,
  entityStartAt,
  extractDocumentEntries,
  importErrorMessage,
  notesFromExtraction,
  planDocumentImport,
  type PlannedImportEntry,
  type ResolvedPlaces,
  resolveLegAndDateForFields,
  resolvePlacesForFields,
} from '../../model/documentImport';
import { EDIT_KIND_LABEL } from '../../model/editForms';
import { dateOnly, entityLabel, formatDateLabel, formatTime } from '../../model/tripModel';
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

// What reviewing a matched entry will change, in the reader's terms — the
// times are what a delayed or rescheduled booking most often moves.
function updateSummary(entry: PlannedImportEntry): string | null {
  if (!entry.existing) return null;
  const { entity: match, merged } = entry.existing;
  const { kind } = entry.fields;
  const before = entityStartAt(kind, match);
  const after = entityStartAt(kind, merged);
  if (!before || !after || before === after) return null;
  const verb = kind === 'transit' ? 'departs' : 'starts';
  return dateOnly(before) === dateOnly(after)
    ? `${verb} ${formatTime(before)} → ${formatTime(after)}`
    : `${verb} ${formatDateLabel(dateOnly(before))} ${formatTime(before)} → ${formatDateLabel(dateOnly(after))} ${formatTime(after)}`;
}

function ImportEntryRow({
  entry,
  sharedCount,
  onToggleUpdate,
}: {
  entry: PlannedImportEntry;
  sharedCount: number;
  onToggleUpdate: (update: boolean) => void;
}) {
  const { fields, placement, draft, updating: update } = entry;
  const match = entry.existing?.entity;
  const kindLabel = EDIT_KIND_LABEL[fields.kind];
  const changes = updateSummary(entry);
  return (
    <Box sx={{ p: 1.5, borderRadius: 1, bgcolor: 'action.hover' }}>
      <Typography variant="subtitle2">
        {kindLabel}: {entityLabel(fields.kind, draft)}
      </Typography>
      {!placement ? (
        <Typography variant="body2" color="text.secondary">
          Its date isn't within this trip, so it will be skipped.
        </Typography>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary">
            {formatDateLabel(placement.date)}
            {sharedCount > 1 && fields.confirmationNumber
              ? ` · booking ${fields.confirmationNumber} covers ${sharedCount} entries`
              : ''}
            {entry.notes.length
              ? ` · ${entry.notes.length} note${entry.notes.length > 1 ? 's' : ''} to review`
              : ''}
          </Typography>
          {match && (
            <>
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={update}
                    onChange={(e) => onToggleUpdate(e.target.checked)}
                  />
                }
                label={
                  <Typography variant="body2">
                    Update <strong>{entityLabel(fields.kind, match)}</strong>
                    {update && changes ? ` · ${changes}` : ''}
                  </Typography>
                }
              />
              {!update && (
                <Typography variant="body2" color="text.secondary">
                  Adds it as a new {kindLabel.toLowerCase()} instead.
                </Typography>
              )}
            </>
          )}
          {!match && (
            <Typography variant="body2" color="text.secondary">
              Nothing on the itinerary matches, so it will be added as new.
            </Typography>
          )}
          {entry.travelers.length > 0 && (
            <Typography variant="body2" color="text.secondary">
              Adds {entry.travelers.map((t) => t.name).join(', ')} to the trip's travelers.
            </Typography>
          )}
        </>
      )}
    </Box>
  );
}

interface ImportDocumentPanelProps {
  apiKey: string;
  onClose: () => void;
}

type Status = 'idle' | 'loading' | 'error' | 'success';

// The trip assistant's document import (src/components/assistant/AssistantPanel.tsx,
// behind its paperclip button). Uploads a booking document (PDF or photo),
// sends it to the Anthropic API for extraction (src/model/documentImport.ts),
// and queues every entry it describes — a round trip's two flights, a stay
// and its transfers — for review one at a time through EditContext's
// openDraftSequence. An entry matching something already on the itinerary
// (a placeholder flight, a planned stay) updates that entry rather than
// adding a second one, unless its switch here is turned off. This panel
// never commits anything itself.
export function ImportDocumentPanel({ apiKey, onClose }: ImportDocumentPanelProps) {
  const { openDraftSequence } = useEdit();
  const { openNoteDraftSequence } = useNoteEdit();
  const { data, view } = useTripData();
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<{
    extraction: DocumentExtraction;
    places: ResolvedPlaces[];
  } | null>(null);
  // Indexes of matched entries the reader chose to add as new instead.
  const [addAsNew, setAddAsNew] = useState<ReadonlySet<number>>(new Set());
  // Re-planned on every switch: an entry added as new drafts its own booking
  // rather than building on (and overwriting) its match's.
  const plan = useMemo(
    () =>
      extracted && data
        ? planDocumentImport(
            extracted.extraction,
            data,
            view?.days ?? [],
            extracted.places,
            addAsNew,
          )
        : null,
    [extracted, data, view?.days, addAsNew],
  );

  const handleExtract = async () => {
    if (!file || !apiKey.trim() || !data) return;
    setStatus('loading');
    setErrorMessage(null);
    try {
      setStoredApiKey(apiKey.trim());
      const extraction = await extractDocumentEntries(file, apiKey.trim());
      // A real Places lookup per entry (never the model itself — see
      // documentImport.ts's own note on this), so a new entry's place
      // picker opens already pointed at the right business.
      const places = await Promise.all(extraction.entities.map(resolvePlacesForFields));
      // The full plan follows from `extracted` (see `plan` above); this only
      // needs to know whether any entry lands within the trip.
      if (!extraction.entities.some((f) => resolveLegAndDateForFields(f, view?.days ?? []))) {
        setErrorMessage(
          "Couldn't tell which day this belongs to — the document didn't include a date within the trip.",
        );
        setStatus('error');
        return;
      }
      setExtracted({ extraction, places });
      setAddAsNew(new Set());
      setStatus('success');
    } catch (err) {
      setErrorMessage(importErrorMessage(err));
      setStatus('error');
    }
  };

  const handleContinue = () => {
    if (!plan) return;
    const drafts: DraftReview[] = plan.flatMap((entry): DraftReview[] => {
      const { fields, placement, booking, updating } = entry;
      if (!placement) return [];
      const entity = updating && entry.existing ? entry.existing.merged : entry.draft;
      const notes = notesFromExtraction(fields, entity._id, entry.notes);
      // A stay whose rate bundles round-trip shuttle/transfer transportation
      // (see documentImport.ts's planIncludedTransfers) gets its sibling
      // Transit drafts queued right after it, so a human confirms each leg
      // rather than the shuttle only ever showing up as a Package and a Note.
      return [
        {
          kind: fields.kind,
          entity,
          bookings: booking ? [booking] : [],
          travelers: entry.travelers,
          overrideId: updating ? entity._id : undefined,
          onSaved: withNoteFollowUp(notes, openNoteDraftSequence),
          source: 'ai-import',
        },
        ...entry.transfers.map(({ transit, notes: transferNotes, overrideId }): DraftReview => ({
          kind: 'transit',
          entity: transit,
          overrideId,
          onSaved: withNoteFollowUp(transferNotes, openNoteDraftSequence),
          source: 'ai-import',
        })),
      ];
    });
    openDraftSequence(drafts);
    onClose();
  };

  const handleFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0] ?? null);
    setStatus('idle');
    setExtracted(null);
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

  const sharedCount = (entry: PlannedImportEntry) =>
    entry.booking ? (plan ?? []).filter((e) => e.booking?._id === entry.booking?._id).length : 0;
  const reviewCount = plan?.filter((e) => e.placement).length ?? 0;

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
      {status === 'success' && plan && (
        <Stack spacing={1}>
          <Typography variant="subtitle2">
            Found {plan.length} entr{plan.length === 1 ? 'y' : 'ies'}
          </Typography>
          {plan.map((entry, i) => (
            <ImportEntryRow
              key={i}
              entry={entry}
              sharedCount={sharedCount(entry)}
              onToggleUpdate={(update) =>
                setAddAsNew((prev) => {
                  const next = new Set(prev);
                  if (update) next.delete(i);
                  else next.add(i);
                  return next;
                })
              }
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
