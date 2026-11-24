import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Stack from '@mui/material/Stack';
import { alpha } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

import { planSummary } from '../../model/planSummary';
import { activeTrackOf } from '../../model/tripModel';
import type { Day, ScenarioTrack } from '../../model/types';
import { useLiveDays } from '../../state/useLiveDays';
import { useScenarioSelection } from '../../state/useTripSelections';
import { renderMaterialIcon } from '../shared/materialIcon';
import { NotesCluster } from '../shared/Notes';
import { DayTimeline, ROW_CONTENT_PX } from './DayTimeline';
import type { DayRowOpeners } from './openHandlers';

// A branching day's scenarios each become one chip; the chip group picks
// which branch's own timeline shows below. Each scenario's notes render once
// at the top of that scenario's panel, not repeated per activity. See
// scenarioGroups.ts for the follows/requires resolution this wires up to.
export function ScenarioTabsSection({
  day,
  tracks,
  onOpenActivity,
  onOpenStay,
  onOpenTransit,
  trailingTravelFooter,
}: DayRowOpeners & {
  day: Day;
  // One scenario group's own tabs (tracksByGroup) — the active one is
  // already marked, upstream (resolveActiveScenarios/layoutDay).
  tracks: ScenarioTrack[];
  // Forwarded straight through to the active track's own nested DayTimeline
  // as its trailingTravelFooter — see DayTimeline.tsx's own note on that
  // prop. Only ever set when this section itself sits inside another
  // scenario-tabs node's own exit segment (ScenarioTabsNode below).
  trailingTravelFooter?: ReactNode;
}) {
  const { selectScenario } = useScenarioSelection();
  const { activitiesById, transitsById, staysById } = useLiveDays();

  const activeTrack = activeTrackOf(tracks);
  if (!activeTrack) return null;

  return (
    <Box sx={{ mb: 1 }}>
      {/* ScenarioTabsNode strips this content's horizontal padding (see
          DayTimeline.tsx's TrailingGutter/ScenarioTabsNode comments) so the
          nested DayTimeline below stays unindented; ROW_CONTENT_PX re-adds
          the usual inset here, scoped to just the chips/notes. */}
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', px: ROW_CONTENT_PX }}>
        {tracks.map((t) => {
          const active = t === activeTrack;
          const color = t.scenario.tone === 'ideal' ? 'primary' : 'error';
          return (
            <ButtonBase
              key={t.scenario._id}
              data-testid={`scenario-chip-${t.scenario._id}`}
              aria-pressed={active}
              onClick={() => selectScenario(t.groupKey, t.scenario._id)}
              sx={(theme) => ({
                flex: '1 1 9rem',
                minWidth: 0,
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 0.25,
                p: 1.25,
                borderRadius: 2,
                textAlign: 'left',
                bgcolor: alpha(theme.palette[color].main, active ? 0.2 : 0.08),
                outline: active ? `2px solid ${theme.palette[color].main}` : 'none',
              })}
            >
              <Typography
                variant="caption"
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  color: `${color}.main`,
                  fontWeight: 900,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                }}
              >
                {renderMaterialIcon(t.scenario.icon, { fontSize: 'small' })}
                {t.scenario.label}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {planSummary(t.scenario._id, t.members, {
                  activities: activitiesById,
                  transits: transitsById,
                  stays: staysById,
                })}
              </Typography>
            </ButtonBase>
          );
        })}
      </Stack>
      <Box sx={{ mt: 1.5, px: ROW_CONTENT_PX }}>
        <NotesCluster notes={activeTrack.notes} />
      </Box>
      <Box sx={{ mt: 1.5 }}>
        <DayTimeline
          day={day}
          rows={activeTrack.rows}
          containerId={`${day.date}::${activeTrack.scenario._id}`}
          scenarioId={activeTrack.scenario._id}
          onOpenActivity={onOpenActivity}
          onOpenStay={onOpenStay}
          onOpenTransit={onOpenTransit}
          trailingTravelFooter={trailingTravelFooter}
        />
      </Box>
    </Box>
  );
}
