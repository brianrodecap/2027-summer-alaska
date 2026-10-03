// The read-only tools the Ask AI assistant can call on its own, mid-turn, to look
// things up instead of guessing: a day's live timeline, an entry's full record, notes,
// weather, travel time, real places, and the budget. Each wraps logic the site
// already has (live days, getDayWeather, lookupTravelInfo, searchPlaces, the budget
// view) and returns plain text for the model. None of them can change anything — the
// only way the assistant affects the trip is askAI.ts's propose_* tools, which queue a
// draft for human review.
import type { BetaTool } from '@anthropic-ai/sdk/resources/beta/messages/messages';

import { lookupTravelInfo } from './directions';
import { TRAVEL_MODES } from './formatting';
import { isIsoDate } from './isoDate';
import { searchPlaces } from './places';
import { activityHeadline, formatMoney, formatTime } from './tripModel';
import type { Day, DayRow, Note, Place, TravelMode, TripData, TripView } from './types';
import { getDayWeather } from './weather';

// Everything the tools read, captured when a question is sent. `byDate` is the live
// days — what the reader actually sees for their current scenario/route/meal picks.
export interface AskAIToolContext {
  data: TripData;
  view: TripView;
  byDate: ReadonlyMap<string, Day>;
}

export class ToolInputError extends Error {}

// With eager input streaming on, the API stops validating tool input, so every
// executor checks its own fields; a bad input goes back to the model as an error
// result it can correct, rather than throwing out of the turn.
function stringField(input: unknown, key: string, required: true): string;
function stringField(input: unknown, key: string, required: false): string | undefined;
function stringField(input: unknown, key: string, required: boolean): string | undefined {
  const value = (input as Record<string, unknown> | null)?.[key];
  if (value === undefined || value === null || value === '') {
    if (required) throw new ToolInputError(`Missing required field "${key}".`);
    return undefined;
  }
  if (typeof value !== 'string') throw new ToolInputError(`"${key}" must be a string.`);
  return value;
}

function isoDate(input: unknown): string {
  const date = stringField(input, 'date', true);
  if (!isIsoDate(date)) throw new ToolInputError('"date" must be YYYY-MM-DD.');
  return date;
}

function dayFor(ctx: AskAIToolContext, date: string): Day {
  const day = ctx.byDate.get(date);
  if (day) return day;
  const range = ctx.view.dateRange;
  throw new ToolInputError(
    range
      ? `No trip day on ${date}; the trip runs ${range.startDate} to ${range.endDate}.`
      : `No trip day on ${date}.`,
  );
}

// ---------- get_day ----------

function placeTag(place: Place | null | undefined): string {
  if (!place) return '';
  return place.id ? ` @ ${place.label} (placeId ${place.id})` : ` @ ${place.label}`;
}

function rowTime(at: string, fuzzy: boolean): string {
  return fuzzy ? `~${formatTime(at)}` : formatTime(at);
}

function describeRows(rows: DayRow[], indent: string): string[] {
  return rows.flatMap((row): string[] => {
    switch (row.type) {
      case 'activity': {
        const a = row.activity;
        const duration = a.durationMinutes ? `, ${a.durationMinutes} min` : '';
        const booking = a.booking ? `, booking ${a.booking.status}` : '';
        const meal = a.mealType ? `, ${a.mealType}` : '';
        const line = `${indent}${rowTime(row.event.at, row.event.fuzzy)} Activity ${a._id}: ${activityHeadline(a) || '(untitled)'}${placeTag(row.event.place ?? a.place)} [${a.status}${meal}${duration}${booking}]`;
        // A meal still being decided lists its candidates (the first is the default).
        const candidates = (a.options ?? []).map(
          (o) => `${indent}  candidate:${placeTag(o.place)} (${o.diningFormat})`,
        );
        return [line, ...candidates];
      }
      case 'stay': {
        const s = row.stay;
        const when = row.event ? rowTime(row.event.at, row.event.fuzzy) : 'all day';
        return [
          `${indent}${when} ${row.relation}: ${s.lodging?.place.label ?? '(unnamed lodging)'} — Stay ${s._id}${placeTag(s.lodging?.place)} [${s.status}]`,
        ];
      }
      case 'transit': {
        const t = row.transit;
        const when = rowTime(row.event.at, row.event.fuzzy);
        if (row.phase === 'stage') {
          const note = row.stage.note ? ` — ${row.stage.note}` : '';
          return [
            `${indent}${when} Route stop (Transit ${t._id})${placeTag(row.stage.place)}${note}`,
          ];
        }
        const verb = row.phase === 'depart' ? 'Depart' : 'Arrive';
        return [
          `${indent}${when} ${verb}: ${t.from.label} → ${t.to.label} (${t.mode}) — Transit ${t._id} [${t.status}]`,
        ];
      }
      case 'box':
        return row.tracks.flatMap((track) => [
          `${indent}Option ${track.scenario._id} "${track.scenario.label}" (${track.scenario.tone}, ${track.active ? 'currently selected' : 'not selected'}):`,
          ...(track.active
            ? describeRows(track.rows, `${indent}  `)
            : [`${indent}  (entries hidden while another option is selected)`]),
        ]);
    }
  });
}

