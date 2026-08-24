import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';

import { activeRouteTone } from '../../model/tripModel';
import type { EnrichedTransit } from '../../model/types';
import { useRouteToneSelection } from '../../state/useTripSelections';
import { renderMaterialIcon, ROUTE_TONE_ICON } from '../shared/materialIcon';

// A Route with 2+ variants (e.g. the New vs. Old Glenn Highway) is a
// genuinely undecided choice, anchored to the Depart row — the one place in
// the timeline that's unambiguously "the start of this route." Every
// variant's stages were already walked in buildTripView, so switching here
// just changes which precomputed variant's stages/arrival the rest of the
// timeline shows (see resolvedArrivesAtFor/activeRouteTone in DayTimeline.tsx)
// — no re-walk needed for a plain route-tone switch.
export function RouteVariantTabs({ transit }: { transit: EnrichedTransit }) {
  const info = transit.routeInfo;
  const { routeTones, selectRouteTone } = useRouteToneSelection();
  if (!info || info.variants.length < 2) return null;
  const selectedTone = activeRouteTone(transit, routeTones);
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ mt: 1, flexWrap: 'wrap' }}
      onClick={(e) => e.stopPropagation()}
    >
      {info.variants.map((v) => {
        const active = v.tone === selectedTone;
        return (
          <Chip
            key={v.tone}
            label={v.label}
            icon={renderMaterialIcon(ROUTE_TONE_ICON[v.tone] ?? 'route', { fontSize: 'small' })}
            color={active ? 'primary' : 'default'}
            variant={active ? 'filled' : 'outlined'}
            onClick={() => selectRouteTone(transit._id, v.tone)}
          />
        );
      })}
    </Stack>
  );
}
