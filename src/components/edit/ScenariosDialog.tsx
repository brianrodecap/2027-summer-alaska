import WarningIcon from '@mui/icons-material/Warning';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';

import { blankScenario } from '../../model/editForms';
import { formatDateLabel } from '../../model/tripModel';
import type { Activity, Leg, Scenario, Transit } from '../../model/types';
import { renderMaterialIcon } from '../shared/materialIcon';
import { ScenarioEditDialog } from './ScenarioEditDialog';

// scenarios.json is reference data pointed at by Activity/Transit's own
// scenarioId, not scoped to any one date the way a day-list drill-down is —
// mirrors RoutesDialog's own list-then-edit shape (search a flat list, open
// one into its own edit chrome) rather than being wired through
// EditContext's per-entity pencil-button flow.
export function ScenariosDialog({
  scenarios,
  legs,
  activities,
  transits,
  open,
  onClose,
  onSave,
  onDelete,
}: {
  scenarios: Scenario[];
  legs: Leg[];
  activities: Activity[];
  transits: Transit[];
  open: boolean;
  onClose: () => void;
  onSave: (scenario: Scenario) => void;
  onDelete: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [legFilter, setLegFilter] = useState('');
  const [editing, setEditing] = useState<Scenario | null>(null);

  const scenarioIdsInUse = useMemo(() => {
    const ids = new Set<string>();
    for (const a of activities) if (a.scenarioId) ids.add(a.scenarioId);
    for (const t of transits) if (t.scenarioId) ids.add(t.scenarioId);
    return ids;
  }, [activities, transits]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return scenarios
      .filter((s) => !needle || s.label.toLowerCase().includes(needle))
      .filter((s) => !legFilter || s.legId === legFilter)
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [scenarios, query, legFilter]);

  const legName = (legId: string) => legs.find((l) => l._id === legId)?.name ?? legId;

  return (
    <>
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
        <DialogTitle>Scenarios</DialogTitle>
        <DialogContent dividers>
          <TextField
            label="Search scenarios"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            fullWidth
            size="small"
            sx={{ mb: 2 }}
          />
          <TextField
            select
            label="Leg"
            value={legFilter}
            onChange={(e) => setLegFilter(e.target.value)}
            fullWidth
            size="small"
            sx={{ mb: 2 }}
          >
            <MenuItem value="">All legs</MenuItem>
            {legs.map((leg) => (
              <MenuItem key={leg._id} value={leg._id}>
                {leg.name}
              </MenuItem>
            ))}
          </TextField>
          {filtered.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No scenarios yet.
            </Typography>
          ) : (
            <List disablePadding>
              {filtered.map((scenario) => (
                <ListItemButton key={scenario._id} onClick={() => setEditing(scenario)}>
                  <ListItemIcon>{renderMaterialIcon(scenario.icon)}</ListItemIcon>
                  <ListItemText
                    primary={
                      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                        <span>{scenario.label}</span>
                        {!scenarioIdsInUse.has(scenario._id) && (
                          <Tooltip title="No activities or transits use this scenario yet">
                            <WarningIcon fontSize="small" sx={{ color: 'error.main' }} />
                          </Tooltip>
                        )}
                      </Stack>
                    }
                    secondary={[
                      legName(scenario.legId),
                      scenario.tone,
                      scenario.followsScenarioDate &&
                        `follows ${formatDateLabel(scenario.followsScenarioDate)}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  />
                </ListItemButton>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between', px: 3 }}>
          <Button
            disabled={!legs.length}
            onClick={() => setEditing(blankScenario(legFilter || legs[0]._id))}
          >
            Add scenario
          </Button>
          <Button onClick={onClose}>Close</Button>
        </DialogActions>
      </Dialog>
      {editing && (
        <ScenarioEditDialog
          scenario={editing}
          isNew={!scenarios.some((s) => s._id === editing._id)}
          legs={legs}
          allScenarios={scenarios}
          onClose={() => setEditing(null)}
          onSave={(scenario) => {
            onSave(scenario);
            setEditing(null);
          }}
          onDelete={(id) => {
            onDelete(id);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
