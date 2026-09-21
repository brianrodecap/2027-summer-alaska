// Loads a trip's raw entity collections (public/data/<slug>/*.json — see
// docs/data-model.html for the schema) and derives the one thing the model
// deliberately never stores: "what's happening on a given date." Nothing here
// is content — the itinerary itself lives entirely in the JSON.
//
// All dates/timestamps are compared as plain ISO strings ('YYYY-MM-DD' /
// 'YYYY-MM-DDTHH:MM'), never parsed into local-timezone Date objects — the
// zero-padded format sorts and compares correctly as strings, which sidesteps
// timezone drift entirely for a site with no timezone-sensitive behavior.
// This is a hard boundary: nothing in this file should ever construct a
// `Date`/`dayjs` object and hand it to a caller, or accept one as an input —
// picker components convert to/from plain strings at their own edge instead.

import { firstImage } from './formatting';
import type {
  Activity,
  Booking,
  BookingProgress,
  BookingStatus,
  BoxRow,
  BudgetDayGroup,
  BudgetLegGroup,
  BudgetLineItem,
  BudgetRow,
  BudgetTotals,
  BudgetTravelerGroup,
  BudgetView,
  DateRange,
  Day,
  DayFrame,
  DayRow,
  DiningFormat,
  EnrichedActivity,
  EnrichedMealOption,
  EnrichedStay,
  EnrichedTransit,
  Leg,
  LegSummary,
  LiveRouteOverrides,
  Money,
  Note,
  Package,
  Place,
  Ref,
  RefEntityKind,
  ResolvedRouteInfo,
  ResolvedRouteVariant,
  Route,
  RoutePlaceEntry,
  RouteStage,
  Scenario,
  ScenarioTrack,
  Stay,
  StayRelation,
  Transit,
  TransitRow,
  Traveler,
  Trip,
  TripData,
  TripsIndexEntry,
  TripView,
} from './types';

export async function loadTripData(slug: string): Promise<TripData> {
  const base = `${import.meta.env.BASE_URL}data/${slug}/`;
  const files = [
    'trip',
    'legs',
    'stays',
    'transits',
    'activities',
    'scenarios',
    'notes',
    'travelModeOverrides',
  ] as const;
  const [[trip, legs, stays, transits, activities, scenarios, notes, travelModeOverrides], routes] =
    await Promise.all([
      Promise.all(files.map((f) => fetch(`${base}${f}.json`).then((r) => r.json()))),
      fetch(`${import.meta.env.BASE_URL}data/routes.json`).then((r) => r.json()),
    ]);
  return { trip, legs, stays, transits, activities, scenarios, notes, travelModeOverrides, routes };
}

// public/data/trips.json lists only trip slugs (the folder names under
// public/data/); everything displayed about a trip — name, dates — is read
// from that trip's own trip.json (plus legs.json, for its computed date
// range), never duplicated into the index. stays/transits/activities are
// fetched too, purely so the trips list can show each trip's computed
// booking status (tripBookingProgress) without a full loadTripData.
export async function loadTripsIndex(): Promise<TripsIndexEntry[]> {
  const manifest: { slug: string }[] = await fetch(
    `${import.meta.env.BASE_URL}data/trips.json`,
  ).then((r) => r.json());
  return Promise.all(
    manifest.map(async ({ slug }) => {
      const base = `${import.meta.env.BASE_URL}data/${slug}/`;
      const [trip, legs, stays, transits, activities] = await Promise.all([
        fetch(`${base}trip.json`).then((r) => r.json()),
        fetch(`${base}legs.json`).then((r) => r.json()),
        fetch(`${base}stays.json`).then((r) => r.json()),
        fetch(`${base}transits.json`).then((r) => r.json()),
        fetch(`${base}activities.json`).then((r) => r.json()),
      ]);
      return { slug, trip, legs, stays, transits, activities };
    }),
  );
}

// ---------- date/time formatting ----------

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

export function addDaysStr(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function dateRangeArray(start: string, end: string): string[] {
  const out: string[] = [];
  for (let cur = start; cur <= end; cur = addDaysStr(cur, 1)) out.push(cur);
  return out;
}

export function formatDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[weekday]} ${MONTHS[m - 1]} ${d}`;
}

function formatFullDate(dateStr: string): string {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${FULL_MONTHS[m - 1]} ${d}`;
}

export interface ScenarioDateInfo {
  date: string | null;
  tentative: boolean;
}

// The scenario this one narratively follows, as an id rather than a literal
// date — an explicit followsScenarioId if the authoring set one (an ungated
// "always follows this day" scenario, with no requiresScenarioId of its own
// to borrow), otherwise the first entry of requiresScenarioId itself (a
// gated scenario already names exactly which prior-day scenario it depends
// on, so that doubles as "which day I follow" for free — every sibling in a
// requiresScenarioId list lives on the same followed day, so any single
// entry resolves to the right date). Resolving *through* an id like this,
// rather than trusting a hand-typed calendar date, is what keeps a follower
// correct automatically when the followed scenario's own content moves to a
// new date — see resolveScenarioDates below and scenarioGroups.ts's own
// use of this same helper for the day-list's live tab gating.
export function followedScenarioId(scenario: Scenario): string | null {
  return scenario.followsScenarioId ?? scenario.requiresScenarioId?.[0] ?? null;
}

// A Scenario carries no reliable date of its own to sort/group a flat
// management list by: `date` is only a placement hint consulted while no
// real content exists yet (see that field's own comment on Scenario), and
// even the _id/label are just authoring artifacts that can drift from
// where the scenario actually ends up (e.g. `scenario_jul6_ideal`'s real
// Activities land on Jul 8, not Jul 6). This answers a different question
// than layoutDay (dayLayout.ts) does — that function only ever asks "is
// this scenario visible on date X, and where does it anchor within that
// one day," never "what single date does this scenario resolve to across
// the whole trip" — so its own precedence is defined fresh here rather than
// reused: a scenario's own linked Activity/Transit content, then a
// parentScenarioId child's own content, then whatever date the scenario
// named by followedScenarioId itself resolves to plus one day (marked
// tentative — it's only "the day after whatever this follows," not
// necessarily where it'll really land, and recurses through this same
// resolve() so a multi-day chain of followers all stay correct together),
// then the placement hint.
export function resolveScenarioDates(
  scenarios: Scenario[],
  activities: Activity[],
  transits: Transit[],
): Map<string, ScenarioDateInfo> {
  const ownDates = new Map<string, string[]>();
  const pushOwn = (id: string | null, date: string) => {
    if (!id) return;
    const list = ownDates.get(id);
    if (list) list.push(date);
    else ownDates.set(id, [date]);
  };
  for (const a of activities) {
    const date = resolveActivityDate(a);
    if (date) pushOwn(a.scenarioId, date);
  }
  for (const t of transits) pushOwn(t.scenarioId, dateOnly(t.departsAt));

  const childrenOf = new Map<string, Scenario[]>();
  for (const s of scenarios) {
    if (!s.parentScenarioId) continue;
    const list = childrenOf.get(s.parentScenarioId);
    if (list) list.push(s);
    else childrenOf.set(s.parentScenarioId, [s]);
  }
  const byId = new Map(scenarios.map((s) => [s._id, s]));
  const memo = new Map<string, ScenarioDateInfo>();
  const visiting = new Set<string>();

  function resolve(id: string): ScenarioDateInfo {
    const cached = memo.get(id);
    if (cached) return cached;
    if (visiting.has(id)) return { date: null, tentative: false };
    visiting.add(id);

    let result: ScenarioDateInfo = { date: null, tentative: false };
    const own = ownDates.get(id);
    if (own?.length) {
      result = { date: [...own].sort()[0], tentative: false };
    } else {
      const childDates = (childrenOf.get(id) ?? [])
        .map((child) => resolve(child._id))
        .filter((info): info is ScenarioDateInfo & { date: string } => info.date !== null)
        .sort((a, b) => a.date.localeCompare(b.date));
      const scenario = byId.get(id);
      if (childDates.length) {
        result = childDates[0];
      } else {
        const followedId = scenario ? followedScenarioId(scenario) : null;
        const followedDate = followedId ? resolve(followedId).date : null;
        if (followedDate) {
          result = { date: addDaysStr(followedDate, 1), tentative: true };
        } else if (scenario?.date) {
          result = { date: scenario.date, tentative: false };
        }
      }
    }

    visiting.delete(id);
    memo.set(id, result);
    return result;
  }

  for (const s of scenarios) resolve(s._id);
  return memo;
}

// Shared date-bucketing for scenario pickers/lists that need to disambiguate
// otherwise-identical-looking candidates — ScenariosDialog's own management
// list and the "Requires one of"/"Parent scenario" pickers in
// ScenarioEditForm all group by this same resolved date instead of each
// re-deriving their own grouping. Chronological by date, unscheduled (null)
// last; each bucket orders its ideal branch before its alternate, then by
// label, so a same-day ideal/alternate pair reads in a stable order.
// Ideal branch before alternate, then by label — the stable order a same-day
// (or same-parent) ideal/alternate pair reads in, shared by groupScenariosByDate
// below and ScenariosDialog's own sibling sort.
export function compareScenariosByToneAndLabel<T extends Pick<Scenario, 'label' | 'tone'>>(
  a: T,
  b: T,
): number {
  return (
    (a.tone === 'ideal' ? 0 : 1) - (b.tone === 'ideal' ? 0 : 1) || a.label.localeCompare(b.label)
  );
}

export function groupScenariosByDate<T extends Pick<Scenario, '_id' | 'label' | 'tone'>>(
  scenarios: T[],
  dateInfoById: Map<string, ScenarioDateInfo>,
): { date: string | null; scenarios: T[] }[] {
  const byDate = new Map<string | null, T[]>();
  for (const s of scenarios) {
    const key = dateInfoById.get(s._id)?.date ?? null;
    const list = byDate.get(key);
    if (list) list.push(s);
    else byDate.set(key, [s]);
  }
  for (const list of byDate.values()) {
    list.sort(compareScenariosByToneAndLabel);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a ?? '9999-99-99').localeCompare(b ?? '9999-99-99'))
    .map(([date, list]) => ({ date, scenarios: list }));
}

// Neither Trip nor Leg authors its own date span — each is computed as the
// outer bound of whichever Stay/Transit/Activity documents actually fall
// under it, same as everything else this file derives instead of
// duplicating. null once there's nothing dated to bound.
// A Transit as the date-range walk sees it: raw (no routeInfo) or enriched
// (routeInfo carries every route variant's own resolved arrival).
type DatedTransit = Transit & { routeInfo?: ResolvedRouteInfo | null };

function collectEntityDates(
  stays: Stay[],
  transits: DatedTransit[],
  activities: Activity[],
): string[] {
  const dates: string[] = [];
  for (const s of stays) {
    dates.push(dateOnly(s.checkInAt), dateOnly(s.checkOutAt));
  }
  for (const t of transits) {
    dates.push(dateOnly(t.departsAt));
    if (t.arrivesAt) dates.push(dateOnly(t.arrivesAt));
    // Every route variant's own arrival counts, not just the default's: a
    // non-default variant can reach a later day, and that day needs a block
    // for its Arrive row to land in once the reader selects that variant.
    for (const v of t.routeInfo?.variants ?? []) dates.push(dateOnly(v.arrivesAt));
  }
  for (const a of activities) {
    if (a.startAt) {
      dates.push(dateOnly(a.startAt));
      // Only an explicitly authored duration extends the range here — same
      // as endAt never being a meal-format estimate before.
      if (a.durationMinutes) {
        dates.push(dateOnly(addMinutesIso(a.startAt, a.durationMinutes)));
      }
    }
    if (a.date) dates.push(a.date);
  }
  return dates;
}

export function tripDateRange(
  stays: Stay[],
  transits: DatedTransit[],
  activities: Activity[],
): DateRange | null {
  const dates = collectEntityDates(stays, transits, activities);
  if (!dates.length) return null;
  let startDate = dates[0];
  let endDate = dates[0];
  for (const d of dates) {
    if (d < startDate) startDate = d;
    if (d > endDate) endDate = d;
  }
  return { startDate, endDate };
}

