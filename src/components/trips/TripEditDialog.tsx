import AddIcon from '@mui/icons-material/Add';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

import { getStoredApiKey, setStoredApiKey } from '../../config/aiKey';
import {
  dateRangeFromExtractedEntities,
  DocumentImportError,
  draftTripEntities,
  type ExtractedFields,
  extractTripEntitiesFromDocument,
  type StagedTripEntities,
} from '../../model/documentImport';
import {
  applyLegForm,
  applyTripForm,
  blankLegForm,
  blankTripForm,
  type LegFormState,
  tripFormFrom,
} from '../../model/editForms';
import { slugify } from '../../model/slug';
import type { Leg, Trip } from '../../model/types';
import { AUTHORITY_OPTIONS } from '../legs/AddLegDialog';

const KIND_LABEL: Record<ExtractedFields['kind'], string> = {
  activity: 'Activity',
  stay: 'Stay',
  transit: 'Transit',
};

function summarizeExtraction(entities: ExtractedFields[]): string {
  const counts = new Map<string, number>();
  for (const e of entities) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  return [...counts.entries()]
    .map(([kind, n]) => `${n} ${KIND_LABEL[kind as ExtractedFields['kind']]}${n > 1 ? 's' : ''}`)
    .join(', ');
}

type ImportStatus = 'idle' | 'loading' | 'error' | 'success';

