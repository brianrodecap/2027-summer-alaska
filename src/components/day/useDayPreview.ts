import { useMemo, useState } from 'react';

import { usePlayback } from '../../hooks/usePlayback';
import { dayClock, dayPreviewSteps } from '../../model/dayPreview';
import type { Coordinates } from '../../model/placeCoordinates';
import { pointOnPath, previewState, previewTotal } from '../../model/routePlanner';
import { activityDurationMinutes, clockZoneOf, type DayMapRouteNode } from '../../model/tripModel';
import type { Day } from '../../model/types';

// The drive that reaches a node: its road once it has loaded, and its minutes.
export interface PreviewLeg {
  key: string;
  fromPoint: Coordinates;
  toPoint: Coordinates;
}

// Preview day: the picked plan played through over ten seconds, timed from when each
// place is visited and the drive times between them, and ended by picking another
// day or plan. `legInto` maps a node's index to the drive that reaches it (none for a
// flight or a place that has not loaded).
export function useDayPreview({
  day,
  planId,
  nodes,
  coords,
  legInto,
  paths,
  driveMinutes,
}: {
  day: Day;
  planId: string;
  nodes: DayMapRouteNode[];
  coords: ReadonlyMap<string, Coordinates>;
  legInto: ReadonlyMap<number, PreviewLeg>;
  paths: ReadonlyMap<string, Coordinates[]>;
  driveMinutes: ReadonlyMap<string, number>;
}) {
  const playback = usePlayback(10_000);
  const [previewing, setPreviewing] = useState(false);
  const key = `${day.date}:${planId}`;
  const [seenKey, setSeenKey] = useState(key);
  if (seenKey !== key) {
    setSeenKey(key);
    setPreviewing(false);
    playback.pause();
  }
  const resolved = nodes.every((node) => coords.has(node.place.id as string));
  const steps = useMemo(
    () =>
      dayPreviewSteps(
        nodes.map((node) => ({
          order: node.order,
          stopMinutes:
            node.ref.kind === 'activity'
              ? (activityDurationMinutes(node.ref.entity, day.selectedMeals) ?? 0)
              : 0,
        })),
        nodes.map((_, i) => {
          const leg = legInto.get(i);
          return leg ? (driveMinutes.get(leg.key) ?? 0) : 0;
        }),
      ),
    [nodes, legInto, driveMinutes, day.selectedMeals],
  );
  const minute = playback.progress * previewTotal(steps);
  const at = previewing && resolved ? previewState(steps, minute) : null;
  const nodePoint = (i: number) => coords.get(nodes[i].place.id as string) as Coordinates;
  const point = (() => {
    if (!at) return null;
    if (at.stop !== null) return nodePoint(at.stop);
    const leg = legInto.get(at.leg);
    return leg
      ? pointOnPath(paths.get(leg.key) ?? [leg.fromPoint, leg.toPoint], at.fraction)
      : nodePoint(at.leg);
  })();
  const caption = at
    ? at.stop !== null
      ? `Stopped at ${nodes[at.stop].place.label} · ${Math.round(steps[at.stop].stop)} min`
      : `${legInto.has(at.leg) ? 'Driving' : 'Heading'} to ${nodes[at.leg].place.label}`
    : null;
  // Read on the first place's clock all day; a day that crosses zones shows the first's.
  const first = nodes[0];
  const clock = first
    ? dayClock(
        first.order + minute * 60_000,
        clockZoneOf({ at: first.at, zone: first.place.timeZone ?? null }, day.clock),
      )
    : '';
  return {
    previewing,
    resolved,
    playback,
    point,
    caption,
    clock,
    // The place the preview is stopped at, for its pin to glow.
    activePlaceId: at?.stop != null ? nodes[at.stop].place.id : null,
    // Whether the camera is following the preview.
    following: at !== null,
    start: () => {
      setPreviewing(true);
      playback.seek(0);
      playback.play();
    },
    close: () => {
      playback.pause();
      setPreviewing(false);
    },
  };
}
