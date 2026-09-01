import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { Fragment, useMemo, useState } from 'react';

import { blankScenario } from '../../model/editForms';
import { formatDateLabel, groupScenariosByDate, resolveScenarioDates } from '../../model/tripModel';
import type { Activity, Leg, Scenario, Transit } from '../../model/types';
import { renderMaterialIcon } from '../shared/materialIcon';
import { WarningBadge } from '../shared/WarningBadge';
import { ScenarioEditDialog } from './ScenarioEditDialog';

// A scenario's own `date`/`_id`/label carry no reliable date to group or
// sort by (see resolveScenarioDates) — real content, not authoring intent,
// decides where a scenario lands. So this list groups by that resolved date
// (chronological, nested parentScenarioId children folded under their
// parent's row) instead of the flat alphabetical list it used to be, which
// left same-day ideal/alt pairs like "Flight goes"/"Grounded" repeating
// under identical-looking labels with nothing but a stale `_id` to tell
// them apart.

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

  const dateInfoById = useMemo(
    () => resolveScenarioDates(scenarios, activities, transits),
    [scenarios, activities, transits],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return scenarios.filter((s) => {
      if (legFilter && s.legId !== legFilter) return false;
      if (!needle) return true;
      const date = dateInfoById.get(s._id)?.date;
      return (
        s.label.toLowerCase().includes(needle) ||
        (!!date && formatDateLabel(date).toLowerCase().includes(needle))
      );
    });
  }, [scenarios, query, legFilter, dateInfoById]);

  // Nested (parentScenarioId) children fold under their parent's own row
  // instead of getting a top-level slot in the date grouping below — unless
  // the search/leg filters dropped the parent, in which case a matching
  // child still needs somewhere to render.
  const sections = useMemo(() => {
    const filteredIds = new Set(filtered.map((s) => s._id));
    const childrenByParent = new Map<string, Scenario[]>();
    const topLevel: Scenario[] = [];
    for (const s of filtered) {
      if (s.parentScenarioId && filteredIds.has(s.parentScenarioId)) {
        const list = childrenByParent.get(s.parentScenarioId);
        if (list) list.push(s);
        else childrenByParent.set(s.parentScenarioId, [s]);
      } else {
        topLevel.push(s);
      }
    }

    const sortSiblings = (list: Scenario[]) =>
      [...list].sort(
        (a, b) =>
          (a.tone === 'ideal' ? 0 : 1) - (b.tone === 'ideal' ? 0 : 1) ||
          a.label.localeCompare(b.label),
      );

    return groupScenariosByDate(topLevel, dateInfoById).map(({ date, scenarios: list }) => ({
      date,
      items: list.map((scenario) => ({
        scenario,
        children: sortSiblings(childrenByParent.get(scenario._id) ?? []),
      })),
    }));
  }, [filtered, dateInfoById]);

  const legName = (legId: string) => legs.find((l) => l._id === legId)?.name ?? legId;

  const renderScenarioRow = (scenario: Scenario, nested: boolean) => {
    const info = dateInfoById.get(scenario._id);
    return (
      <ListItemButton
        key={scenario._id}
        onClick={() => setEditing(scenario)}
        sx={nested ? { pl: 5 } : undefined}
      >
        <ListItemIcon>{renderMaterialIcon(scenario.icon)}</ListItemIcon>
        <ListItemText
          primary={
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              <span>{scenario.label}</span>
              {!scenarioIdsInUse.has(scenario._id) && (
                <WarningBadge title="No activities or transits use this scenario yet" />
              )}
            </Stack>
          }
          secondary={[legName(scenario.legId), scenario.tone, info?.tentative && 'estimated date']
            .filter(Boolean)
            .join(' · ')}
        />
      </ListItemButton>
    );
  };

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
          {sections.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No scenarios yet.
            </Typography>
          ) : (
            <List disablePadding>
              {sections.map((section) => (
                <Fragment key={section.date ?? 'unscheduled'}>
                  <ListSubheader disableSticky sx={{ bgcolor: 'transparent', lineHeight: 2.5 }}>
                    {section.date ? formatDateLabel(section.date) : 'Not yet scheduled'}
                  </ListSubheader>
                  {section.items.map(({ scenario, children }) => (
                    <Fragment key={scenario._id}>
                      {renderScenarioRow(scenario, false)}
                      {children.map((child) => renderScenarioRow(child, true))}
                    </Fragment>
                  ))}
                </Fragment>
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
          dateInfoById={dateInfoById}
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
