import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';

import { materialIcon, ROUTE_TONE_ICON } from '../shared/materialIcon';
import { useTripSelections } from '../../state/TripSelectionsContext';
import type { EnrichedTransit } from '../../model/types';

// A Route with 2+ variants (e.g. the New vs. Old Glenn Highway) is a
// genuinely undecided choice, anchored to the Depart row — the one place in
// the timeline that's unambiguously "the start of this route." Every
// variant's stages were already walked in buildTripView, so switching here
// just changes which precomputed variant's stages/arrival the rest of the
// timeline shows (see resolvedArrivesAtFor/activeRouteTone in DayTimeline.tsx)
// — no re-walk needed for a plain route-tone switch.
export function RouteVariantTabs({ transit }: { transit: EnrichedTransit }) {
  const info = transit.routeInfo;
  const { routeTones, selectRouteTone } = useTripSelections();
  if (!info || info.variants.length < 2) return null;
  const selectedTone = routeTones.get(transit._id) ?? info.selectedTone;
  return (
    <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
      {info.variants.map((v) => {
        const Icon = materialIcon(ROUTE_TONE_ICON[v.tone] ?? 'route');
        const active = v.tone === selectedTone;
        return (
          <Chip
            key={v.tone}
            label={v.label}
            icon={<Icon fontSize="small" />}
            color={active ? 'primary' : 'default'}
            variant={active ? 'filled' : 'outlined'}
            onClick={() => selectRouteTone(transit._id, v.tone)}
          />
        );
      })}
    </Stack>
  );
}