// A single Leg's own span — the same outer-bound computation, narrowed to
// just the entities pointing at this one legId.
export function legDateRange(
  legId: string,
  stays: Stay[],
  transits: DatedTransit[],
  activities: Activity[],
): DateRange | null {
  return tripDateRange(
    stays.filter((s) => s.legId === legId),
    transits.filter((t) => t.legId === legId),
    activities.filter((a) => a.legId === legId),
  );
}

export function formatTripDateChip(range: DateRange, dayCount: number): string {
  return `${formatFullDate(range.startDate)} – ${formatFullDate(range.endDate)}, ${range.endDate.slice(0, 4)} · ${dayCount} days`;
}

// Plain "<start> – <end>" span, no year/day-count — used by the Leg card and
// dialog, as opposed to formatTripDateChip's fuller trip-summary form.
export function formatDateRangeLabel(range: DateRange): string {
  return `${formatDateLabel(range.startDate)} – ${formatDateLabel(range.endDate)}`;
}

// Lets the trips list show a day count from a computed range alone, without
// building that trip's full day-by-day view.
export function tripDayCount(range: DateRange): number {
  return dateRangeArray(range.startDate, range.endDate).length;
}

// ---------- booking progress (Trip/Leg's own status, computed) ----------
//
// Trip and Leg carry no status field of their own (see BookingProgress in
// types.ts) — it's rolled up from whatever leaf entities (Stay/Transit/
// Activity, plus Stay.packages) actually carry a booking. A Leg bought as
// one bundle (skeletonAuthority: 'operator', e.g. a cruise fare) is judged
// on its own booking alone, rather than diluted by the unbooked odds and
// ends (shore excursions, included meals) underneath it.

// A single Leg's own "counted units": just its own booking when it has one
// (an operator-bundled leg is one unit, booked or not), otherwise every
// booking.status underneath it — one per Stay/Transit/Activity that has a
// booking at all, plus one per Stay Package. Entities with no booking
// (nothing to reserve — a free morning, an included meal) aren't counted:
// they're neither "needs booking" nor "booked".
function legBookingStatuses(
  leg: Leg,
  stays: Stay[],
  transits: Transit[],
  activities: Activity[],
): BookingStatus[] {
  if (leg.booking) return [leg.booking.status];
  const legStays = stays.filter((s) => s.legId === leg._id);
  return [
    ...legStays.map((s) => s.booking?.status),
    ...legStays.flatMap((s) => s.packages?.map((p) => p.status) ?? []),
    ...transits.filter((t) => t.legId === leg._id).map((t) => t.booking?.status),
    ...activities.filter((a) => a.legId === leg._id).map((a) => a.booking?.status),
  ].filter((s): s is BookingStatus => s != null);
}

function summarizeBookingStatuses(statuses: BookingStatus[]): BookingProgress {
  if (!statuses.length) return 'unplanned';
  const bookedCount = statuses.filter((s) => s === 'booked').length;
  if (bookedCount === statuses.length) return 'booked';
  if (bookedCount === 0) return 'unplanned';
  return 'partial';
}

// The gauge-friendly counterpart to summarizeBookingStatuses — what percent
// of the same counted units are booked, 0 when there's nothing bookable yet.
function percentBooked(statuses: BookingStatus[]): number {
  if (!statuses.length) return 0;
  const bookedCount = statuses.filter((s) => s === 'booked').length;
  return Math.round((bookedCount / statuses.length) * 100);
}

export interface BookingSummary {
  progress: BookingProgress;
  percent: number;
}

export function legBookingSummary(
  leg: Leg,
  stays: Stay[],
  transits: Transit[],
  activities: Activity[],
): BookingSummary {
  const statuses = legBookingStatuses(leg, stays, transits, activities);
  return { progress: summarizeBookingStatuses(statuses), percent: percentBooked(statuses) };
}

export function tripBookingSummary(
  legs: Leg[],
  stays: Stay[],
  transits: Transit[],
  activities: Activity[],
): BookingSummary {
  if (!legs.length) return { progress: 'unplanned', percent: 0 };
  const statuses = legs.flatMap((leg) => legBookingStatuses(leg, stays, transits, activities));
  return { progress: summarizeBookingStatuses(statuses), percent: percentBooked(statuses) };
}

export function formatTime(iso: string): string {
  let [h, m] = iso.slice(11, 16).split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')}${ampm}`;
}

export function formatMoney(cost: Money | null | undefined): string | null {
  if (!cost) return null;
  return cost.amount.toLocaleString('en-US', { style: 'currency', currency: cost.currency });
}

// A Transit's or Route's endpoints, rendered the same way everywhere they're
// summarized in one line — the day list, edit forms, and the Routes dialog.
export function transitRouteLabel(endpoints: {
  from: { label: string | null };
  to: { label: string | null };
}): string {
  return `${endpoints.from.label || '?'} → ${endpoints.to.label || '?'}`;
}

// formatOverrides threads through to activityDurationMinutes for a still-
// open meal recomputing its span against a specific candidate's diningFormat
// rather than the Activity's own stored one — see mealOptions.ts's
// mealOptionTimeLabel, the only caller that ever passes it.
export function activityTimeLabel(
  activity: Pick<
    Activity,
    '_id' | 'startAt' | 'durationMinutes' | 'timeLabel' | 'mealType' | 'diningFormat' | 'options'
  >,
  formatOverrides?: Map<string, DiningFormat>,
): string {
  if (activity.startAt) {
    const minutes = activityDurationMinutes(activity, formatOverrides);
    const end = minutes != null ? addMinutesIso(activity.startAt, minutes) : null;
    return formatTime(activity.startAt) + (end ? `–${formatTime(end)}` : '');
  }
  if (activity.timeLabel) return activity.timeLabel;
  return 'Time TBD';
}

// The one place every reader of an Activity's display text goes through,
// rather than reading .text directly — text is null whenever a Place
// already names the row (see the Activity.text doc comment in types.ts), so
// the place's own name is the fact of record in that case instead of a
// second, possibly-stale copy of it.
export function activityHeadline(activity: Pick<Activity, 'text' | 'place'>): string {
  return activity.text ?? activity.place?.label ?? '';
}

// Which place's coordinates a sun-anchored ('Sunrise'/'Sunset' timeLabel, no
// startAt) Activity's real clock time should be computed from: the
// Activity's own Place when it names one (e.g. "Sunrise at Sheep Mountain
// overlook" wants that overlook's own horizon, not the day's generic
// anchor), falling back to the Day's own resolved sunrise/sunset anchor
// place (day.sunrisePlaceId/sunsetPlaceId — see this file's own
// dayPlaceIds-derived sunrisePlaceId/sunsetPlaceId assignment) for a
// sun-anchored activity that names no place of its own (e.g. a bare
// "Sunrise" banner activity). Pure Activity+Day derivation, so it lives here
// rather than in useSunAnchoredTime, which only owns the fetch itself.
export function resolveSunPlaceId(
  activity: Pick<EnrichedActivity, 'place' | 'timeLabel'>,
  day: Pick<Day, 'sunrisePlaceId' | 'sunsetPlaceId'>,
): string | null {
  if (activity.place?.id) return activity.place.id;
  return activity.timeLabel === 'Sunrise' ? day.sunrisePlaceId : day.sunsetPlaceId;
}

// ---------- Activity's date is usually implied by startAt. The fuzzy-time
// path (timeLabel only, no exact startAt — see TIME_LABEL_ANCHORS below) has
// no timestamp to read a date from, so Activity carries an explicit `date`
// field for exactly that case (data-model.html) — set only when startAt is
// null, alongside timeLabel. ----------

export function resolveActivityDate(activity: Activity): string | null {
  if (activity.startAt) return dateOnly(activity.startAt);
  return activity.date ?? null;
}

// An Activity's calendar date plus its position on that date's timeline (the
// same key timeline events and scenario-box anchors both sort by), or null
// while it's still undated. One shared rule so a box's anchor can never drift
// from the rows it sits among.
export function activityTimelineKey(activity: Activity): { date: string; at: string } | null {
  const date = resolveActivityDate(activity);
  if (!date) return null;
  const midnight = `${date}T00:00`;
  const at =
    activity.startAt || activity.timeLabel ? activitySortKey(activity, midnight) : midnight;
  return { date, at };
}

// The lexicographically earliest of a set of timeline keys, or null when empty.
export const earliestKey = (keys: string[]): string | null =>
  keys.reduce<string | null>((min, key) => (min === null || key < min ? key : min), null);

// ---------- Note.concerns matching — see docs/data-model.html's Ref type.
// Notes are bucketed to exactly one drill-down level by which kind of ref they
// carry: entity:leg -> the Leg dialog, entity:stay/entity:transit -> that
// Stay/Transit's own day-list row (a Transit's notes attach at its Depart
// row, never Arrive), entity:scenario -> the top of that scenario's own tab
// panel, entity:activity -> that Activity's own day-list row (and its side
// sheet), entity:mealOption -> one specific MealOption candidate, shown only
// while the row's chip group has that candidate selected (unlike every other
// kind here, which always renders — a mealOption note is conditional on live
// UI selection state, not just a resolved Day). A bare date/dateRange ref
// with no entity has no row of its own to attach to, so it's the only kind
// notesForDay still pools at the whole day. A note with several refs (e.g.
// one leg ref plus a dateRange) naturally surfaces at more than one level.
// ----------

function refMatchesDate(ref: Ref, date: string): boolean {
  if ('date' in ref) return ref.date === date;
  if ('dateRange' in ref) return date >= ref.dateRange[0] && date <= ref.dateRange[1];
  return false;
}

// Notes bucketed by the entity they directly name, built once per
// buildTripView so each enriched Activity/MealOption/Stay/Transit/Leg/
// Scenario looks its own notes up in O(1) instead of rescanning every note's
// refs. `notes` keeps the original list for notesForDay's date-ref matching.
interface NoteIndex {
  notes: Note[];
  byEntity: Map<string, Note[]>;
}

const noteEntityKey = (entity: RefEntityKind, id: string): string => `${entity}:${id}`;

function buildNoteIndex(notes: Note[]): NoteIndex {
  const byEntity = new Map<string, Note[]>();
  for (const note of notes) {
    // A note naming the same entity through more than one ref still counts
    // once for it, same as the filter-based lookup this replaced.
    const keys = new Set(
      note.concerns.flatMap((r) => ('entity' in r ? [noteEntityKey(r.entity, r.id)] : [])),
    );
    for (const key of keys) {
      const bucket = byEntity.get(key);
      if (bucket) bucket.push(note);
      else byEntity.set(key, [note]);
    }
  }
  return { notes, byEntity };
}

// One bucket per RefEntityKind a note can name directly (leg/stay/transit/
// scenario/activity) — each rendered right at that entity's own spot in the
// UI (its day-list row, its side sheet, its tab section, its dialog) rather
// than pooled at the day level. Only a bare date/dateRange ref (no entity)
// has nowhere more specific to attach than the day itself — that's all
// notesForDay matches now.
function notesForEntity(index: NoteIndex, entity: RefEntityKind, id: string): Note[] {
  return index.byEntity.get(noteEntityKey(entity, id)) ?? [];
}

function notesForDay(index: NoteIndex, date: string): Note[] {
  return index.notes.filter((n) => n.concerns.some((r) => refMatchesDate(r, date)));
}

function entityHasWarning(index: NoteIndex, entity: RefEntityKind, id: string): boolean {
  return notesForEntity(index, entity, id).some((n) => n.kind === 'warning');
}

// ---------- filter tags — the token vocabulary the trip page's filter nav
// reads to show or hide each Stay/Transit/Activity row. Every row always
// carries at least a leg:<id> token; the booking/attr tokens only get added
// when the entity actually has something to say on that axis. filters logic
// groups tokens by their `prefix:` (OR within a group, AND across groups), so
// this is the entire vocabulary a new filter option would need to plug into.

