import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import type { ReactNode } from 'react';

import { activeTrackOf } from '../../model/tripModel';
import type { Day, ScenarioTrack } from '../../model/types';
import { useScenarioSelection } from '../../state/useTripSelections';
import { renderMaterialIcon } from '../shared/materialIcon';
import { NotesCluster } from '../shared/Notes';
import { DayTimeline, ROW_CONTENT_PX } from './DayTimeline';
import type { DayRowOpeners } from './openHandlers';

// A branching day's scenarios each become one chip; the chip group picks
// which branch's own timeline shows below. Each scenario's notes render once
// at the top of that scenario's panel, not repeated per activity. See
// scenarioGroups.ts for the follows/requires resolution this wires up to.
//
// A flight-contingent day's own live cloud cover/rain chance/wind already
// shows in DayWeatherChips, right above these chips — that strip's
// weatherPlaceId follows the same header-title priority as the day's title
// itself, so for a day titled after its own flightseeing Activity (the
// "Flight goes"/"Grounded" case) it's already reading the flightseeing
// spot's own forecast, not the hotel's. No separate fetch/hint needed here.
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

  const activeTrack = activeTrackOf(tracks);
  if (!activeTrack) return null;

  return (
    <Box sx={{ mb: 1 }}>
      {/* ScenarioTabsNode strips this content's horizontal padding (see
          DayTimeline.tsx's TrailingGutter/ScenarioTabsNode comments) so the
          nested DayTimeline below stays unindented; ROW_CONTENT_PX re-adds
          the usual inset here, scoped to just the chips/notes. */}
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', px: ROW_CONTENT_PX }}>
        {tracks.map((t) => {
          const active = t === activeTrack;
          return (
            <Chip
              key={t.scenario._id}
              data-testid={`scenario-chip-${t.scenario._id}`}
              label={t.scenario.label}
              icon={renderMaterialIcon(t.scenario.icon, { fontSize: 'small' })}
              color={active ? (t.scenario.tone === 'ideal' ? 'primary' : 'error') : 'default'}
              variant={active ? 'filled' : 'outlined'}
              onClick={() => selectScenario(t.groupKey, t.scenario._id)}
            />
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
