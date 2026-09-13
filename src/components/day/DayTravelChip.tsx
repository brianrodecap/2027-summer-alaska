import DirectionsIcon from '@mui/icons-material/Directions';
import Skeleton from '@mui/material/Skeleton';
import { useMemo } from 'react';

import { useSegmentLookup } from '../../hooks/useSegmentLookup';
import { lookupTravelInfo } from '../../model/directions';
import { resolveTravelMode } from '../../model/editForms';
import { formatMinutes } from '../../model/formatting';
import { type DayTravelSegment, dayTravelSegments } from '../../model/tripModel';
import type { Day, TravelModeOverride } from '../../model/types';
import { useTripData } from '../../state/useTripData';
import { InfoChip } from '../shared/InfoChip';
import { useDayMapSelections } from './useDayMapSelections';

const TRAVEL_COLOR = '#6d4c41'; // road-brown — distinct from DayWeatherChips' own palette

function hopResultKey(segment: DayTravelSegment): string {
  return `${segment.originId}:${segment.destinationId}`;
}

// The reader's own override for this exact hop (set via DayTimeline's
// TravelInfoControl and read back the same way DayMapSidebar's own
// segmentTravelMode does), or DRIVE by default — including for a hop whose
// segmentKey came back null (see DayTravelSegment's own note on when that
// happens), since there's no override to look up for one anyway.
function resolveHopMode(segment: DayTravelSegment, overrides: TravelModeOverride[]) {
  return segment.segmentKey ? resolveTravelMode(overrides, segment.segmentKey) : 'DRIVE';
}

// Every drivable hop the day's own real places lay out (dayTravelSegments,
// tripModel.ts) gets looked up live and summed via the same shared
// useSegmentLookup batching DayMapSidebar's own route-path/travel-info
// lookups use — the same per-pair lookupTravelInfo call DayTimeline's own
// row-level travel-info footers use, just totaled instead of shown
// individually. A hop with literally no drivable route between its two
// points (fetchRoute's own "no route" case, e.g. no road to a ferry-only
// island) is dropped from the sum rather than blanking the whole total — an
// occasional non-drivable hop inside an otherwise-drivable day shouldn't
// hide every other hop's real total.
function useDayTravelTotal(
  segments: DayTravelSegment[],
  overrides: TravelModeOverride[],
  active: boolean,
) {
  const { value: travelByHop, loading } = useSegmentLookup(
    active ? segments : [],
    // Mode is folded into the cache key (not just the result key) so
    // switching a hop's override actually refetches it, matching
    // DayMapSidebar's own segmentCacheKey/segmentResultKey split.
    (seg) => `${hopResultKey(seg)}:${resolveHopMode(seg, overrides)}`,
    hopResultKey,
    (seg) => lookupTravelInfo(seg.originId, seg.destinationId, resolveHopMode(seg, overrides)),
  );
  let totalMinutes = 0;
  let totalMiles = 0;
  let hopCount = 0;
  for (const hop of travelByHop.values()) {
    totalMinutes += hop.minutes;
    totalMiles += hop.miles;
    hopCount++;
  }
  const value =
    hopCount === 0
      ? null
      : { durationMinutes: Math.round(totalMinutes), distanceMiles: Math.round(totalMiles) };
  return { value, loading };
}

// The day header's own drive-duration/distance row — its own live fetch, but
// the viewport gate that fetch waits on is DayAccordion's, shared with the
// sibling DayWeatherChips row so the two rows observe one element instead of
// two. DaysView renders every Day block unvirtualized, so that gate matters
// here exactly as it does for DayWeatherChips — see that file's own note.
export function DayTravelChip({
  day,
  onOpenMap,
  inView,
}: {
  day: Day;
  onOpenMap: (day: Day) => void;
  inView: boolean;
}) {
  const selections = useDayMapSelections(day);
  const segments = useMemo(() => dayTravelSegments(day, selections), [day, selections]);
  // travelModeOverrides may be undefined while the trip's own data is still
  // loading — resolveHopMode's own default (DRIVE) applies to every hop in
  // that case, same as once it's loaded but simply has no override for a
  // given one (see DayMapSidebar's identical note on its own overrides read).
  const { data } = useTripData();
  const overrides = data?.travelModeOverrides ?? [];
  const { value: travel, loading } = useDayTravelTotal(segments, overrides, inView);

  if (!travel && (!inView || loading)) {
    return <Skeleton variant="text" width={120} />;
  }

  // Always renders a chip once resolved, even with no drivable total (a
  // ferry/flight-only day, or too few resolvable places) — this is the
  // day's only "open the map" action on narrower viewports (DayMapSidebar
  // is lg+ only), so it must never disappear the way it would by
  // returning null here; DayMapPanel itself already renders a plain
  // "nothing resolvable to map yet" message when there's truly nothing to
  // show.
  return (
    <InfoChip
      Icon={DirectionsIcon}
      color={TRAVEL_COLOR}
      text={
        travel ? `${formatMinutes(travel.durationMinutes)} · ${travel.distanceMiles} mi` : 'Map'
      }
      onClick={() => onOpenMap(day)}
    />
  );
}