function describeNote(note: Note): string {
  return `Note ${note._id} (${note.kind}): ${note.text}`;
}

export function describeDay(day: Day): string {
  return [
    `${day.dateLabel} (${day.date}) — ${day.title}`,
    `Location: ${day.location}. Leg "${day.leg.name}" (legId ${day.leg._id}).`,
    'Timeline, as the reader currently has options selected:',
    ...describeRows(day.rows, '  '),
    ...(day.notes.length ? ['Day notes:', ...day.notes.map((n) => `  ${describeNote(n)}`)] : []),
  ].join('\n');
}

// ---------- get_entity ----------

export function findEntity(data: TripData, id: string): { kind: string; entity: unknown } | null {
  const collections = [
    ['activity', data.activities],
    ['stay', data.stays],
    ['transit', data.transits],
    ['scenario', data.scenarios],
    ['note', data.notes],
    ['leg', data.legs],
    ['route', data.routes],
  ] as const;
  for (const [kind, items] of collections) {
    const entity = (items as { _id: string }[]).find((item) => item._id === id);
    if (entity) return { kind, entity };
  }
  return null;
}

function notesConcerning(data: TripData, id: string): Note[] {
  return data.notes.filter((n) => n.concerns.some((ref) => 'entity' in ref && ref.id === id));
}

// ---------- the tool set ----------

const DATE_PROPERTY = { type: 'string', description: 'ISO date, YYYY-MM-DD.' } as const;

const READ_TOOL_DEFINITIONS: BetaTool[] = [
  {
    name: 'get_day',
    description:
      "One trip day's timeline exactly as the reader currently sees it (their selected scenario options, route variants and meal choices): every activity, stay boundary, transit departure/arrival and route stop with times, ids, place ids and status, the day's options, and its notes.",
    input_schema: {
      type: 'object',
      properties: { date: DATE_PROPERTY },
      required: ['date'],
    },
  },
  {
    name: 'get_entity',
    description:
      'The full stored record for one activity, stay, transit, scenario, note, leg or route by its id — booking details, cost, confirmation, meal options, packages — plus every note attached to it.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The entity _id.' } },
      required: ['id'],
    },
  },
  {
    name: 'search_notes',
    description:
      "Find the trip's notes (warnings, info, footnotes) by text and/or by the date they concern.",
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Case-insensitive text to look for.' },
        date: { ...DATE_PROPERTY, description: 'Only notes that concern this date (YYYY-MM-DD).' },
      },
    },
  },
  {
    name: 'get_weather',
    description:
      "Weather for a trip day at that day's own places: sunrise/sunset, high/low °F, and — inside the ~2-week forecast window only — cloud cover, chance of rain and wind. Beyond the window it returns a multi-year climate average instead (isForecast false); say so when you use it.",
    input_schema: {
      type: 'object',
      properties: { date: DATE_PROPERTY },
      required: ['date'],
    },
  },
  {
    name: 'get_travel_time',
    description:
      'Travel time and distance between two real places by their Google place ids (from get_day, get_entity or search_places).',
    input_schema: {
      type: 'object',
      properties: {
        fromPlaceId: { type: 'string' },
        toPlaceId: { type: 'string' },
        mode: { type: 'string', enum: TRAVEL_MODES, description: 'Defaults to DRIVE.' },
      },
      required: ['fromPlaceId', 'toPlaceId'],
    },
  },
  {
    name: 'search_places',
    description:
      'Search Google Places for a real place (restaurant, trailhead, museum, ...) — returns up to five matches with their place ids, which propose_edit and propose_day_plan accept as placeId.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Name plus town, e.g. "Alaska SeaLife Center Seward".',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_budget',
    description:
      'Trip budget totals — spent, pending and estimated amounts, the number of entries with no cost yet — overall and per leg.',
    input_schema: { type: 'object', properties: {} },
  },
];