// The trips list's own Add/Edit trip — mirrors EditDialog/RouteEditDialog's
// Save/Cancel shape, but (like RouteEditDialog) stands apart from
// EditContext: a Trip isn't a day-list line item scoped inside an
// already-open trip's data. Save goes straight back to TripsHome, which
// drops it into the in-memory list and triggers the matching file-set
// download (exportNewTrip / exportTripEdit / exportTripRename) so it can be
// copied into public/data/. No date fields on Trip itself — a trip's span is computed
// from its own Legs (tripModel.ts's tripDateRange) — and Add trip (isNew)
// still creates a default single Leg alongside it regardless: most trips
// are one leg, and without at least one Leg there's nowhere for a Stay/
// Transit/Activity to attach (buildTripView only produces a Day for dates
// inside a Leg), so a bare new Trip would be a dead end until a separate
// Add Leg step. That default Leg carries no dates of its own either — like
// any Leg, its span is computed from whatever Stay/Transit/Activity ends up
// pointing at it, staged or otherwise — it just reuses the trip's own name.
//
// Add trip also offers starting from a document (a cruise or round-trip
// flight confirmation) instead of a blank form — extractTripEntitiesFromDocument
// (documentImport.ts) reads the whole document at once rather than one entity
// at a time like the day list's own "From a document…" does, since here the
// document itself is what determines the trip's shape: its suggested name
// seeds Name, and every entity it found rides along to be created alongside
// the trip on Save, anchored to whichever date the document's own entries
// span (dateRangeFromExtractedEntities) for any that only got a fuzzy time.
export function TripEditDialog({
  trip,
  slug,
  legs: existingLegs,
  existingSlugs,
  onClose,
  onSave,
}: {
  trip?: Trip;
  slug?: string;
  legs?: Leg[];
  existingSlugs: string[];
  onClose: () => void;
  onSave: (slug: string, trip: Trip, legs: Leg[], staged: StagedTripEntities) => void;
}) {
  const isNew = !trip;
  const [form, setForm] = useState(() =>
    trip && slug ? tripFormFrom(trip, slug) : blankTripForm(),
  );
  const [legForm] = useState(() => blankLegForm());
  const [error, setError] = useState<string | null>(null);

  // Editing an existing trip: legs already on disk render read-only above
  // the "+ Add leg" affordance; anything added here only exists in-memory
  // until Save, same as every other queued-but-unsaved edit in this dialog.
  const [addedLegs, setAddedLegs] = useState<Leg[]>([]);
  const [newLegForm, setNewLegForm] = useState<LegFormState | null>(null);

  const handleAddLeg = () => {
    if (!trip || !newLegForm) return;
    const result = applyLegForm(newLegForm, trip._id);
    if (typeof result === 'string') {
      setError(result);
      return;
    }
    setAddedLegs((prev) => [...prev, result.leg]);
    setNewLegForm(null);
  };

  const [showImport, setShowImport] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [apiKey, setApiKey] = useState(() => getStoredApiKey() ?? '');
  const [importStatus, setImportStatus] = useState<ImportStatus>('idle');
  const [importError, setImportError] = useState<string | null>(null);
  const [importedEntities, setImportedEntities] = useState<ExtractedFields[] | null>(null);

  // The slug is never hand-typed — it's derived from the name (public/data/
  // directory name and #/<slug> route both follow from it), same as
  // draftEntityFromExtraction leaves place resolution to a human but never
  // asks one to type an id. Renaming an existing trip's name here recomputes
  // its slug too — handleSave below treats that as a move (exportTripRename).
  const handleNameChange = (name: string) => {
    setForm((prev) => ({ ...prev, name, slug: slugify(name, existingSlugs) }));
  };

  const handleExtract = async () => {
    if (!file || !apiKey.trim()) return;
    setImportStatus('loading');
    setImportError(null);
    try {
      setStoredApiKey(apiKey.trim());
      const result = await extractTripEntitiesFromDocument(file, apiKey.trim());
      if (!form.name.trim() && result.tripName) handleNameChange(result.tripName);
      setForm((prev) =>
        prev.summary.trim() ? prev : { ...prev, summary: result.tripSummary ?? prev.summary },
      );
      setImportedEntities(result.entities);
      setImportStatus('success');
    } catch (err) {
      setImportError(
        err instanceof DocumentImportError
          ? err.message
          : 'Something went wrong reading that document.',
      );
      setImportStatus('error');
    }
  };

  const handleSave = () => {
    const result = applyTripForm(trip ?? null, form, existingSlugs);
    if (typeof result === 'string') {
      setError(result);
      return;
    }
    if (!isNew) {
      onSave(result.slug, result.trip, addedLegs, { activities: [], stays: [], transits: [] });
      return;
    }
    const legResult = applyLegForm({ ...legForm, name: form.name }, result.trip._id);
    if (typeof legResult === 'string') {
      setError(legResult);
      return;
    }
    const staged = importedEntities
      ? draftTripEntities(
          importedEntities,
          legResult.leg._id,
          dateRangeFromExtractedEntities(importedEntities)?.startDate ??
            new Date().toISOString().slice(0, 10),
        )
      : { activities: [], stays: [], transits: [] };
    onSave(result.slug, result.trip, [legResult.leg], staged);
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{isNew ? 'Add trip' : 'Edit trip'}</DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {isNew && !showImport && (
          <Button startIcon={<UploadFileIcon />} onClick={() => setShowImport(true)} sx={{ mb: 2 }}>
            Start from a document
          </Button>
        )}
        {isNew && showImport && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Start from a document
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              A cruise or round-trip flight confirmation can shape this whole trip: every booking it
              describes is created alongside the trip once you Save.
            </Typography>
            {importError && (
              <Alert severity="error" sx={{ mb: 2 }} onClose={() => setImportError(null)}>
                {importError}
              </Alert>
            )}
            <Stack spacing={2}>
              <Button variant="outlined" component="label" disabled={importStatus === 'loading'}>
                {file ? file.name : 'Choose a booking PDF or photo'}
                <input
                  type="file"
                  hidden
                  accept=".pdf,image/*"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    setImportStatus('idle');
                    setImportedEntities(null);
                  }}
                />
              </Button>
              <TextField
                label="Anthropic API key"
                type="password"
                fullWidth
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                helperText="Kept only in this browser's local storage — never committed or sent anywhere but api.anthropic.com."
              />
              {importStatus !== 'success' && (
                <Button
                  variant="contained"
                  onClick={handleExtract}
                  disabled={!file || !apiKey.trim() || importStatus === 'loading'}
                  sx={{ alignSelf: 'flex-start' }}
                >
                  {importStatus === 'loading' ? <CircularProgress size={20} /> : 'Extract'}
                </Button>
              )}
              {importStatus === 'success' && importedEntities && (
                <Alert severity="success">
                  Detected {summarizeExtraction(importedEntities)} — Name is filled in above, and
                  these entries ride along on Save. Review everything before saving.
                </Alert>
              )}
            </Stack>
            <Divider sx={{ mt: 3 }} />
          </Box>
        )}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Name"
            value={form.name}
            onChange={(e) => handleNameChange(e.target.value)}
            fullWidth
            autoFocus
            helperText={
              !isNew && slug && form.slug !== slug
                ? `Renaming moves this trip to public/data/${form.slug}/ and #/${form.slug} — Save downloads the full file set for it; the old public/data/${slug}/ directory still needs manual deletion.`
                : undefined
            }
          />
          <TextField
            label="Summary"
            value={form.summary}
            onChange={(e) => setForm((prev) => ({ ...prev, summary: e.target.value }))}
            multiline
            minRows={2}
            fullWidth
          />
        </Stack>
        {!isNew && (
          <Box sx={{ mt: 3 }}>
            <Divider sx={{ mb: 2 }} />
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Legs
            </Typography>
            {(existingLegs ?? []).length + addedLegs.length === 0 && !newLegForm && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                This trip has no legs yet — without at least one, there's nowhere for a
                Stay/Transit/Activity to attach.
              </Typography>
            )}
            {(existingLegs ?? []).length + addedLegs.length > 0 && (
              <List dense disablePadding sx={{ mb: 1 }}>
                {[...(existingLegs ?? []), ...addedLegs].map((leg) => (
                  <ListItem key={leg._id} disableGutters>
                    <ListItemText primary={leg.name} />
                  </ListItem>
                ))}
              </List>
            )}
            {newLegForm ? (
              <Stack spacing={2} sx={{ mb: 1 }}>
                <TextField
                  label="Leg name"
                  value={newLegForm.name}
                  onChange={(e) =>
                    setNewLegForm((prev) => (prev ? { ...prev, name: e.target.value } : prev))
                  }
                  fullWidth
                  autoFocus
                />
                <TextField
                  select
                  label="Skeleton authority"
                  value={newLegForm.skeletonAuthority}
                  helperText={
                    AUTHORITY_OPTIONS.find((o) => o.value === newLegForm.skeletonAuthority)?.helper
                  }
                  onChange={(e) =>
                    setNewLegForm((prev) =>
                      prev
                        ? { ...prev, skeletonAuthority: e.target.value as Leg['skeletonAuthority'] }
                        : prev,
                    )
                  }
                >
                  {AUTHORITY_OPTIONS.map((o) => (
                    <MenuItem key={o.value} value={o.value}>
                      {o.label}
                    </MenuItem>
                  ))}
                </TextField>
                <Stack direction="row" spacing={1}>
                  <Button variant="contained" size="small" onClick={handleAddLeg}>
                    Add
                  </Button>
                  <Button size="small" onClick={() => setNewLegForm(null)}>
                    Cancel
                  </Button>
                </Stack>
              </Stack>
            ) : (
              <Button
                startIcon={<AddIcon />}
                size="small"
                onClick={() => setNewLegForm(blankLegForm())}
              >
                Add a leg
              </Button>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
