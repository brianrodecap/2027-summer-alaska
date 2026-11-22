// Written day titles. A title is written for a date (TripData.dayTitles) or for a
// scenario (Scenario.title); the selected plan's title wins over the date's. Days
// without either fall back to the derived title (liveDays.ts).
//
// Pure, like the rest of src/model.
import { activeTrackOf } from './tripModel';
import type { BoxRow, Day, Scenario, ScenarioTrack, TripData } from './types';

// The innermost selected scenario with a title: the active track of the day's
// split, then the active track of any split nested inside it, and so on.
function innermostTitled(tracks: ScenarioTrack[]): Scenario | undefined {
  let found: Scenario | undefined;
  for (let active = activeTrackOf(tracks); active;) {
    if (active.scenario.title) found = active.scenario;
    const box = active.rows.find((row): row is BoxRow => row.type === 'box');
    active = box ? activeTrackOf(box.tracks) : null;
  }
  return found;
}

// What a day's title is written on: the innermost selected scenario that has a
// title, else the date. Editing the title edits this, so the field always changes
// the text it shows.
export type TitleTarget = { kind: 'scenario'; scenarioId: string } | { kind: 'date'; date: string };

export function titleTarget(day: Pick<Day, 'date' | 'scenarioTracks'>): TitleTarget {
  const titled = innermostTitled(day.scenarioTracks);
  return titled ? { kind: 'scenario', scenarioId: titled._id } : { kind: 'date', date: day.date };
}

// The written title for a day, or null when nothing is written for it.
export function writtenTitle(
  day: Pick<Day, 'date' | 'scenarioTracks'>,
  dateTitles: ReadonlyMap<string, string>,
): string | null {
  return innermostTitled(day.scenarioTracks)?.title ?? dateTitles.get(day.date) ?? null;
}

export function dateTitlesOf(data: Pick<TripData, 'dayTitles'>): Map<string, string> {
  return new Map(data.dayTitles.map((t) => [t._id, t.title]));
}

// Writes `text` as the target's title. Blank text removes it, so the day goes back
// to the next title in line.
export function withTitle(data: TripData, target: TitleTarget, text: string): TripData {
  const title = text.trim();
  if (target.kind === 'date') {
    const others = data.dayTitles.filter((t) => t._id !== target.date);
    return { ...data, dayTitles: title ? [...others, { _id: target.date, title }] : others };
  }
  return {
    ...data,
    scenarios: data.scenarios.map((s) => {
      if (s._id !== target.scenarioId) return s;
      const { title: _old, ...rest } = s;
      return title ? { ...rest, title } : rest;
    }),
  };
}
