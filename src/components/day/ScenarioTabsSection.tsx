import { useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';

import { materialIcon } from '../shared/materialIcon';
import { NotesCluster } from '../shared/Notes';
import { useTripSelections } from '../../state/TripSelectionsContext';
import { resolveActiveTrack, visibleTracksFor } from './scenarioSelection';
import { DayTimeline } from './DayTimeline';
import type { Day, EnrichedActivity, EnrichedMealOption, EnrichedStay, EnrichedTransit, ScenarioTrack } from '../../model/types';

// A branching day's scenarios each become one chip; the chip group picks
// which branch's own timeline shows below. Each scenario's notes render once
// at the top of that scenario's panel, not repeated per activity. See
// scenarioSelection.ts for the follows/requires resolution this wires up to.
export function ScenarioTabsSection({
  day,
  tracks,
  topLevel,
  daysByDate,
  onOpenActivity,
  onOpenStay,
  onOpenTransit,
}: {
  day: Day;
  tracks: ScenarioTrack[];
  topLevel: boolean;
  daysByDate: Map<string, Day>;
  onOpenActivity: (activity: EnrichedActivity, selectedOption?: EnrichedMealOption) => void;
  onOpenStay: (stay: EnrichedStay) => void;
  onOpenTransit: (transit: EnrichedTransit) => void;
}) {
  const { scenarioTone, selectScenario } = useTripSelections();
  const [localIndex, setLocalIndex] = useState(0);

  if (!tracks.length) return null;

  const visible = visibleTracksFor(tracks, daysByDate, scenarioTone, topLevel);
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
    <Box sx={{ my: 1 }}>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
        {visible.map((t, i) => {
          const Icon = materialIcon(t.scenario.icon);
          const active = i === activeIndex;
          return (
            <Chip
              key={t.scenario._id}
              label={t.scenario.label}
              icon={<Icon fontSize="small" />}
              color={active ? (t.scenario.tone === 'ideal' ? 'primary' : 'error') : 'default'}
              variant={active ? 'filled' : 'outlined'}
              onClick={() => handleSelect(i)}
            />
          );
        })}
      </Stack>
      <Box sx={{ mt: 1.5 }}>
        <NotesCluster notes={activeTrack.notes} />
        <DayTimeline
          day={day}
          sequence={activeTrack.sequence}
          daysByDate={daysByDate}
          onOpenActivity={onOpenActivity}
          onOpenStay={onOpenStay}
          onOpenTransit={onOpenTransit}
        />
      </Box>
    </Box>
  );
}
