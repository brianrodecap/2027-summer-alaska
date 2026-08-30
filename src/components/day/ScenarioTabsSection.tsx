import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import { useState } from 'react';

import type {
  Day,
  EnrichedActivity,
  EnrichedMealOption,
  EnrichedStay,
  EnrichedTransit,
  ScenarioTrack,
} from '../../model/types';
import { useScenarioSelection } from '../../state/useTripSelections';
import { renderMaterialIcon } from '../shared/materialIcon';
import { NotesCluster } from '../shared/Notes';
import { DayTimeline, ROW_CONTENT_PX } from './DayTimeline';
import { resolveActiveTrack } from './scenarioSelection';

// A branching day's scenarios each become one chip; the chip group picks
// which branch's own timeline shows below. Each scenario's notes render once
// at the top of that scenario's panel, not repeated per activity. See
// scenarioSelection.ts for the follows/requires resolution this wires up to.
//
// A flight-contingent day's own live cloud cover/rain chance/wind already
// shows in DayWeatherStrip, right above these chips — that strip's
// weatherPlaceId follows the same header-title priority as the day's title
// itself, so for a day titled after its own flightseeing Activity (the
// "Flight goes"/"Grounded" case) it's already reading the flightseeing
// spot's own forecast, not the hotel's. No separate fetch/hint needed here.
export function ScenarioTabsSection({
  day,
  tracks,
  visible,
  topLevel,
  daysByDate,
  onOpenActivity,
  onOpenStay,
  onOpenTransit,
}: {
  day: Day;
  tracks: ScenarioTrack[];
  // Pre-filtered by the caller (ScenarioTabsNode, via visibleTracksFor) —
  // it already needs this same list for its own emptiness check before
  // rendering this component at all, so it's passed through rather than
  // recomputed here.
  visible: ScenarioTrack[];
  topLevel: boolean;
  daysByDate: Map<string, Day>;
  onOpenActivity: (activity: EnrichedActivity, selectedOption?: EnrichedMealOption) => void;
  onOpenStay: (stay: EnrichedStay) => void;
  onOpenTransit: (transit: EnrichedTransit) => void;
}) {
  const { scenarioTone, selectScenario } = useScenarioSelection();
  const [localIndex, setLocalIndex] = useState(0);

  if (!visible.length) return null;

  const activeTrack = topLevel
    ? (resolveActiveTrack(day, tracks, daysByDate, scenarioTone, true) ?? visible[0])
    : (visible[localIndex] ?? visible[0]);
  const activeIndex = Math.max(visible.indexOf(activeTrack), 0);

  const handleSelect = (newIndex: number) => {
    const picked = visible[newIndex];
    if (!picked) return;
    if (topLevel) selectScenario(day.date, picked.scenario.tone);
    else setLocalIndex(newIndex);
  };

  return (
    <Box sx={{ mb: 1 }}>
      {/* ScenarioTabsNode strips this content's horizontal padding (see
          DayTimeline.tsx's TrailingGutter/ScenarioTabsNode comments) so the
          nested DayTimeline below stays unindented; ROW_CONTENT_PX re-adds
          the usual inset here, scoped to just the chips/notes. */}
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', px: ROW_CONTENT_PX }}>
        {visible.map((t, i) => {
          const active = i === activeIndex;
          return (
            <Chip
              key={t.scenario._id}
              label={t.scenario.label}
              icon={renderMaterialIcon(t.scenario.icon, { fontSize: 'small' })}
              color={active ? (t.scenario.tone === 'ideal' ? 'primary' : 'error') : 'default'}
              variant={active ? 'filled' : 'outlined'}
              onClick={() => handleSelect(i)}
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
          sequence={activeTrack.sequence}
          containerId={`${day.date}::${activeTrack.scenario._id}`}
          scenarioId={activeTrack.scenario._id}
          daysByDate={daysByDate}
          onOpenActivity={onOpenActivity}
          onOpenStay={onOpenStay}
          onOpenTransit={onOpenTransit}
        />
      </Box>
    </Box>
  );
}
