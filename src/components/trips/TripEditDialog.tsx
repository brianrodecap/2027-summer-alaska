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
import FormControlLabel from '@mui/material/FormControlLabel';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

import { DOCUMENT_ACCEPT, importErrorMessage } from '../../model/documentImport';
import {
  applyLegForm,
  applyTripForm,
  blankLegForm,
  blankTripForm,
  EDIT_KIND_LABEL,
  type EditKind,
  type LegFormState,
  tripFormFrom,
} from '../../model/editForms';
import {
  draftTripData,
  importByProposals,
  type ProposalImport,
  stagedFromProposals,
  type StagedTripEntities,
} from '../../model/proposalImport';
import { slugify } from '../../model/slug';
import { buildTripView } from '../../model/tripModel';
import type { Leg, Trip } from '../../model/types';
import { LegFormFields } from '../legs/LegFormFields';

function summarizeImport(result: ProposalImport): string {
  const counts = new Map<EditKind, number>();
  for (const { kind } of result.queue) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  return [...counts.entries()]
    .map(([kind, n]) => `${n} ${EDIT_KIND_LABEL[kind]}${n > 1 ? 's' : ''}`)
    .join(', ');
}

type ImportStatus = 'idle' | 'loading' | 'error' | 'success';

const EMPTY_STAGED: StagedTripEntities = {
  activities: [],
  stays: [],
  transits: [],
  bookings: [],
  notes: [],
};

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
// flight confirmation) instead of a blank form: the same proposals import as
// the assistant's (proposalImport.ts), read against an empty draft of the
// new trip. Its suggested name and summary seed the form, the travelers it
// names join the trip, and every entry it proposes (with its notes) is
// created alongside the trip on Save.
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
  const [importStatus, setImportStatus] = useState<ImportStatus>('idle');
  const [importError, setImportError] = useState<string | null>(null);
  const [imported, setImported] = useState<ProposalImport | null>(null);

  // The slug is never hand-typed — it's derived from the name (public/data/
  // directory name and #/<slug> route both follow from it) — nobody is asked
  // to type an id. Renaming an existing trip's name here recomputes
  // its slug too — handleSave below treats that as a move (exportTripRename).
  const handleNameChange = (name: string) => {
    setForm((prev) => ({ ...prev, name, slug: slugify(name, existingSlugs) }));
  };

  const handleExtract = async () => {
    if (!file) return;
    setImportStatus('loading');
    setImportError(null);
    try {
      // A new trip has nothing on it yet; the document is read against an
      // empty draft of it — the travelers entered so far and the pets setting.
      const draft = draftTripData(trip?.travelers ?? [], form.pets);
      const result = await importByProposals(file, draft, buildTripView(draft), {
        newTrip: true,
      });
      if (!form.name.trim() && result.tripName) handleNameChange(result.tripName);
      setForm((prev) =>
        prev.summary.trim() ? prev : { ...prev, summary: result.tripSummary ?? prev.summary },
      );
      setImported(result);
      setImportStatus('success');
    } catch (err) {
      setImportError(importErrorMessage(err));
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
      onSave(result.slug, result.trip, addedLegs, EMPTY_STAGED);
      return;
    }
    const legResult = applyLegForm({ ...legForm, name: form.name }, result.trip._id);
    if (typeof legResult === 'string') {
      setError(legResult);
      return;
    }
    // Everyone the document names joins the new trip's travelers, so their
    // seats and fares carry over (add_traveler, in proposalImport.ts). No
    // de-duplication needed (a reviewed false positive): a new trip's form has
    // no travelers of its own, and add_traveler refuses a name already added.
    const newTrip = imported
      ? { ...result.trip, travelers: [...result.trip.travelers, ...imported.newTravelers] }
      : result.trip;
    const staged = imported ? stagedFromProposals(imported, legResult.leg._id) : EMPTY_STAGED;
    onSave(result.slug, newTrip, [legResult.leg], staged);
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
                  accept={DOCUMENT_ACCEPT}
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    setImportStatus('idle');
                    setImported(null);
                  }}
                />
              </Button>
              {importStatus !== 'success' && (
                <Button
                  variant="contained"
                  onClick={handleExtract}
                  disabled={!file || importStatus === 'loading'}
                  sx={{ alignSelf: 'flex-start' }}
                >
                  {importStatus === 'loading' ? <CircularProgress size={20} /> : 'Read it'}
                </Button>
              )}
              {importStatus === 'success' && imported && (
                <Alert severity="success">
                  Detected {summarizeImport(imported)} — Name is filled in above, and these entries
                  ride along on Save. Review everything before saving.
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
          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={form.pets}
                  // A read in flight would finish after the reset and overwrite it.
                  disabled={importStatus === 'loading'}
                  onChange={(e) => {
                    setForm((prev) => ({ ...prev, pets: e.target.checked }));
                    // The document was read against the old setting, so it is read again.
                    if (imported) {
                      setImported(null);
                      setImportStatus('idle');
                    }
                  }}
                />
              }
              label="Traveling with pets"
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              Imported bookings flag pet bans and fees only when this is on. Changing it after
              importing clears the import.
            </Typography>
          </Box>
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
                <LegFormFields form={newLegForm} onChange={setNewLegForm} nameLabel="Leg name" />
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
