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
  type ExtractedFields,
  extractEntityFromDocument,
  findConflictCandidate,
  resolveLegAndDateForFields,
} from '../../model/documentImport';
import { COLLECTION_FOR_KIND, type EditKind } from '../../model/editForms';
import { formatDateLabel, transitRouteLabel } from '../../model/tripModel';
import type { Activity, Stay, Transit } from '../../model/types';
import { useEdit } from '../../state/useEdit';
import { useTripData } from '../../state/useTripData';

const KIND_LABEL: Record<EditKind, string> = {
  activity: 'Activity',
  stay: 'Stay',
  transit: 'Transit',
};

function labelFor(kind: EditKind, entity: Activity | Stay | Transit): string {
  if (kind === 'stay') return (entity as Stay).lodging?.name || 'Untitled stay';
  if (kind === 'transit') return transitRouteLabel(entity as Transit);
  return (entity as Activity).text || 'Untitled activity';
}

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
  const { openFromDraft } = useEdit();
  const { data, view } = useTripData();
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractedFields | null>(null);
  const [placement, setPlacement] = useState<{ legId: string; date: string } | null>(null);
  const [conflictId, setConflictId] = useState<string | null>(null);

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
      const draft = draftEntityFromExtraction(fields, resolved.legId, resolved.date);
      const existing = collectionFor(fields.kind, data);
      setConflictId(findConflictCandidate(fields.kind, draft, existing));
      setExtracted(fields);
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
    if (!extracted || !placement) return;
    const draft = draftEntityFromExtraction(extracted, placement.legId, placement.date);
    openFromDraft(extracted.kind, draft, conflictId ?? undefined);
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

  const conflictEntity = conflictId
    ? collectionFor(extracted?.kind ?? 'activity', data).find((e) => e._id === conflictId)
    : undefined;

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
          {conflictEntity && (
            <Typography variant="body2" sx={{ mt: 1 }}>
              This looks like it may replace an existing {KIND_LABEL[extracted.kind].toLowerCase()}:{' '}
              <strong>{labelFor(extracted.kind, conflictEntity)}</strong>.
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