// Deliberately never rolls a Leg's own bundle-level booking (e.g. leg_cruise's
// paid-in-full booking) down onto a child with no booking of its own: a
// bundled leg being booked doesn't mean everything inside it is settled —
// shore excursions and specialty-dining reservations are booked (or not)
// independently of the cruise fare, and already carry their own `booking`
// (Activity) / MealOption.booking accordingly. A child with no booking at all
// (an included/onboard activity that was never a separately bookable thing)
// stays untagged rather than being labeled either "Booked" or "Needs
// booking".
//
// A still-open meal Activity has no single booking of its own — each
// candidate books (or doesn't) independently, and more than one can carry a
// real reservation at once (e.g. backup tables held at two restaurants while
// still deciding). Rather than guessing which candidate "counts" (that's a
// live UI selection this pure tag function has no access to), both tags can
// apply at once here: a meal with one booked candidate and one still-unbooked
// one matches *both* "Booked" and "Needs booking" — each true of some part of
// this row, and the filter nav already ORs multiple tokens within a group.
function resolveBookingTags(entity: {
  booking?: Booking | null;
  options?: { booking: Booking | null }[] | null;
}): string[] {
  const statuses = new Set(
    [entity.booking, ...(entity.options ?? []).map((o) => o.booking)].map((b) => b?.status),
  );
  const tags: string[] = [];
  if (statuses.has('booked')) tags.push('booking:booked');
  if (statuses.has('planning')) tags.push('booking:needs');
  return tags;
}

// The `leg:` tag always comes from the entity's own legId, not the day's
// (day.leg) — on a same-day leg handoff, a day's sequence mixes entities
// from more than one leg, and each still needs to filter under its own.
export function filterTagsFor(entity: {
  legId: string;
  booking?: Booking | null;
  options?: { booking: Booking | null }[] | null;
  priority?: string | null;
  hasWarningNote?: boolean;
  transitOverlapWarning?: string | null;
}): string[] {
  const tags = [`leg:${entity.legId}`, ...resolveBookingTags(entity)];
  if (entity.priority) tags.push('attr:highlight');
  if (entity.hasWarningNote || entity.transitOverlapWarning) tags.push('attr:attention');
  return tags;
}

// ---------- building the computed Day view ----------

export function stayOverlapsDay(stay: Stay, dayStart: string, dayEnd: string): boolean {
  return stay.checkInAt < dayEnd && stay.checkOutAt > dayStart;
}

// A Transit *belongs* to the single day it departs — this is what dedupes
// it (its own day.transits entry, leg attribution, etc.) rather than
// double-counting it across every calendar date its [departsAt, arrivesAt)
// span touches. That's a separate question from which day each of its
// rendered sequence items lands on, though: a stage or the Arrive boundary
// past midnight still renders under the next day's block — see
// transitItemsOnDate, which is what actually decides that.
function transitDepartsOnDay(transit: Transit, date: string): boolean {
  return dateOnly(transit.departsAt) === date;
}

// Every calendar date any part of a Transit lands on — its depart, its own
// arrival, and every route variant's stages and arrival (not just the selected
// variant's: a scenario's tab must exist on each date ANY variant reaches).
export function transitTouchedDates(
  transit: { departsAt: string; arrivesAt: string | null },
  routeInfo: ResolvedRouteInfo | null,
): Set<string> {
  const dates = new Set([dateOnly(transit.departsAt)]);
  if (transit.arrivesAt) dates.add(dateOnly(transit.arrivesAt));
  for (const variant of routeInfo?.variants ?? []) {
    dates.add(dateOnly(variant.arrivesAt));
    for (const stage of variant.stages) dates.add(dateOnly(stage.key));
  }
  return dates;
}

// Which of today's two boundary events (if either) this Stay is part of.
// Exported because both the timeline sort below and the renderer's label
// text need the same classification.
export function stayRelation(
  stay: Pick<Stay, 'checkInAt' | 'checkOutAt'>,
  date: string,
): StayRelation {
  const inToday = dateOnly(stay.checkInAt) === date;
  const outToday = dateOnly(stay.checkOutAt) === date;
  if (inToday && outToday) return 'Overnight';
  if (inToday) return 'Check in';
  if (outToday) return 'Check out';
  return 'Staying';
}

// ---------- day rows (the common backbone) + scenario tracks (one parallel
// set of rows per branch) — built by layoutDay (dayLayout.ts) ----------
//
// A changeover day can have activities before checkout, an early check-in
// followed by an evening activity, or a transit sandwiched between the two —
// there's no single "stays first, everything else second, stays last" bucket
// order that holds in general. Per Guiding principle 03 ("sort order comes
// from a timestamp when one exists" — see docs/data-model.html), a day's rows
// and each scenario track's rows are in real timestamp order.
//
// Activity, Transit, and Stay can all carry scenarioId (see data-model.html's
// Transit entity for why scenarioId was added there, and Stay's own entry
// for why it followed — a branching day can need two different overnights,
// not just two different events). day.rows holds everything *without* a
// scenarioId — Stay/Transit/Activity events every branch shares — so it's the
// material that's true regardless of which branch happens; a scenario box
// row lists one tab per scenario present that day, with only the active
// branch's own rows filled in.
//
// A Stay with no check-in/check-out event today (already occupied, or
// occupied for the rest of the day) has no instant to sort by — it's
// standing context for the whole day, not a scheduled event — so it's
// anchored to the start of the day. Fuzzy-timed activities (timeLabel only,
// no startAt) have no real timestamp either, but timeLabel is a closed
// vocabulary (TIME_LABEL_ANCHORS below) rather than free text, so per
// Guiding principle 03 each one gets a real anchor time straight from that
// table — validateActivityTiming (below) enforces every Activity has one of
// startAt or a table entry, so there's never a timeLabel left over with no
// anchor to fall back on.

// The only anchors this trip's days actually need — deliberately coarse,
// since a fuzzy label like "Morning" was never claiming more precision than
// this in the first place. Each maps to an HH:MM used only to compute a sort
// key; activityTimeLabel (above) still shows the label text itself, never
// this clock time. "All day" is for a whole-day banner activity (e.g. a
// cruise sea day) that has no time of its own and belongs before the day's
// other, real-timed activities — hence the earliest possible anchor.
// Sunrise/Sunset get a fixed anchor here, same as every other label, and
// that is deliberate rather than a gap waiting to be closed. weather.ts's
// getDayWeather does resolve a real sunrise/sunset per Day (from its
// sunrisePlaceId/sunsetPlaceId), and the row's own overline shows that real
// time via useSunAnchoredTime — so a Sunset row can read "Sunset (11:47 PM)"
// while still sorting at 19:00, ahead of an 8pm Evening activity. That
// mismatch is accepted on purpose: threading the live value into the sort
// key would make the day list's order shift as remote data loads or
// changes, and a stable, predictable order is worth more to a reader than a
// more accurate one that reshuffles underneath them. Anchor times are a
// fixed, static ordering decision; don't replace them with a dynamically
// resolved value, and don't re-tune the constants as a drive-by cleanup
// (that's a content call, not a refactor).
const TIME_LABEL_ANCHORS: Record<string, string> = {
  'All day': '00:00',
  Sunrise: '05:00',
  Morning: '09:00',
  Midday: '12:00',
  Afternoon: '13:00',
  Sunset: '19:00',
  Evening: '20:00',
  Night: '22:00',
  Midnight: '23:59',
};

// Every Activity must resolve to both a real sort position and a real date:
// startAt, or a `date` paired with a timeLabel drawn from TIME_LABEL_ANCHORS
// above. A timeLabel outside that closed vocabulary (a one-off conditional
// string) doesn't count — it has no anchor time of its own — and neither
// does a timeLabel with no `date`, since resolveActivityDate would have
// nowhere left to place it. Checked once at load time so a bad entry fails
// loudly here rather than sorting on an undefined key, or silently
// vanishing from the day list, downstream — this is what lets
// activitySortKey (below) always return a real value instead of needing its
// own null-handling fallback.
function validateActivityTiming(activities: Activity[]): void {
  const untimed = activities.filter(
    (a) => !a.startAt && !(a.date && a.timeLabel && TIME_LABEL_ANCHORS[a.timeLabel]),
  );
  if (untimed.length) {
    throw new Error(
      `Activity(s) missing startAt or a date+timeLabel pair: ${untimed.map((a) => a._id).join(', ')}`,
    );
  }
}

export function activitySortKey(
  activity: Pick<Activity, 'startAt' | 'timeLabel'>,
  dayStart: string,
): string {
  if (activity.startAt) return activity.startAt;
  return `${dateOnly(dayStart)}T${TIME_LABEL_ANCHORS[activity.timeLabel as string]}`;
}

export function stayEventKey(stay: Stay, relation: StayRelation, dayStart: string): string {
  if (relation === 'Check out') return stay.checkOutAt;
  if (relation === 'Staying') return dayStart;
  return stay.checkInAt; // 'Check in' or 'Overnight' both anchor on arrival
}

// A stage carries no timestamp of its own — routes.json's places[] is
// dateless reference geography — but each entry does carry its own
// durationMinutes (the drive time to reach it from whichever place, or
// Depart, came before), so a stage's place in the day's real chronological
// order is computed by walking that variant's places[] and accumulating those durations
// from the Transit's departsAt (see stageTimesForVariant, below, called from
// resolveTransitRoute where the Transit's real in-transit Activities are
// available to fold in). That's what lets a real, timed Activity reached
// partway through the drive (a lunch stop) both land in its own true
// position in the day's rows AND push every later stage's estimated time back
// by however long that stop actually took — rather than the stage times
// drifting out of sync with a plan that includes a real stop, the way even
// spacing across the whole departsAt–arrivesAt span would. It's still only
// an estimate (no live traffic/pace data backs it), just a better-informed
// one than guessing — acceptable for a plan, not actuals.
export function wallClockMs(iso: string): number {
  const [datePart, timePart] = iso.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm);
}