// Eager input streaming sends tool input as it's generated instead of buffering it;
// the executors below validate it themselves, since the API no longer does.
export const READ_TOOLS: BetaTool[] = READ_TOOL_DEFINITIONS.map((tool) => ({
  ...tool,
  eager_input_streaming: true,
}));

export const READ_TOOL_NAMES: ReadonlySet<string> = new Set(READ_TOOLS.map((t) => t.name));

export async function runReadTool(
  name: string,
  input: unknown,
  ctx: AskAIToolContext,
): Promise<string> {
  switch (name) {
    case 'get_day':
      return describeDay(dayFor(ctx, isoDate(input)));

    case 'get_entity': {
      const id = stringField(input, 'id', true);
      const found = findEntity(ctx.data, id);
      if (!found) throw new ToolInputError(`No entity with id ${id}.`);
      const notes = found.kind === 'note' ? [] : notesConcerning(ctx.data, id);
      return JSON.stringify({ kind: found.kind, entity: found.entity, notes });
    }

    case 'search_notes': {
      const text = stringField(input, 'text', false)?.toLowerCase();
      const date = stringField(input, 'date', false);
      const pool = date ? dayFor(ctx, date).notes : ctx.data.notes;
      const matches = text ? pool.filter((n) => n.text.toLowerCase().includes(text)) : pool;
      if (!matches.length) return 'No matching notes.';
      const shown = matches.slice(0, 25).map(describeNote);
      const more = matches.length > 25 ? [`(${matches.length - 25} more not shown)`] : [];
      return [...shown, ...more].join('\n');
    }

    case 'get_weather': {
      const date = isoDate(input);
      const day = dayFor(ctx, date);
      const weather = await getDayWeather(
        {
          sunrisePlaceId: day.sunrisePlaceId,
          sunsetPlaceId: day.sunsetPlaceId,
          weatherPlaceId: day.weatherPlaceId,
          airQualityPlaceId: null,
          marinePlaceId: null,
        },
        date,
      );
      if (!weather) return `No weather is available for ${date} (no resolvable place that day).`;
      return JSON.stringify({ date, location: day.location, ...weather });
    }

    case 'get_travel_time': {
      const from = stringField(input, 'fromPlaceId', true);
      const to = stringField(input, 'toPlaceId', true);
      const mode = (stringField(input, 'mode', false) ?? 'DRIVE') as TravelMode;
      if (!TRAVEL_MODES.includes(mode)) throw new ToolInputError(`Unknown mode ${mode}.`);
      const travel = await lookupTravelInfo(from, to, mode);
      if (!travel) return `No ${mode.toLowerCase()} route found between those places.`;
      return JSON.stringify({ mode, minutes: travel.minutes, miles: travel.miles });
    }

    case 'search_places': {
      const results = await searchPlaces(stringField(input, 'query', true));
      if (!results.length) return 'No places found.';
      return results.map((p) => `${p.label} — ${p.address} (placeId ${p.id})`).join('\n');
    }

    case 'get_budget': {
      const { budget } = ctx.view;
      const totals = (t: typeof budget.totals) => ({
        spent: formatMoney(t.currency ? { amount: t.spent, currency: t.currency } : null),
        pending: formatMoney(t.currency ? { amount: t.pending, currency: t.currency } : null),
        estimated: formatMoney(t.currency ? { amount: t.estimated, currency: t.currency } : null),
        entriesWithNoCost: t.unplannedCount,
      });
      return JSON.stringify({
        overall: totals(budget.totals),
        byLeg: budget.byLeg.map((g) => ({
          leg: g.leg.name,
          legId: g.leg._id,
          ...totals(g.totals),
        })),
      });
    }

    default:
      throw new ToolInputError(`Unknown tool ${name}.`);
  }
}

// The one-line label the chat shows for each lookup while the turn runs, e.g.
// "Looked at 2027-07-14" — what the assistant checked, in the reader's terms.
export function readToolLabel(name: string, input: unknown): string {
  const field = (key: string) => (input as Record<string, unknown> | null)?.[key];
  switch (name) {
    case 'get_day':
      return `Looked at ${String(field('date') ?? 'a day')}`;
    case 'get_entity':
      return 'Read an entry';
    case 'search_notes':
      return 'Searched notes';
    case 'get_weather':
      return `Checked weather for ${String(field('date') ?? 'a day')}`;
    case 'get_travel_time':
      return 'Checked travel time';
    case 'search_places':
      return `Searched places for "${String(field('query') ?? '')}"`;
    case 'get_budget':
      return 'Checked the budget';
    default:
      return name;
  }
}
