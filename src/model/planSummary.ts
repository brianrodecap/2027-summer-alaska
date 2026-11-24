import { countLabel } from './formatting';
import { activityZone, compareTimes, formatTime, type ZonedTime } from './tripModel';
import type { Activity, ScenarioTrack, Stay, Transit } from './types';

export interface PlanSummarySources {
  activities: ReadonlyMap<string, Pick<Activity, 'scenarioId' | 'startAt' | 'place' | 'clockZone'>>;
  transits: ReadonlyMap<string, Pick<Transit, 'scenarioId' | 'departsAt' | 'from'>>;
  stays: ReadonlyMap<string, Pick<Stay, 'scenarioId'>>;
}

// One line on a plan's card: how much the plan itself holds on the date and, when
// every item has a time, when it starts. Read from the ids the plan owns, so a plan
// that is not picked, with no rows of its own, still has one. A plan nested inside
// it is its own choice, so what that plan holds is not counted here. A stay is an
// item without a time of its own on the date.
export function planSummary(
  scenarioId: string,
  members: ScenarioTrack['members'],
  { activities, transits, stays }: PlanSummarySources,
): string {
  const own = <T extends { scenarioId: string | null }>(
    ids: string[],
    byId: ReadonlyMap<string, T>,
  ) => ids.flatMap((id) => byId.get(id) ?? []).filter((item) => item.scenarioId === scenarioId);
  const times: (ZonedTime | null)[] = [
    ...own(members.activityIds, activities).map((a) =>
      a.startAt ? { at: a.startAt, zone: activityZone(a) } : null,
    ),
    ...own(members.transitIds, transits).map((t) => ({
      at: t.departsAt,
      zone: t.from.timeZone ?? null,
    })),
    ...own(members.stayIds, stays).map(() => null),
  ];
  const timed = times.filter((time): time is ZonedTime => time !== null);
  const items = countLabel(times.length, 'item');
  // An item with no clock time (a "Morning" activity) could come first, so no start is named.
  if (times.length === 0 || timed.length < times.length) return items;
  const first = timed.reduce((a, b) => (compareTimes(b, a) < 0 ? b : a));
  return `${items} · from ${formatTime(first.at)}`;
}