export function formatWallClock(ms: number): string {
  const dt = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}`;
}

export function addMinutesIso(iso: string, minutes: number): string {
  return formatWallClock(wallClockMs(iso) + minutes * 60000);
}

export function diffMinutesIso(a: string, b: string): number {
  return (wallClockMs(b) - wallClockMs(a)) / 60000;
}

// A meal Activity reached mid-drive is exempt from the transit-overlap
// warning (see transitOverlapFor, below) — eating during a long drive is
// normal, not a modeling mistake — but it still genuinely takes time, and a
// meal with no authored durationMinutes (a still-undecided "choosing
// where", or a self-catered packed lunch that was never given a real
// duration) used to fold into the walk below as zero minutes, silently
// understating how long the stop actually took. These are rough,
// diningFormat-shaped guesses — grab-and-go/drivethru barely slow the
// drive, a sit-down meal genuinely does — used only when a real
// durationMinutes isn't already on record. A still-open meal
// (activity.options set, diningFormat null) borrows its first candidate's
// format as the best available guess.
// 'included-with-activity'/'included-with-transit' both get 0: the meal
// happens inside whatever Activity/Transit it's bundled into (includedIn),
// which already owns that stretch of the day — giving it its own nonzero
// estimate here would double-count the time.
const DEFAULT_MEAL_DURATION_MINUTES: Record<string, number> = {
  included: 30,
  package: 45,
  'included-with-activity': 0,
  'included-with-transit': 0,
  'sit-down': 60,
  'grab-and-go': 15,
  drivethru: 10,
  'self-catered': 20,
};
const FALLBACK_MEAL_DURATION_MINUTES = 30;

// The one canonical "how long does this Activity take" answer — an
// explicit durationMinutes, or a meal-format estimate when there's none,
// or null (point-in-time/unknown) otherwise. Everything that used to read
// endAt now reads this instead: the drive-time walk below, reorder.ts's
// drag-and-drop anchor/shift math, and the transit-overlap check.
//
// formatOverrides (activityId -> diningFormat) lets a caller stand in
// whichever MealOption candidate is actually live-selected in the day view
// right now — the meal row's own tabs — in place of the model's own stored
// default (activity.diningFormat, or its first still-open option). Empty for
// the one-time build at page load (buildTripView), when nothing's been
// picked yet; populated whenever a meal row's own tabs change, so a lunch
// stop's picked format (sit-down vs. drive-thru) actually reaches the
// drive-time walk below instead of only changing that row's own display.
// Typed against just the fields it reads (rather than EnrichedActivity)
// so a raw, not-yet-enriched Activity — e.g. reorder.ts's own drag-and-drop
// duration recalculation, working straight off TripData — can call this too.
export function activityDurationMinutes(
  activity: Pick<Activity, '_id' | 'durationMinutes' | 'mealType' | 'diningFormat' | 'options'>,
  formatOverrides?: Map<string, DiningFormat>,
): number | null {
  if (activity.durationMinutes != null) return activity.durationMinutes;
  if (!activity.mealType) return null;
  const format =
    formatOverrides?.get(activity._id) ??
    activity.diningFormat ??
    activity.options?.[0]?.diningFormat ??
    null;
  return (format && DEFAULT_MEAL_DURATION_MINUTES[format]) ?? FALLBACK_MEAL_DURATION_MINUTES;
}

// Every variant gets its own independent walk — even though only one
// variant's stages are visible at a time (the route-variant tabs), the
// hidden one still needs its own correct times ready for when it's switched
// to. inTransitActivities is consumed here as a local queue, one segment's
// durationMinutes at a time: if an activity's real startAt falls inside the
// segment currently being driven, only the portion of the segment up to
// that point is spent as drive time, the clock then jumps to that activity's
// own effective end (its real endAt, or the meal-format estimate above), and
// whatever of the segment's duration is still left keeps driving from there
// — so a lunch stop's real time and a segment's estimated drive time both
// actually elapse, instead of one silently swallowing the other.
//
// The walk doesn't stop at the last named place — variant.finalLegMinutes
// (Route entity, data-model.html) is appended as one more, unlabeled
// segment covering the drive from the last place (or Depart) to the route's
// own destination, so the walk's own final clock position is the Transit's
// real arrival time given everything it actually passed along the way —
// not clamped to whatever arrivesAt happened to be authored. That's what
// buildTripView reads back as the Transit's resolved arrivesAt for any
// routed drive (see resolveTransitRoute, below); arrivesAt only stays a
// flatly authored fact for a mode with a genuine external schedule (a
// flight, a ferry) or a Transit with no route to walk at all.
function stageTimesForVariant(
  variant: { places: RoutePlaceEntry[]; finalLegMinutes: number },
  transit: Transit,
  inTransitActivities: Activity[],
  formatOverrides?: Map<string, DiningFormat>,
): { stages: RouteStage[]; arrivesAt: string } {
  let clockMs = wallClockMs(transit.departsAt);
  const queue = [...inTransitActivities];
  const segments: (RoutePlaceEntry & { finalLeg?: boolean })[] = [
    ...variant.places,
    { finalLeg: true, durationMinutes: variant.finalLegMinutes ?? 0, kind: 'via' },
  ];
  const stages: RouteStage[] = [];
  for (const seg of segments) {
    let remainingMs = (seg.durationMinutes ?? 0) * 60000;
    while (remainingMs > 0) {
      const next = queue[0];
      const nextStartMs = next ? wallClockMs(next.startAt as string) : null;
      if (
        next &&
        nextStartMs !== null &&
        nextStartMs >= clockMs &&
        nextStartMs <= clockMs + remainingMs
      ) {
        const driveMs = nextStartMs - clockMs;
        remainingMs -= driveMs;
        clockMs = nextStartMs + (activityDurationMinutes(next, formatOverrides) ?? 0) * 60000;
        queue.shift();
      } else {
        clockMs += remainingMs;
        remainingMs = 0;
      }
    }
    if (!seg.finalLeg) {
      const label = seg.label ?? (seg.place?.label as string);
      const placeId = seg.place?.id ?? null;
      // Carries the stage's own already-resolved image through — without
      // this, a route waypoint/via has no `images`, even though it was
      // resolved (firstImage(seg.place)) from this exact same place moments
      // earlier.
      const image = firstImage(seg.place);
      stages.push({
        note: seg.note ?? null,
        kind: seg.kind,
        key: formatWallClock(clockMs),
        place: { id: placeId, label, images: image ? [image] : undefined },
      });
    }
  }
  return { stages, arrivesAt: formatWallClock(clockMs) };
}

// The arrival a reader is actually looking at: the live-selected route
// variant's own resolved arrival (activeRouteTone), falling back to the
// Transit's own arrivesAt (the model's default variant, or the authored
// field for an unrouted Transit). Each variant can arrive at a different
// time — even on a different calendar day — so anything that asks "when does
// this Transit end" for what's on screen goes through here rather than
// reading transit.arrivesAt directly.
export function activeArrivesAt(
  transit: EnrichedTransit,
  routeTones?: Map<string, string>,
): string | null {
  const tone = activeRouteTone(transit, routeTones);
  const variant = transit.routeInfo?.variants.find((v) => v.tone === tone);
  return variant?.arrivesAt ?? transit.arrivesAt;
}

function truncateSummary(text: string): string {
  return text.length > 140 ? `${text.slice(0, 137)}…` : text;
}

// Resolves competing candidates by trying each predicate in turn (most
// specific tier first) and falling back to the first item if none match —
// the "ideal wins, otherwise whichever's there" convention used throughout
// for scenario-branch ties, and its variants (an extra outright-wins tier
// ahead of the ideal-tone check, for callers like primaryStay below where
// some candidates aren't scenario-scoped at all).
export function pickByPriority<T>(
  items: T[],
  ...predicates: Array<(item: T) => boolean>
): T | null {
  for (const predicate of predicates) {
    const match = items.find(predicate);
    if (match) return match;
  }
  return items[0] ?? null;
}

// Which scenario is on screen is decided once, upstream — resolveActiveScenarios
// (scenarioGroups.ts) turns the reader's picks into an active scenario per
// group, and layoutDay marks that track `active`. This is the one reader of
// "the branch showing" out of a set of tracks (an inactive track carries no
// rows, so there is nothing to fall back to).
export function activeTrackOf(tracks: ScenarioTrack[]): ScenarioTrack | null {
  return tracks.find((t) => t.active) ?? null;
}

// Every place with a resolvable id touched by a day's own (backbone) rows,
// in the order the day list renders them — used to find "the first/last place
// of the day" for the live weather strip's sunrise/sunset. A scenario box
// recurses into its active track (else the ideal one — same convention as
// activeTrackOf) rather than every branch, since only one branch is what
// actually happens; a day whose only real places sit inside a box still gets
// a sunrise/sunset location.
export function orderedPlaceIds(rows: DayRow[]): string[] {
  return rows.flatMap((row): string[] => {
    switch (row.type) {
      case 'stay': {
        const id = row.stay.lodging?.place.id;
        return id ? [id] : [];
      }
      case 'transit': {
        const id = transitRowPlace(row).id;
        return id ? [id] : [];
      }
      case 'activity':
        return row.activity.place?.id ? [row.activity.place.id] : [];
      case 'box': {
        const track = activeTrackOf(row.tracks);
        return track ? orderedPlaceIds(track.rows) : [];
      }
    }
  });
}

export function deriveSummary(
  day: Pick<Day, 'scenarioTracks' | 'rows' | 'stays' | 'location'>,
): string {
  const activeTrack = activeTrackOf(day.scenarioTracks);
  const first =
    activitiesOf(day.rows)[0] ?? (activeTrack && activitiesOf(activeTrack.rows)[0]) ?? null;
  if (first) return truncateSummary(activityHeadline(first));
  if (day.stays[0]) return `Staying at ${day.stays[0].lodging?.place.label ?? day.location}`;
  return day.location;
}

// ---------- Day title — the header text shown above each day-block. Falls
// back to `location` (usually the Stay's name) unless one or more Activities
// that day carry a `priority`, in which case the title becomes those
// activities' own text instead — a flightseeing day is titled "Denali
// Flightseeing," not "Staying at Denali Lodge." Ties (same top priority,
// several activities) join with " & " in sequence order rather than picking
// one arbitrarily. ----------

const PRIORITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

export function activitiesOf(rows: DayRow[]): EnrichedActivity[] {
  return rows.flatMap((row) => (row.type === 'activity' ? [row.activity] : []));
}

// Same as activitiesOf, but also recurses into every scenario box's own tracks
// (unlike a title's candidates, which follow only the active branch) — for
// callers that need every Activity a day currently renders, e.g.
// mealOptions.ts's overlap-warning pool.
export function activitiesDeep(rows: DayRow[]): EnrichedActivity[] {
  return rows.flatMap((row) => {
    if (row.type === 'activity') return [row.activity];
    if (row.type === 'box') return row.tracks.flatMap((track) => activitiesDeep(track.rows));
    return [];
  });
}

// A single track's own priority-activity candidates, plus whatever its
// nested scenario-tabs split (if any) contributes — resolveNested decides
// which nested track(s) that comes from, so this same walk serves both the
// build-time "planned" convention (plannedTrackCandidates below, which
// falls through nested siblings) and a live-selection-aware caller
// (dayHeader.ts's activeTitleCandidates, which follows exactly the
// currently-active nested track) without duplicating the own-activities/
// find-scenario-tabs-item shape twice.
export function ownTrackCandidates(
  track: ScenarioTrack,
  resolveNested: (tracks: ScenarioTrack[]) => EnrichedActivity[],
): EnrichedActivity[] {
  const own = activitiesOf(track.rows).filter((a) => a.priority);
  const box = track.rows.find((row): row is BoxRow => row.type === 'box');
  const nested = box?.tracks.length ? resolveNested(box.tracks) : [];
  return [...own, ...nested];
}

// Exported so a live-selection-aware caller (liveDays.ts, via
// dayHeader.ts's activeTitleCandidates) can join its own candidate
// list the same way day.title's build-time default does, rather than
// duplicating the priority-rank/tie-join rule.
export function deriveTitle(location: string, candidates: EnrichedActivity[]): string {
  if (!candidates.length) return location;
  const topRank = Math.max(...candidates.map((a) => PRIORITY_RANK[a.priority as string]));
  return candidates
    .filter((a) => PRIORITY_RANK[a.priority as string] === topRank)
    .map((a) => activityHeadline(a))
    .join(' & ');
}

// ---------- day map — a computed Google Maps embed for the day-list header's
// map button. Built from the same places already in day.rows/
// scenarioTracks, in that same chronological order, rather than a stored
// per-day map field (there's nowhere in the data model that would belong —
// it's entirely derivable from the Stay/Transit/Activity places already on
// the day, same as everything else buildDay computes). Uses the classic
// maps.google.com/maps?...&output=embed iframe form rather than the official
// (paid, key-gated) Maps Embed API — every stop here is plain text a person
// could type into Maps' own search box, and this trip's places.ts Places API
// key is deliberately restricted to Places API calls only, so this avoids
// both a second API to enable and a second key restriction to maintain. ----------

// The one place a Stay relation is classed as a day-edge boundary — shared by
// DayTimeline's row split and dayMap.ts's visit split so the two can't drift.
export function stayRelationBoundary(relation: StayRelation): 'checkout' | 'checkin' | null {
  if (relation === 'Check out') return 'checkout';
  if (relation === 'Check in' || relation === 'Staying') return 'checkin';
  return null; // 'Overnight'
}

// 'checkout'/'checkin' only when every entry agrees on it, else null.
function uniformBoundary(
  kinds: Array<'checkout' | 'checkin' | null>,
): 'checkout' | 'checkin' | null {
  if (kinds.every((kind) => kind === 'checkout')) return 'checkout';
  if (kinds.every((kind) => kind === 'checkin')) return 'checkin';
  return null;
}

function trackBoundaryKind(track: ScenarioTrack): 'checkout' | 'checkin' | null {
  if (!track.rows.length) return null;
  return uniformBoundary(
    track.rows.map((row) => (row.type === 'stay' ? stayRelationBoundary(row.relation) : null)),
  );
}

// A box is a stay boundary when the branch actually showing (its active track)
// is nothing but stay boundaries — the inactive tabs carry no rows at all, so
// they can't disagree.
function scenarioGroupBoundary(box: BoxRow): 'checkout' | 'checkin' | null {
  const active = box.tracks.filter((t) => t.active);
  if (!active.length) return null;
  return uniformBoundary(active.map(trackBoundaryKind));
}

function stayBoundaryKind(row: DayRow): 'checkout' | 'checkin' | null {
  if (row.type === 'stay') return stayRelationBoundary(row.relation);
  if (row.type === 'box') return scenarioGroupBoundary(row);
  return null;
}

// A Stay's check-in/check-out events are keyed to their own clock time (see
// stayEventKey above) so they sort into the day's rows wherever that falls —
// but rather than let an 11am formal checkout land after a 6:30am departure,
// or a mid-afternoon check-in land ahead of an 8am breakfast, checkout always
// sorts first and check-in always last: each reads as "leaving here"/"staying
// here tonight" context for the day rather than a scheduled event competing
// with the timeline between them. A 'Staying' night (no check-in/check-out
// event today) reads the same way as check-in — "this is where tonight ends
// up" — so it groups with check-in rather than sitting wherever its
// synthetic dayStart anchor (stayEventKey) would otherwise sort it, which
// was always the very top of the day. Shared by the visible day list
// (DayTimeline) and the map queries (dayMap.ts's bookendedRuns — so the
// computed map's last stop is always tonight's actual lodging, not wherever
// check-in's raw timestamp happened to sort).
//
// A scenario-tabs group whose every candidate track's own same-day content
// is nothing but a Stay boundary (e.g. a night whose lodging itself differs
// per scenario — Denali Princess Wilderness Lodge vs. Talkeetna Alaskan
// Lodge, both checking out the same morning) carries no real per-scenario
// *activity* content for this date at all; it exists purely to answer "which
// hotel did you wake up in / go to sleep in," so it deserves this same
// treatment too. The map queries in dayMap.ts (buildDayVisits) read the day's
// laid-out rows through this same split, so the map agrees with the list.
export function splitOutStayBoundaries(rows: DayRow[]): {
  checkOuts: DayRow[];
  rest: DayRow[];
  checkIns: DayRow[];
} {
  const checkOuts = rows.filter((row) => stayBoundaryKind(row) === 'checkout');
  const checkIns = rows.filter((row) => stayBoundaryKind(row) === 'checkin');
  const rest = rows.filter((row) => !checkOuts.includes(row) && !checkIns.includes(row));
  return { checkOuts, rest, checkIns };
}

// Google caps this URL at 9 waypoints — a hard ceiling on this URL scheme,
// not a raisable quota (the paid Directions/Routes API allows more, but
// costs a second billed API and a key that can't stay Places-only, the same
// trade-off already rejected for the map embed, mapEmbedUrls in dayMap.ts). Confirmed by hand: a
// 10th waypoint gets silently dropped rather than rejected, so exceeding
// this is a real, silent content bug, not just a theoretical one. Google's
// own docs describe a lower 3-waypoint ceiling specific to mobile browsers,
// but that tier doesn't apply here in practice — tapping this link on a
// phone launches the native Maps app by default (verified by hand), which
// gets the same 9-waypoint allowance as desktop.
export const MAX_ROUTE_WAYPOINTS = 9;

export interface RouteStop {
  label: string;
  placeId: string | null;
  // Whether this label is trustworthy enough to route Directions through as
  // a *middle* waypoint even without a resolved placeId (see
  // routeUrls' own candidate filter in dayMap.ts) — true for a Stay's
  // lodging or an Activity's place, which data-model.html requires to
  // always name one specific point even before that point's Google Place ID
  // gets looked up (e.g. "Rust's Flying Service"); false for a Transit's
  // bare from/to, which can legitimately be a whole city or highway
  // junction ("Anchorage") — precise enough as the day's own first/last
  // stop, but too broad a target for Directions to snap to mid-route.
  // Defaults true; only dayMap.ts's transit-boundary call site passes false.
  trustedAsWaypoint: boolean;
  // This stop's own DayTimeline row identity (stayNodeKey/transitBoundaryKey/
  // stageNodeKey/activityNodeKey below), when it has one — the same key
  // TravelInfoControl/DayMapSidebar's segmentTravelMode use to read back a
  // TravelModeOverride. Null for a stop with no single-row equivalent: a
  // 'Staying' night (DayTimeline gives that its own separately-keyed
  // "-morning" node instead) — a segment touching it just falls back to
  // DRIVE, the same gap DayMapSidebar's own segmentTravelMode already accepts.
  nodeKey: string | null;
}

// A stop's routable identity: always a label (Directions URL stops are text
// first, an id can only ever supplement one), plus an id when one's resolved
// (Activity.place.id, Stay.lodging.place.id, Transit.from/to.id) — null for
// the endpoints (a whole city, an unresolved via) that don't have one, which
// still geocode fine by name alone.
export function routeStop(
  place: Place | null | undefined,
  fallbackLabel?: string,
  trustedAsWaypoint = true,
  nodeKey: string | null = null,
): RouteStop | null {
  const label = place?.label ?? fallbackLabel ?? null;
  if (!label) return null;
  return { label, placeId: place?.id ?? null, trustedAsWaypoint, nodeKey };
}

// A routed Transit's live-selected tone: whichever the reader has actually
// picked in routeTones (transitId -> tone), falling back to the model's own
// default (routeInfo.selectedTone) — shared by DayTimeline/RouteVariantTabs'
// rendering and dayLayout.ts's stage lookup, rather than each re-deriving the
// same override-over-default lookup.
export function activeRouteTone(
  transit: { _id: string; routeInfo: ResolvedRouteInfo | null },
  routeTones?: ReadonlyMap<string, string>,
): string | null {
  if (!transit.routeInfo) return null;
  return routeTones?.get(transit._id) ?? transit.routeInfo.selectedTone;
}

// The real-world place a transit row's own stop names: a Depart's from, an
// Arrive's to, or a route stage's own Place. A stage's Place (stage.place) is
// built once, in stageTimesForVariant, alongside the stage itself — so it's
// already reference-stable across renders here, with no per-call synthesis or
// caching needed. Consumers like DayTimeline's TravelInfoControl rely on that
// stability to skip unnecessary re-renders. (A live day only carries the
// selected route variant's stages — see layoutDay.)
export function transitRowPlace(row: TransitRow): Place {
  if (row.phase === 'stage') return row.stage.place;
  return row.phase === 'depart' ? row.transit.from : row.transit.to;
}

export interface DayTravelSegment {
  originId: string;
  destinationId: string;
  // The reader's own TravelModeOverride key for this exact hop (see
  // segmentKey below), resolved from the two bounding stops' own nodeKey —
  // null when either stop has no single-row equivalent (see RouteStop's own
  // nodeKey note), in which case a caller should fall back to DRIVE, same as
  // DayMapSidebar's segmentTravelMode already does for the map's own
  // segments.
  segmentKey: string | null;
}

// A day's stops/rows are frequently interspersed with ones that resolve to
// no real Google place id at all — a drive Transit's own from/to is often
// just a plain label with no id (data-model.html doesn't require one:
// "Fairbanks" -> "Copper Center" is a perfectly real Transit with neither
// end pinned to a Google place), and neither is a park or a whole city named
// as an activity's fallback. Two independent callers both need to walk past
// stops/rows like that to find the next one that DOES name a real place —
// travelSegments (dayMap.ts — the day header's drive-time/distance total) and
// DayTimeline's own per-row travel-info footers — so this is the one shared
// implementation of that skip-forward, used by both, rather than each
// re-deriving it by hand. (It used to be reimplemented separately in each
// place; the day-total copy forgot to skip, which silently dropped
// real drives — like the one across the placeless Transit above — from the
// day's total entirely.)
export function findNextResolvableStop<T>(
  items: T[],
  fromIndex: number,
  resolvedId: (item: T) => string | null | undefined,
): T | undefined {
  for (let j = fromIndex + 1; j < items.length; j++) {
    if (resolvedId(items[j])) return items[j];
  }
  return undefined;
}

export function buildDirectionsUrl(
  origin: RouteStop,
  destination: RouteStop,
  waypoints: RouteStop[],
): string {
  const params = new URLSearchParams({
    api: '1',
    origin: origin.label,
    destination: destination.label,
    travelmode: 'driving',
  });
  if (origin.placeId) params.set('origin_place_id', origin.placeId);
  if (destination.placeId) params.set('destination_place_id', destination.placeId);
  if (waypoints.length) {
    params.set('waypoints', waypoints.map((stop) => stop.label).join('|'));
    // Every waypoint here already passed the placeId filter in
    // routeUrls (dayMap.ts), so this stays positionally 1:1 with waypoints
    // — required, since Google matches the two lists by index rather than
    // by any id embedded in the text.
    params.set('waypoint_place_ids', waypoints.map((stop) => stop.placeId as string).join('|'));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

// ---------- day map markers — every real-world place resolvable for a day,
// one entry per unique Google Place id, each carrying every Stay/Transit/
// Activity entity that names it (so a marker click can open the right
// detail sheet(s)), plus a routed Transit's own via/waypoint stages — unlike
// mapEmbedUrls/routeUrls (dayMap.ts), which skip stages (that keyless
// embed can't route through waypoints reliably), DayMapSidebar draws a real
// Polyline through each place's own resolved coordinates, so the actual
// route stages belong on it. `rowKey` on the stay/transit/transit-stage
// variants is the same key DayTimeline's own TimelineRow stamps as that
// row's `data-testid` (`stay-row-<rowKey>`, `transit-boundary-<rowKey>`,
// `transit-stage-<rowKey>`) — DayMapSidebar's own visible-rows tracking
// (useVisibleRowKeys) correlates back to this without DayTimeline needing to
// know the map exists. A place with no real Google Place id (a Transit's
// bare city-level from/to, a cruise ship mid-voyage, an unresolved via) is
// dropped: a marker needs real coordinates (placeCoordinates.ts resolves
// those from the id), unlike a Directions URL, which can still route
// through a bare label. ----------

export type DayMapPlaceRef =
  | { kind: 'stay'; entity: EnrichedStay; relation: StayRelation; rowKey: string }
  | { kind: 'transit'; entity: EnrichedTransit; phase: 'depart' | 'arrive'; rowKey: string }
  | {
      kind: 'transit-stage';
      entity: EnrichedTransit;
      stage: RouteStage;
      stageIndex: number;
      rowKey: string;
    }
  | { kind: 'activity'; entity: EnrichedActivity };

export interface DayMapPlaceStop {
  place: Place;
  refs: DayMapPlaceRef[];
}

// A single chronological occurrence of a place — unlike DayMapPlaceStop,
// never deduped against another occurrence of the same place. See
// mapRouteNodes (dayMap.ts) for why the route line needs this instead of
// dedupeDayMapPlaceStops' deduped stops.
export interface DayMapRouteNode {
  place: Place;
  ref: DayMapPlaceRef;
}

// Collapses mapRouteNodes' own chronological node list down to one stop per
// place id — a separate function so a caller already holding that node list
// (e.g. DayMapSidebar, which also needs the undeduped list for its route line)
// can dedupe it directly rather than re-walking the day a second time.
export function dedupeDayMapPlaceStops(nodes: DayMapRouteNode[]): DayMapPlaceStop[] {
  const byPlaceId = new Map<string, DayMapPlaceStop>();
  for (const { place, ref } of nodes) {
    // mapRouteNodes only ever pushes a node once place.id is truthy.
    const placeId = place.id as string;
    const existing = byPlaceId.get(placeId);
    if (existing) existing.refs.push(ref);
    else byPlaceId.set(placeId, { place, refs: [ref] });
  }
  return [...byPlaceId.values()];
}

// The row-identity scheme DayTimeline's own dragId/segmentKey construction
// uses for a Stay/Transit-boundary/Activity row (see DayTimeline.tsx's
// `nodes` build and reorder.ts's buildDragMeta, which must match it exactly)
// — exposed here so any other reader of a DayMapPlaceRef (currently
// DayMapSidebar, resolving which travelModeOverrides entry a map segment
// corresponds to) can compute the same key without re-deriving the string
// scheme by hand. Deliberately doesn't cover a Stay's 'Staying' relation
// (DayTimeline gives that a second, separately-keyed morning node with no
// DayMapPlaceRef equivalent) — callers needing that still fall back to
// their own default.
export function stayNodeKey(stayId: string, date: string): string {
  return `stay-${stayId}-${date}`;
}

export function transitBoundaryKey(transitId: string, phase: 'depart' | 'arrive'): string {
  return `transit-${transitId}-${phase}`;
}

export function activityNodeKey(activityId: string): string {
  return `activity-${activityId}`;
}

// A route stage is keyed by its Transit and its position among the selected
// variant's stages, so any walk of the day's refs can reproduce it.
export function stageNodeKey(transitId: string, stageIndex: number): string {
  return `stage-${transitId}-${stageIndex}`;
}

// A TravelModeOverride's own segmentKey: two adjacent rows' own node keys
// (see stayNodeKey/transitBoundaryKey/activityNodeKey above), joined so
// DayTimeline's TravelInfoControl (writing an override) and DayMapSidebar's
// segmentTravelMode (reading one back) always agree on the same string.
export function segmentKey(fromKey: string, toKey: string): string {
  return `segment:${fromKey}->${toKey}`;
}

// The data-testid DayTimeline's own TimelineRow stamps on a Stay/Transit-
// boundary/Transit-stage/Activity row — a separate identity scheme from
// stayNodeKey/transitBoundaryKey/activityNodeKey above (this one's key is the
// sequence item's own `key`/entity id, not a stay id + date), but the same
// reasoning: exposed here so DayMapSidebar's domTestIdForRef can read the
// same attribute off the DOM without re-deriving the string scheme by hand.
const ROW_TEST_ID_PREFIX = {
  stay: 'stay-row',
  'transit-boundary': 'transit-boundary',
  'transit-stage': 'transit-stage',
  activity: 'activity-row',
} as const;

export function rowTestId(kind: keyof typeof ROW_TEST_ID_PREFIX, key: string): string {
  return `${ROW_TEST_ID_PREFIX[kind]}-${key}`;
}

// A day's data-only frame — see DayFrame. Everything about what the day
// CONTAINS (its rows, scenario tabs, header, map) is derived per selection by
// buildLiveDays.
function buildDayFrame(
  date: string,
  legs: Leg[],
  legDateRanges: Map<string, DateRange | null>,
  stays: EnrichedStay[],
  transits: EnrichedTransit[],
  notes: NoteIndex,
): DayFrame | null {
  // A date that falls inside two legs' computed ranges at once (e.g. a
  // same-day handoff, one leg's checkout and the next leg's departure both
  // landing on it) still carries every entity from every leg that claims the
  // date — nothing here is dropped. Only the day's own *identity* (its
  // `leg`, used for LegDialog's day list and default location) resolves to
  // whichever leg sorts first in legs' own authored order — there's no
  // boundary field left to disambiguate that with.
  const legsForDate = legs.filter((l) => {
    const range = legDateRanges.get(l._id);
    return range && range.startDate <= date && date <= range.endDate;
  });
  const leg = legsForDate[0];
  if (!leg) return null;
  const legIds = new Set(legsForDate.map((l) => l._id));

  const dayStart = `${date}T00:00`;
  const dayEnd = `${addDaysStr(date, 1)}T00:00`;

  return {
    date,
    dateLabel: formatDateLabel(date),
    leg,
    legIds: [...legIds],
    stays: stays.filter((s) => legIds.has(s.legId) && stayOverlapsDay(s, dayStart, dayEnd)),
    // A Transit belongs to the single day it departs (transitDepartsOnDay).
    transits: transits.filter((t) => legIds.has(t.legId) && transitDepartsOnDay(t, date)),
    notes: notesForDay(notes, date),
  };
}

// ---------- Route resolution — Route (public/data/routes.json) is reference
// data a Transit merely points at via routeId/routeVariant (see
// data-model.html); nothing here is stored back onto the Transit itself.
// A variant's places[] is a real, physically-ordered sequence — unlike
// Activity, nothing about a place entry has (or could have) its own
// timestamp, so array order is the correct and only encoding of "which
// place comes before which"; each entry's own durationMinutes (the drive
// time from whichever place came before it) is what turns that order into
// actual estimated clock times, in stageTimesForVariant (above). Every
// entry always resolves to a real geo-point (place.id, or coordinates as
// the fallback — see validateRoutes, below) and carries a kind of
// 'waypoint' (a real, individually-resolvable stop) or 'via' (a
// pass-through/steering point, no stop). stages keeps every entry, in that
// same sequence, reduced to label/note/key.
//
// A Route with only one variant ("the only practical route") is never a real
// choice, so resolveTransitRoute still exposes every variant (never just the
// one transit.routeVariant names) — the route-variant tabs are what decide
// whether that's worth a tab group (2+ variants, e.g. the New vs. Old Glenn
// Highway) or nothing at all (1, its stages just render plain).
//
// "In transit" Activities are found by the same legId + falls-within-
// departsAt/arrivesAt test the flat sequence builder already uses to place
// them — not a stored link, since which Activities a drive happens to pass
// is a fact about this trip's timing, not something Route (reusable,
// dateless reference data) should ever point back at.
function activityFallsWithinTransit(activity: Activity, transit: Transit): boolean {
  return (
    activity.legId === transit.legId &&
    activity.scenarioId === transit.scenarioId &&
    !!activity.startAt &&
    !!transit.arrivesAt &&
    activity.startAt >= transit.departsAt &&
    activity.startAt < transit.arrivesAt
  );
}

function inTransitActivities(transit: Transit, activities: Activity[]): Activity[] {
  return activities
    .filter((a) => activityFallsWithinTransit(a, transit))
    .sort((a, b) => ((a.startAt as string) < (b.startAt as string) ? -1 : 1));
}

// The reverse direction from activityFallsWithinTransit: a Transit's own
// departsAt lands inside the Activity's own startAt–(startAt+duration)
// range, meaning the transit is scheduled to leave partway through the
// activity rather than the activity starting mid-drive — e.g. a
// drag-and-drop reorder (see reorder.ts) landing an Activity's block on top
// of an already-fixed departure time. Unlike activityFallsWithinTransit,
// this isn't exempted for meals at this function's own call site below: a
// meal reached mid-drive is a normal stop, but a departure scheduled
// mid-meal is a real risk of missing it, not something to wave off the same
// way — so this uses activityDurationMinutes' meal-format estimate too, not
// just an explicit durationMinutes.
function transitDepartsDuringActivity(
  activity: Activity,
  activityEndsAt: string,
  transit: Transit,
): boolean {
  return (
    !!activity.startAt &&
    activity.legId === transit.legId &&
    activity.scenarioId === transit.scenarioId &&
    transit.departsAt >= activity.startAt &&
    transit.departsAt < activityEndsAt
  );
}

// An Activity is never supposed to land inside a Transit's own span at all —
// a real stop reached partway through a drive belongs on the Route as a via
// waypoint (data-model.html's Route entity), not as an ordinary Activity that
// happens to share the movement's own time window. This doesn't throw the
// way validateActivityTiming/validateRoutes do, since existing data may still
// have these pending migration to a real waypoint — it's surfaced instead as
// a visible warning on the row, so a bad case is seen and fixed rather than
// silently absorbed the way the route-stage folding above already treats it.
// Checks both overlap directions; only the "activity starts mid-drive" one
// is exempted for meals (its own call site, below). `departsMidActivity`
// tells the call site which direction matched, since the two read very
// differently as a warning message ("happening during this drive" vs.
// "this transit leaves before you're done").
function transitOverlapFor(
  activity: Activity,
  transits: Transit[],
  exemptMealFromMidDrive: boolean,
  formatOverrides?: Map<string, DiningFormat>,
): { transit: Transit; departsMidActivity: boolean } | null {
  // The Activity's own end is the same for every Transit compared against
  // it, so it's worked out once here rather than per pair. No startAt or no
  // duration means there's no span for a departure to land inside.
  const minutes = activity.startAt ? activityDurationMinutes(activity, formatOverrides) : null;
  const endsAt =
    activity.startAt && minutes != null ? addMinutesIso(activity.startAt, minutes) : null;
  const departing = endsAt
    ? transits.find((t) => transitDepartsDuringActivity(activity, endsAt, t))
    : undefined;
  if (departing) return { transit: departing, departsMidActivity: true };
  if (exemptMealFromMidDrive) return null;
  const containing = transits.find((t) => activityFallsWithinTransit(activity, t));
  return containing ? { transit: containing, departsMidActivity: false } : null;
}

// Two Activities aren't supposed to occupy the same clock-time on the same
// leg/scenario branch at all — most often a meal authored as its own
// Activity that actually happens during another one (a packed lunch eaten
// mid-hike), which belongs modeled as diningFormat 'included-with-activity'
// + includedIn pointing at that Activity instead of quietly overlapping it.
// Only real-timed Activities can be compared — a fuzzy timeLabel-only one
// has no clock-time span to check. A null-duration side (activityDurationMinutes'
// own "point-in-time" case) is treated as zero-width, so it still flags
// landing inside the other's span without needing a made-up length of its own.
// spanEnd is that "startAt plus its own (possibly zero) length" moment, shared
// by both sides of every comparison in activityOverlapFor below.
function spanEnd(
  startAt: string,
  activity: Activity,
  formatOverrides?: Map<string, DiningFormat>,
): string {
  return addMinutesIso(startAt, activityDurationMinutes(activity, formatOverrides) ?? 0);
}

// diningFormat 'included-with-activity' is the explicit "this overlap is
// correct, not a scheduling mistake" signal — includedIn names exactly
// which Activity it's bundled into, so only that specific pairing is
// exempted, not every overlap this Activity happens to have.
function isIncludedWithActivity(activity: Activity, other: Activity): boolean {
  return (
    activity.diningFormat === 'included-with-activity' &&
    !!activity.includedIn &&
    'entity' in activity.includedIn &&
    activity.includedIn.entity === 'activity' &&
    activity.includedIn.id === other._id
  );
}

function activityOverlapFor(
  activity: Activity,
  activities: Activity[],
  formatOverrides?: Map<string, DiningFormat>,
): Activity | null {
  if (!activity.startAt) return null;
  const startAt = activity.startAt;
  // Worked out once for `activity` rather than per candidate, and only for a
  // candidate that's actually comparable (timed, same leg/scenario branch).
  const endsAt = spanEnd(startAt, activity, formatOverrides);
  return (
    activities.find(
      (other) =>
        other._id !== activity._id &&
        !!other.startAt &&
        other.legId === activity.legId &&
        other.scenarioId === activity.scenarioId &&
        startAt < spanEnd(other.startAt, other, formatOverrides) &&
        other.startAt < endsAt &&
        !isIncludedWithActivity(activity, other) &&
        !isIncludedWithActivity(other, activity),
    ) ?? null
  );
}

// Overlaps only ever exist within one leg + scenario branch (every check
// above requires matching legId and scenarioId), so buildTripView compares
// each Activity against just its own branch's Activities/Transits instead of
// the whole trip's — turning an every-activity-against-everything scan into
// one over small per-branch buckets.
const overlapBranchKey = (e: { legId: string; scenarioId: string | null }): string =>
  `${e.legId}\u0000${e.scenarioId ?? ''}`;

function overlapPoolsByBranch(
  activities: Activity[],
  transits: Transit[],
): (activity: Activity) => { activities: Activity[]; transits: Transit[] } {
  const pools = new Map<string, { activities: Activity[]; transits: Transit[] }>();
  const poolFor = (key: string) => {
    let pool = pools.get(key);
    if (!pool) pools.set(key, (pool = { activities: [], transits: [] }));
    return pool;
  };
  for (const a of activities) poolFor(overlapBranchKey(a)).activities.push(a);
  for (const t of transits) poolFor(overlapBranchKey(t)).transits.push(t);
  return (activity) => poolFor(overlapBranchKey(activity));
}

// The two overlap-warning strings shown on an Activity's row — computed once
// per Activity at page load (buildTripView, no overrides: each still-open
// meal reads as its first candidate's format) and recomputable later against
// whichever MealOption candidates are actually live-selected right now (the
// meal row's own tabs), the same "live" pattern resolveTransitRoute already
// uses for route-variant tabs. A meal's picked format changes how long it
// runs, which can flip whether it actually overlaps a nearby Transit/Activity.
export function overlapWarningsFor(
  activity: Activity,
  activities: Activity[],
  transits: Transit[],
  formatOverrides?: Map<string, DiningFormat>,
): { transitOverlapWarning: string | null; activityOverlapWarning: string | null } {
  const overlappingTransit = transitOverlapFor(
    activity,
    transits,
    Boolean(activity.mealType),
    formatOverrides,
  );
  const overlappingActivity = activityOverlapFor(activity, activities, formatOverrides);
  return {
    transitOverlapWarning: overlappingTransit
      ? overlappingTransit.departsMidActivity
        ? `${overlappingTransit.transit.from.label} departs before this ends.`
        : `During transit: ${transitRouteLabel(overlappingTransit.transit)}`
      : null,
    activityOverlapWarning: overlappingActivity
      ? `Overlaps with "${activityHeadline(overlappingActivity)}".`
      : null,
  };
}

// Every place entry must carry a kind of 'waypoint' or 'via' (never a bare
// "you're now on Highway X" placeholder — that belongs in the variant's own
// label), resolve to a real geo-point: place.id, or coordinates only as the
// fallback for the rare point Google's Places index has no entry for — never
// a bare label with neither (see data-model.html's Route entity) — and carry
// a non-negative durationMinutes. This isn't a style rule: this trip's data
// once reused the same whole-highway Place ID as a place entry on two Route
// documents covering different 100+-mile stretches of the same highway, and
// because a place entry's place feeds straight into a live geocoder/
// Directions URL (mapEmbedUrls, routeUrls in dayMap.ts), that silently sent a
// real "open in Google Maps" link on an 8-hour detour. The non-negative
// durationMinutes check guards a second, subtler way order could break: a
// route is an ordered list — variant.places.map in stageTimesForVariant
// (above) always walks it in that authored order — but each stage's own
// computed key still gets sorted alongside every other event in the day by
// buildTimeline. That sort only ever preserves the places list's authored
// order because a non-negative duration keeps stageTimesForVariant's running
// clock non-decreasing as it walks places[]; a negative durationMinutes
// would make a stage's key land earlier than the one before it, and the
// sort would then actually reorder it out of its authored position. Checked
// once at load time, same reasoning as validateActivityTiming above: a bad
// place entry should fail loudly here, not silently mis-route — or
// misorder — someone in the field.
const PLACE_KINDS = new Set(['waypoint', 'via']);

function validateRoutes(routes: Route[]): void {
  const problems: string[] = [];
  for (const route of routes ?? []) {
    for (const variant of route.variants ?? []) {
      for (const place of variant.places ?? []) {
        const where = `${route._id} (${variant.tone}) place ${place.place?.label ?? place.label ?? '?'}`;
        if (!PLACE_KINDS.has(place.kind))
          problems.push(
            `${where}: kind must be 'waypoint' or 'via', got ${JSON.stringify(place.kind)}`,
          );
        if (!place.place?.id && !place.coordinates)
          problems.push(`${where}: no resolvable place.id or coordinates`);
        if (typeof place.durationMinutes !== 'number' || place.durationMinutes < 0) {
          problems.push(
            `${where}: durationMinutes must be a non-negative number, got ${JSON.stringify(place.durationMinutes)}`,
          );
        }
      }
      if (typeof variant.finalLegMinutes !== 'number' || variant.finalLegMinutes < 0) {
        problems.push(
          `${route._id} (${variant.tone}): finalLegMinutes must be a non-negative number, got ${JSON.stringify(variant.finalLegMinutes)}`,
        );
      }
    }
  }
  if (problems.length) throw new Error(`Invalid Route place entries:\n${problems.join('\n')}`);
}

// A routed drive's own arrivesAt is resolved here per variant (see
// stageTimesForVariant) rather than trusted from the Transit's authored
// field — a real stop along the way (a lunch break with no fixed duration
// of its own, say) means the true arrival isn't known until the walk
// actually accounts for it. selectedTone picks which variant's resolved
// arrival is read back as the Transit's own arrivesAt.
//
// `live`, when given, is what makes this callable a second way: not just
// once at page load (buildTripView, with no overrides — the model's own
// authored routeVariant and every meal's own stored/first-option format),
// but again at any later moment against whatever's actually selected in the
// live day view right now (a per-transit recompute driven by
// TripSelectionsContext) — a route tab switched to Scenic, a meal row
// switched to a slower sit-down format. Same walk either way; only which
// inputs it reads differ.
export function resolveTransitRoute(
  transit: Transit,
  routesById: Map<string, Route>,
  activities: Activity[],
  live: LiveRouteOverrides = {},
): ResolvedRouteInfo | null {
  if (!transit.routeId) return null;
  const route = routesById.get(transit.routeId);
  if (!route) return null;
  const inTransit = inTransitActivities(transit, activities);
  const variants: ResolvedRouteVariant[] = route.variants.map((v) => {
    const { stages, arrivesAt } = stageTimesForVariant(v, transit, inTransit, live.formatOverrides);
    return {
      tone: v.tone,
      label: `${v.tone[0].toUpperCase()}${v.tone.slice(1)}`,
      stages,
      arrivesAt,
    };
  });
  if (!variants.length) return null;
  const requestedTone = live.routeVariant ?? transit.routeVariant;
  const selectedTone = variants.some((v) => v.tone === requestedTone)
    ? (requestedTone as string)
    : variants[0].tone;
  const resolvedArrivesAt = (variants.find((v) => v.tone === selectedTone) as ResolvedRouteVariant)
    .arrivesAt;
  return { variants, selectedTone, resolvedArrivesAt };
}

// ---------- Budget — a computed view over every booking already in the
// model (Leg/Stay/Transit/Activity), sliced by Leg, Day, and Traveler.
// Nothing new is stored: every number below is derived from booking.status/
// cost plus, for the spent/pending split, the same depositPaidAt/
// finalPaymentDueAt pair leg_cruise's own booking already carries (see
// data-model.html) — the only booking on this trip with a real payment
// schedule today, but the rule holds for any future one that gets it too.

export function todayDateStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// A booking sorts into exactly one bucket, or none at all:
//  - 'spent'     — booked, and either has no payment schedule (the common
//                  case — a campsite fee, a ferry ticket, paid in full at
//                  booking) or its finalPaymentDueAt has already passed.
//  - 'pending'   — booked, but a deposit/final-payment schedule says a
//                  balance is still owed (finalPaymentDueAt hasn't arrived).
//  - 'estimated' — not booked yet, but already carries a real cost guess
//                  (e.g. a still-planning activity with a known price).
//  - 'unplanned' — not booked, no cost guess either — nothing to sum, just
//                  a count of "still needs a number."
// A cancelled booking, or no booking at all, contributes nothing (null).
export function bookingBucket(
  booking: Booking | null | undefined,
  today: string,
): BudgetRow['bucket'] | null {
  if (!booking || booking.status === 'cancelled') return null;
  if (booking.status === 'booked') {
    return booking.finalPaymentDueAt && booking.finalPaymentDueAt > today ? 'pending' : 'spent';
  }
  return booking.cost ? 'estimated' : 'unplanned';
}

function emptyBudgetTotals(): BudgetTotals {
  return { spent: 0, pending: 0, estimated: 0, unplannedCount: 0, currency: null };
}

// A 'spent'/'pending' bucket normally carries a cost — but data-model.html
// itself documents booking: { status: 'booked', cost: null, ... } as valid
// (stay_talkeetna): a confirmed reservation whose price isn't tracked, either
// because it's genuinely free/uncosted or because dedupeMirroredBookings
// (above) couldn't resolve which sibling booking it belongs to. Either way
// there's no dollar figure to add — the reservation still shows up as its
// own row, just contributing nothing to the money totals.
function addToBudgetTotals(
  totals: BudgetTotals,
  bucket: BudgetRow['bucket'],
  cost: Money | null,
): void {
  if (bucket === 'unplanned') {
    totals.unplannedCount += 1;
    return;
  }
  if (!cost) return;
  totals[bucket] += cost.amount;
  totals.currency = totals.currency ?? cost.currency;
}

// Every Leg/Stay/Transit/Activity that carries a booking, flattened to one
// shape budget grouping can work with uniformly. `date` is the single day a
// Stay/Transit/Activity's cost is attributed to (check-in date for a Stay,
// departure date for a Transit, its own resolved date for an Activity) —
// `null` for a Leg's own bundled booking (the cruise fare), since a
// week-long bundle has no single day it belongs to; the by-day grouping
// below simply skips those, and the Leg grouping is where they show up.
function bookingLineItems(
  legs: Leg[],
  stays: EnrichedStay[],
  transits: EnrichedTransit[],
  activities: EnrichedActivity[],
): BudgetLineItem[] {
  const items: BudgetLineItem[] = [];
  for (const leg of legs) {
    if (leg.booking)
      items.push({
        entity: 'leg',
        id: leg._id,
        legId: leg._id,
        label: leg.name,
        date: null,
        booking: leg.booking,
      });
  }
  for (const stay of stays) {
    if (stay.booking) {
      items.push({
        entity: 'stay',
        id: stay._id,
        legId: stay.legId,
        label: stay.lodging?.place.label ?? 'Lodging',
        date: dateOnly(stay.checkInAt),
        booking: stay.booking,
      });
    }
    // A Package (a resort fee, a meal plan, ...) is its own cost on top of
    // the room rate above — every one gets its own row here so it's counted
    // in the Budget view's totals, not just visible on the Stay itself.
    for (const pkg of stay.packages ?? []) {
      items.push({
        entity: 'package',
        id: pkg._id,
        legId: stay.legId,
        label: pkg.name,
        date: dateOnly(stay.checkInAt),
        booking: { status: pkg.status, cost: pkg.cost, confirmationNumber: pkg.confirmationNumber },
      });
    }
  }
  for (const transit of transits) {
    if (transit.booking) {
      items.push({
        entity: 'transit',
        id: transit._id,
        legId: transit.legId,
        label: transitRouteLabel(transit),
        date: dateOnly(transit.departsAt),
        booking: transit.booking,
      });
    }
  }
  for (const activity of activities) {
    if (activity.booking) {
      items.push({
        entity: 'activity',
        id: activity._id,
        legId: activity.legId,
        label: activityHeadline(activity),
        date: activity.date,
        booking: activity.booking,
      });
    }
    // A still-open meal's own candidates can each carry their own
    // reservation (see resolveBookingTags above) — every priced/booked one
    // gets its own row here too, rather than being silently dropped once
    // options is set and activity.booking itself stays null.
    for (const option of activity.options ?? []) {
      if (option.booking) {
        items.push({
          entity: 'mealOption',
          id: option._id,
          legId: activity.legId,
          label: option.place
            ? `${activityHeadline(activity)} — ${option.place.label}`
            : activityHeadline(activity),
          date: activity.date,
          booking: option.booking,
        });
      }
    }
  }
  return dedupeMirroredBookings(items);
}

// A Leg bought as one bundle (the cruise) has its cost mirrored onto a child
// Stay/Transit/Activity's own booking too — data-model.html calls this out
// explicitly for stay_cruise, which repeats leg_cruise's cost and
// confirmationNumber so the cabin's own detail view has something to show —
// but summing both would double-count the same fare. Same confirmationNumber
// within the same Leg is the signal a mirror actually happened; the Leg's
// own entry wins (it alone carries the deposit/final-payment schedule),
// and the mirrored child is dropped from the budget entirely.
// Two sibling bookings (e.g. a round-trip's outbound and return Transit) can
// also share one confirmationNumber and one combined cost the same way a Leg
// and its mirrored child do above — the round trip's total lands on one
// flight's booking.cost, and the other's is left null rather than repeating
// (and so double-counting) the same fare. The null-cost sibling is dropped
// here too, rather than showing as a confusing $0 row alongside the priced
// one — but only when a priced sibling actually exists to attribute the fare
// to; a group where every booking.cost is null (a still-unpriced pair) is
// left alone for addToBudgetTotals's own null-cost handling.
function dedupeMirroredBookings(items: BudgetLineItem[]): BudgetLineItem[] {
  const legConfirmations = new Set(
    items
      .filter((i) => i.entity === 'leg' && i.booking.confirmationNumber)
      .map((i) => `${i.legId}::${i.booking.confirmationNumber}`),
  );
  const afterLegDedupe = items.filter(
    (i) =>
      i.entity === 'leg' || !legConfirmations.has(`${i.legId}::${i.booking.confirmationNumber}`),
  );

  const pricedConfirmations = new Set(
    afterLegDedupe
      .filter((i) => i.booking.confirmationNumber && i.booking.cost)
      .map((i) => `${i.legId}::${i.booking.confirmationNumber}`),
  );
  return afterLegDedupe.filter(
    (i) =>
      i.booking.cost ||
      !i.booking.confirmationNumber ||
      !pricedConfirmations.has(`${i.legId}::${i.booking.confirmationNumber}`),
  );
}

function bucketedRows(items: BudgetLineItem[], today: string): BudgetRow[] {
  const rows: BudgetRow[] = [];
  for (const item of items) {
    const bucket = bookingBucket(item.booking, today);
    if (bucket) rows.push({ ...item, bucket });
  }
  return rows;
}

function totalsFor(rows: BudgetRow[]): BudgetTotals {
  const totals = emptyBudgetTotals();
  for (const row of rows) addToBudgetTotals(totals, row.bucket, row.booking.cost);
  return totals;
}

function groupRowsBy<K>(rows: BudgetRow[], keyOf: (row: BudgetRow) => K): Map<K, BudgetRow[]> {
  const byKey = new Map<K, BudgetRow[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const list = byKey.get(key);
    if (list) list.push(row);
    else byKey.set(key, [row]);
  }
  return byKey;
}

function groupBudgetByLeg(legs: Leg[], rows: BudgetRow[]): BudgetLegGroup[] {
  const rowsByLeg = groupRowsBy(rows, (r) => r.legId);
  return legs
    .map((leg) => {
      const legRows = rowsByLeg.get(leg._id) ?? [];
      return { leg, totals: totalsFor(legRows), rows: legRows };
    })
    .filter((g) => g.rows.length);
}

function groupBudgetByDay(days: DayFrame[], rows: BudgetRow[]): BudgetDayGroup[] {
  const rowsByDate = groupRowsBy(
    rows.filter((r) => r.date),
    (r) => r.date as string,
  );
  return days
    .map((day) => {
      const dayRows = rowsByDate.get(day.date) ?? [];
      return { day, totals: totalsFor(dayRows), rows: dayRows };
    })
    .filter((g) => g.rows.length);
}

// A row with real passengers[] (a per-traveler fare split, e.g. the cruise
// or the flight/ferry examples in data-model.html) attributes its cost
// exactly as booked. Everything else has no per-traveler breakdown at all —
// an even split across every trip traveler is the least-wrong default
// (marked in the UI as inferred, not authored), rather than leaving those
// costs out of the by-traveler view entirely.
function groupBudgetByTraveler(travelers: Traveler[], rows: BudgetRow[]): BudgetTravelerGroup[] {
  const totalsByName = new Map<string, BudgetTotals>(
    travelers.map((t) => [t.name, emptyBudgetTotals()]),
  );
  for (const row of rows) {
    if (row.bucket === 'unplanned') continue;
    if (row.booking.passengers?.length) {
      for (const p of row.booking.passengers) {
        if (!totalsByName.has(p.name)) totalsByName.set(p.name, emptyBudgetTotals());
        addToBudgetTotals(totalsByName.get(p.name) as BudgetTotals, row.bucket, p.fare);
      }
    } else if (row.booking.cost) {
      // A 'booked' row's bucket doesn't guarantee a cost (see bookingBucket)
      // — a booked package/perk with no separately-broken-out price, say —
      // so there's simply nothing to divide across travelers here, same as
      // addToBudgetTotals's own null-cost handling above.
      const share = travelers.length || 1;
      const cost = { amount: row.booking.cost.amount / share, currency: row.booking.cost.currency };
      for (const t of travelers)
        addToBudgetTotals(totalsByName.get(t.name) as BudgetTotals, row.bucket, cost);
    }
  }
  return [...totalsByName.entries()].map(([name, totals]) => ({ name, totals }));
}

export function buildBudgetView(
  trip: Trip,
  legs: Leg[],
  days: DayFrame[],
  stays: EnrichedStay[],
  transits: EnrichedTransit[],
  activities: EnrichedActivity[],
): BudgetView {
  const today = todayDateStr();
  const rows = bucketedRows(bookingLineItems(legs, stays, transits, activities), today);
  return {
    today,
    totals: totalsFor(rows),
    byLeg: groupBudgetByLeg(legs, rows),
    byDay: groupBudgetByDay(days, rows),
    byTraveler: groupBudgetByTraveler(trip.travelers, rows),
  };
}

// ---------- Traveler scope — who's actually part of a committed Activity,
// one still-open MealOption candidate, or an excursion. Two independent
// sources, by kind:
//
//  - A meal (Activity.mealType set) only resolves an attendee chip when
//    diningFormat is 'package' — i.e. includedIn points at a Package, a
//    separately purchased add-on that can genuinely differ per traveler
//    (Princess Premier's specialty dining vs. the Standard-tier travelers
//    left on the ship's ordinary included dining). A plain 'included' meal
//    (covered by the booking itself, no separate purchase in play — the
//    main dining room, a hotel's breakfast, a lodge's meal plan) has no
//    such decision to report, so it renders no chip at all, the same as
//    'sit-down'/'grab-and-go'/'drivethru'/'self-catered' — ordinary
//    à-la-carte food choices nobody's coverage was ever gated on.
//  - Anything else — an excursion: a tour, hike, or shore activity someone
//    plans or books individually — has no such derivation to lean on.
//    Different travelers can do different excursions (one family member
//    skips the zipline, say), so Activity.travelers is authored directly
//    (data-model.html's Activity entity), the same Trip.travelers[].id link
//    Package.travelers uses. null (the default on every activity today) means
//    either everyone's doing it or it just isn't decided — either way,
//    nothing to flag, so no traveler chips render at all.
//
// Resolved once here rather than re-derived per render, per Guiding
// principle 03 — the same "derive, don't store" reasoning
// notesForActivity/hasWarningNote (below) already follow. Package.travelers
// holds ids, not names (every other cross-entity pointer on this page links
// by id), so a restricted package's ids are turned back into display names
// here, the one place that translation needs to happen.
function travelersById(tripTravelers: Traveler[]): Map<string, string> {
  return new Map(tripTravelers.map((t) => [t.id, t.name]));
}

function resolveMealTravelers(
  tripTravelers: Traveler[],
  nameById: Map<string, string>,
  includedIn: Ref | null | undefined,
  packagesById: Map<string, Package>,
): string[] | null {
  if (!includedIn || !('entity' in includedIn) || includedIn.entity !== 'package') return null;
  const everyone = tripTravelers.map((t) => t.name);
  const pkg = packagesById.get(includedIn.id);
  if (!pkg?.travelers?.length) return everyone;
  const names = pkg.travelers.map((id) => nameById.get(id)).filter((n): n is string => Boolean(n));
  return names.length ? names : everyone;
}

function resolveExcursionTravelers(
  nameById: Map<string, string>,
  travelerIds: string[] | null | undefined,
): string[] | null {
  if (!travelerIds?.length) return null;
  const names = travelerIds.map((id) => nameById.get(id)).filter((n): n is string => Boolean(n));
  return names.length ? names : null;
}

export function buildTripView(data: TripData): TripView {
  const { trip, legs, stays, transits, activities, scenarios, notes, routes } = data;
  validateActivityTiming(activities);
  validateRoutes(routes);
  const scenariosById = new Map(scenarios.map((s) => [s._id, s]));
  const routesById = new Map((routes ?? []).map((r) => [r._id, r]));
  const packagesById = new Map(stays.flatMap((s) => s.packages ?? []).map((p) => [p._id, p]));
  const travelerNameById = travelersById(trip.travelers);
  const noteIndex = buildNoteIndex(notes);

  const overlapPool = overlapPoolsByBranch(activities, transits);
  const enrichedActivities: EnrichedActivity[] = activities.map((a) => {
    // A meal starting mid-drive is exempt — see DEFAULT_MEAL_DURATION_MINUTES
    // above for why that's normal, not a modeling mistake. A departure
    // scheduled mid-meal still isn't exempt (transitOverlapFor's own note).
    const pool = overlapPool(a);
    const { transitOverlapWarning, activityOverlapWarning } = overlapWarningsFor(
      a,
      pool.activities,
      pool.transits,
    );
    return {
      ...a,
      date: resolveActivityDate(a),
      notes: notesForEntity(noteIndex, 'activity', a._id),
      hasWarningNote: entityHasWarning(noteIndex, 'activity', a._id),
      transitOverlapWarning,
      activityOverlapWarning,
      travelers: a.mealType
        ? resolveMealTravelers(trip.travelers, travelerNameById, a.includedIn, packagesById)
        : resolveExcursionTravelers(travelerNameById, a.travelers),
      options: a.options
        ? a.options.map((o): EnrichedMealOption => ({
            ...o,
            travelers: resolveMealTravelers(
              trip.travelers,
              travelerNameById,
              o.includedIn,
              packagesById,
            ),
            notes: notesForEntity(noteIndex, 'mealOption', o._id),
          }))
        : a.options,
    };
  });

  const enrichedStays: EnrichedStay[] = stays.map((s) => ({
    ...s,
    notes: notesForEntity(noteIndex, 'stay', s._id),
    hasWarningNote: entityHasWarning(noteIndex, 'stay', s._id),
  }));
  // arrivesAt is overridden with the route walk's own resolved arrival for
  // any Transit with a route (see resolveTransitRoute) — every downstream
  // reader of transit.arrivesAt (sorting, day placement, rendering) picks
  // this up for free without knowing it was ever derived. It stays the
  // flatly authored fact only when there's no route to walk: a genuine
  // external schedule (flight, ferry) or a Transit with no routeId at all.
  const routedTransits: EnrichedTransit[] = transits.map((t) => {
    const routeInfo = resolveTransitRoute(t, routesById, enrichedActivities);
    return {
      ...t,
      routeInfo,
      arrivesAt: routeInfo ? routeInfo.resolvedArrivesAt : t.arrivesAt,
      notes: notesForEntity(noteIndex, 'transit', t._id),
      hasWarningNote: entityHasWarning(noteIndex, 'transit', t._id),
    };
  });

  const activitiesByDate = new Map<string, EnrichedActivity[]>();
  for (const a of enrichedActivities) {
    if (!a.date) continue;
    if (!activitiesByDate.has(a.date)) activitiesByDate.set(a.date, []);
    (activitiesByDate.get(a.date) as EnrichedActivity[]).push(a);
  }

  const legDateRanges = new Map(
    legs.map(
      (leg) =>
        [
          leg._id,
          legDateRange(leg._id, enrichedStays, routedTransits, enrichedActivities),
        ] as const,
    ),
  );
  const dateRange = tripDateRange(enrichedStays, routedTransits, enrichedActivities);
  const days = (dateRange ? dateRangeArray(dateRange.startDate, dateRange.endDate) : [])
    .map((date) =>
      buildDayFrame(date, legs, legDateRanges, enrichedStays, routedTransits, noteIndex),
    )
    .filter((d): d is DayFrame => d !== null);

  // Legs carry no authored sequence of their own — display order is the
  // computed legDateRanges start date, undated legs (nothing attached yet)
  // sorted last. This only reorders the UI-facing lists below; buildDay's
  // own overlapping-range tie-break above still walks the raw legs array.
  const sortedLegs = [...legs].sort((a, b) => {
    const aStart = legDateRanges.get(a._id)?.startDate;
    const bStart = legDateRanges.get(b._id)?.startDate;
    if (aStart && bStart) return aStart.localeCompare(bStart);
    if (aStart) return -1;
    if (bStart) return 1;
    return 0;
  });

  const daysByLegId = new Map<string, DayFrame[]>();
  for (const day of days) {
    const list = daysByLegId.get(day.leg._id);
    if (list) list.push(day);
    else daysByLegId.set(day.leg._id, [day]);
  }

  const legSummaries: LegSummary[] = sortedLegs.map((leg) => {
    const { progress, percent } = legBookingSummary(leg, stays, transits, activities);
    return {
      leg,
      dateRange: legDateRanges.get(leg._id) ?? null,
      days: daysByLegId.get(leg._id) ?? [],
      notes: notesForEntity(noteIndex, 'leg', leg._id),
      bookingProgress: progress,
      bookingPercent: percent,
    };
  });

  const budget = buildBudgetView(
    trip,
    sortedLegs,
    days,
    enrichedStays,
    routedTransits,
    enrichedActivities,
  );

  // The three by-id indexes are built from the enriched collections rather
  // than by walking `days`, so they cover every entity the trip holds —
  // including any Stay/Transit whose dates don't land on a rendered Day.
  const activitiesById = new Map(enrichedActivities.map((a) => [a._id, a]));
  const staysById = new Map(enrichedStays.map((s) => [s._id, s]));
  const transitsById = new Map(routedTransits.map((t) => [t._id, t]));

  const { progress: bookingProgress, percent: bookingPercent } = tripBookingSummary(
    legs,
    stays,
    transits,
    activities,
  );

  // routesById is exposed alongside the rest of the computed view so a live
  // recompute (TripSelectionsContext-driven) can call resolveTransitRoute
  // again later, the same way buildTripView itself just did above — see
  // that function's own note on `live`.
  return {
    trip,
    dateRange,
    days,
    legSummaries,
    activitiesById,
    staysById,
    transitsById,
    scenariosById,
    scenarioNotes: new Map(
      scenarios.map((sc) => [sc._id, notesForEntity(noteIndex, 'scenario', sc._id)]),
    ),
    routesById,
    budget,
    bookingProgress,
    bookingPercent,
  };
}
