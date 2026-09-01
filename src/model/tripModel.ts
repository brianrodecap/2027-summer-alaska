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

import type {
  Activity,
  Booking,
  BookingProgress,
  BookingStatus,
  BudgetDayGroup,
  BudgetLegGroup,
  BudgetLineItem,
  BudgetRow,
  BudgetTotals,
  BudgetTravelerGroup,
  BudgetView,
  DateRange,
  Day,
  DaySelections,
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
  ScenarioTabsSequenceItem,
  ScenarioTrack,
  SectionSequenceItem,
  SequenceItem,
  Stay,
  StayRelation,
  Transit,
  TransitBoundarySequenceItem,
  TransitStageSequenceItem,
  Traveler,
  Trip,
  TripData,
  TripsIndexEntry,
  TripView,
} from './types';

export async function loadTripData(slug: string): Promise<TripData> {
  const base = `${import.meta.env.BASE_URL}data/${slug}/`;
  const files = ['trip', 'legs', 'stays', 'transits', 'activities', 'scenarios', 'notes'] as const;
  const [[trip, legs, stays, transits, activities, scenarios, notes], routes] = await Promise.all([
    Promise.all(files.map((f) => fetch(`${base}${f}.json`).then((r) => r.json()))),
    fetch(`${import.meta.env.BASE_URL}data/routes.json`).then((r) => r.json()),
  ]);
  return { trip, legs, stays, transits, activities, scenarios, notes, routes };
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

// A Scenario carries no reliable date of its own to sort/group a flat
// management list by: `date` is only a placement hint consulted while no
// real content exists yet (see that field's own comment on Scenario), and
// even the _id/label are just authoring artifacts that can drift from
// where the scenario actually ends up (e.g. `scenario_jul6_ideal`'s real
// Activities land on Jul 8, not Jul 6). This answers a different question
// than buildScenarioTracks (below) does — that function only ever asks "is
// this scenario visible on date X, and where does it anchor within that
// one day," never "what single date does this scenario resolve to across
// the whole trip" — so its own precedence is defined fresh here rather than
// reused: a scenario's own linked Activity/Transit content, then a
// parentScenarioId child's own content, then a followsScenarioDate guess
// (marked tentative — it's only "the day after whatever this follows", not
// necessarily where it'll really land), then the placement hint.
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
    const raw = a.startAt ?? a.date;
    if (raw) pushOwn(a.scenarioId, dateOnly(raw));
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
      } else if (scenario?.followsScenarioDate) {
        result = { date: addDaysStr(scenario.followsScenarioDate, 1), tentative: true };
      } else if (scenario?.date) {
        result = { date: scenario.date, tentative: false };
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
    list.sort(
      (a, b) =>
        (a.tone === 'ideal' ? 0 : 1) - (b.tone === 'ideal' ? 0 : 1) ||
        a.label.localeCompare(b.label),
    );
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a ?? '9999-99-99').localeCompare(b ?? '9999-99-99'))
    .map(([date, list]) => ({ date, scenarios: list }));
}

// Neither Trip nor Leg authors its own date span — each is computed as the
// outer bound of whichever Stay/Transit/Activity documents actually fall
// under it, same as everything else this file derives instead of
// duplicating. null once there's nothing dated to bound.
function collectEntityDates(stays: Stay[], transits: Transit[], activities: Activity[]): string[] {
  const dates: string[] = [];
  for (const s of stays) {
    dates.push(dateOnly(s.checkInAt), dateOnly(s.checkOutAt));
  }
  for (const t of transits) {
    dates.push(dateOnly(t.departsAt));
    if (t.arrivesAt) dates.push(dateOnly(t.arrivesAt));
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
  transits: Transit[],
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
  transits: Transit[],
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

// ---------- Activity's date is usually implied by startAt. The fuzzy-time
// path (timeLabel only, no exact startAt — see TIME_LABEL_ANCHORS below) has
// no timestamp to read a date from, so Activity carries an explicit `date`
// field for exactly that case (data-model.html) — set only when startAt is
// null, alongside timeLabel. ----------

function resolveActivityDate(activity: Activity): string | null {
  if (activity.startAt) return dateOnly(activity.startAt);
  return activity.date ?? null;
}

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

function refMatchesEntity(ref: Ref, entity: RefEntityKind, ids: string[]): boolean {
  return 'entity' in ref && ref.entity === entity && ids.includes(ref.id);
}

// One bucket per RefEntityKind a note can name directly (leg/stay/transit/
// scenario/activity) — each rendered right at that entity's own spot in the
// UI (its day-list row, its side sheet, its tab section, its dialog) rather
// than pooled at the day level. Only a bare date/dateRange ref (no entity)
// has nowhere more specific to attach than the day itself — that's all
// notesForDay matches now.
function notesForEntity(notes: Note[], entity: RefEntityKind, id: string): Note[] {
  return notes.filter((n) => n.concerns.some((r) => refMatchesEntity(r, entity, [id])));
}

function notesForDay(notes: Note[], date: string): Note[] {
  return notes.filter((n) => n.concerns.some((r) => refMatchesDate(r, date)));
}

function entityHasWarning(notes: Note[], entity: RefEntityKind, id: string): boolean {
  return notes.some(
    (n) => n.kind === 'warning' && n.concerns.some((r) => refMatchesEntity(r, entity, [id])),
  );
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

function stayOverlapsDay(stay: Stay, dayStart: string, dayEnd: string): boolean {
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

// Which of today's two boundary events (if either) this Stay is part of.
// Exported because both the timeline sort below and the renderer's label
// text need the same classification.
export function stayRelation(stay: Stay, date: string): StayRelation {
  const inToday = stay.checkInAt.slice(0, 10) === date;
  const outToday = stay.checkOutAt.slice(0, 10) === date;
  if (inToday && outToday) return 'Overnight';
  if (inToday) return 'Check in';
  if (outToday) return 'Check out';
  return 'Staying';
}

// ---------- day.sequence (the common backbone) + day.scenarioTracks (one
// parallel timeline per branch) ----------
//
// A changeover day can have activities before checkout, an early check-in
// followed by an evening activity, or a transit sandwiched between the two —
// there's no single "stays first, everything else second, stays last" bucket
// order that holds in general. Per Guiding principle 03 ("sort order comes
// from a timestamp when one exists" — see docs/data-model.html), both
// day.sequence and each scenario track merge-sort their Stay check-in/
// check-out events, Transits, and Activities by real timestamp, then
// re-collapse consecutive Activities into one list-worthy section.
//
// Only Activity and Transit carry scenarioId (Stay never branches — see
// data-model.html's Transit entity for why scenarioId was added there too).
// day.sequence is built from everything *without* a scenarioId — Stay events
// plus any non-branching Activity/Transit — so it's the material that's true
// regardless of which branch happens; day.scenarioTracks holds one entry per
// distinct scenario present today (in scenarios.json's own declared order),
// each with just that branch's own Transits/Activities. In the current data
// no day mixes a scenario-less Activity with a scenario-tagged one, so a
// branching day's backbone reduces to Stay events only.
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
const TIME_LABEL_ANCHORS: Record<string, string> = {
  'All day': '00:00',
  Morning: '09:00',
  Afternoon: '13:00',
  Evening: '20:00',
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
  return `${dayStart.slice(0, 10)}T${TIME_LABEL_ANCHORS[activity.timeLabel as string]}`;
}

interface KeyedActivity {
  type: 'activity';
  activity: EnrichedActivity;
  key: string;
}

function resolveActivityKeys(activities: EnrichedActivity[], dayStart: string): KeyedActivity[] {
  return activities.map((activity) => ({
    type: 'activity',
    activity,
    key: activitySortKey(activity, dayStart),
  }));
}

function stayEventKey(stay: Stay, relation: StayRelation, dayStart: string): string {
  if (relation === 'Check out') return stay.checkOutAt;
  if (relation === 'Staying') return dayStart;
  return stay.checkInAt; // 'Check in' or 'Overnight' both anchor on arrival
}

function transitSortKey(transit: Transit, dayStart: string): string {
  return transit.departsAt < dayStart ? dayStart : transit.departsAt;
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
// position in day.sequence AND push every later stage's estimated time back
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
  inTransitActivities: EnrichedActivity[],
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
      stages.push({
        label: seg.label ?? (seg.place?.label as string),
        placeId: seg.place?.id ?? null,
        note: seg.note ?? null,
        kind: seg.kind,
        key: formatWallClock(clockMs),
      });
    }
  }
  return { stages, arrivesAt: formatWallClock(clockMs) };
}

function routeStageItems(transit: EnrichedTransit): TransitStageSequenceItem[] {
  const { variants, selectedTone } = transit.routeInfo as ResolvedRouteInfo;
  return variants.flatMap((variant) =>
    variant.stages.map((stage) => ({
      type: 'transit-stage' as const,
      transit,
      variant,
      stage,
      hidden: variant.tone !== selectedTone,
      key: stage.key,
    })),
  );
}

// A Transit is never one opaque block in the timeline — it expands into a
// "Depart"/"Arrive" boundary pair (still its own rows in the flat sequence,
// not hidden inside the Transit's own block), with any Route's own stages
// (see resolveTransitRoute, below) spread between them — see
// routeStageItems above.
function transitSequenceItems(
  transit: EnrichedTransit,
  dayStart: string,
): (TransitBoundarySequenceItem | TransitStageSequenceItem)[] {
  const items: (TransitBoundarySequenceItem | TransitStageSequenceItem)[] = [
    { type: 'transit-boundary', transit, phase: 'depart', key: transitSortKey(transit, dayStart) },
  ];
  if (transit.routeInfo) {
    items.push(...routeStageItems(transit));
  }
  items.push({
    type: 'transit-boundary',
    transit,
    phase: 'arrive',
    key: transit.arrivesAt as string,
  });
  return items;
}

// A Transit only ever *belongs* to its departure day (transitDepartsOnDay,
// above) — but a stage or the Arrive boundary can carry a real key past
// midnight (stageTimesForVariant's clockMs walk rolls the date over same as
// any other timestamp), and per Guiding principle 03 that real timestamp is
// what decides which day's block it renders under, not which day the
// Transit as a whole is keyed to. transitSequenceItems is still computed
// from the Transit's own departure day throughout (so transitSortKey's
// clamp behaves the same regardless of which day is asking), then filtered
// down to whichever of those items actually land on `date` — the Depart
// boundary only ever survives that filter on the departure day itself,
// while a post-midnight stage/Arrive survives it the next day instead.
function transitItemsOnDate(
  transit: EnrichedTransit,
  date: string,
): (TransitBoundarySequenceItem | TransitStageSequenceItem)[] {
  const departDayStart = `${dateOnly(transit.departsAt)}T00:00`;
  return transitSequenceItems(transit, departDayStart).filter(
    (item) => dateOnly(item.key) === date,
  );
}

interface Keyed {
  key: string;
}

type PreSequenceItem =
  | { type: 'stay'; stay: EnrichedStay; relation: StayRelation; key: string }
  | TransitBoundarySequenceItem
  | TransitStageSequenceItem
  | KeyedActivity
  | { type: 'scenario-tabs'; key: string; tracks?: ScenarioTrack[] };

// Tie-break for two Activities landing on the exact same `key` (the same
// real startAt, or the same TIME_LABEL_ANCHORS-derived instant): a defaulted
// (timeLabel-anchored, no real startAt of its own) Activity sorts first,
// then one with no durationMinutes of its own, then ascending by
// durationMinutes — the trip owner's own ordering rule for same-time rows.
// A tie between anything else (a Stay/Transit item on either side, or two
// non-Activity items) returns 0 so mergeByTime's stable sort falls through
// to the items' original array order instead, preserving the existing
// stays-then-transits-then-activities precedence a same-key tie already
// relied on (see reorder.ts's own note on that).
function activityTieBreak(a: PreSequenceItem, b: PreSequenceItem): number {
  if (a.type !== 'activity' || b.type !== 'activity') return 0;
  const fuzzyA = !a.activity.startAt;
  const fuzzyB = !b.activity.startAt;
  if (fuzzyA !== fuzzyB) return fuzzyA ? -1 : 1;
  const durA = a.activity.durationMinutes;
  const durB = b.activity.durationMinutes;
  if ((durA == null) !== (durB == null)) return durA == null ? -1 : 1;
  return (durA ?? 0) - (durB ?? 0);
}

// Merge-sorts already-keyed items (key: an ISO timestamp — every item has a
// real one by now, see activitySortKey) into chronological order. A stable
// sort so a same-key tie that activityTieBreak doesn't resolve (e.g. two
// Stay/Transit items, or two Activities equally fuzzy/durationed) keeps its
// original already-authored order.
function mergeByTime(items: PreSequenceItem[]): PreSequenceItem[] {
  return [...items].sort((a, b) => {
    if (a.key < b.key) return -1;
    if (a.key > b.key) return 1;
    return activityTieBreak(a, b);
  });
}

// Collapses consecutive { type: 'activity' } items into one
// { type: 'section', activities } block — a Stay/Transit event in between
// breaks the run — so the renderer can group them under one list without
// re-deriving that grouping itself.
function collapseActivityRuns(ordered: PreSequenceItem[]): SequenceItem[] {
  const sequence: SequenceItem[] = [];
  let run: EnrichedActivity[] | null = null;
  const flushRun = () => {
    if (run) sequence.push({ type: 'section', activities: run });
    run = null;
  };
  for (const item of ordered) {
    if (item.type !== 'activity') {
      flushRun();
      sequence.push(item);
      continue;
    }
    run = run ? [...run, item.activity] : [item.activity];
  }
  flushRun();
  return sequence;
}

// scenarioAnchorKey (from buildScenarioTracks below) is the day's
// ideal-or-first candidate track's own earliest real key — passed in here so
// a single { type: 'scenario-tabs' } placeholder can be merge-sorted into the
// backbone at that real chronological position, instead of the tab group
// always trailing every other event on the day regardless of when its own
// content actually falls (see DayTimeline, which now just renders whatever
// lands at that slot rather than special-casing the tab group's placement).
// It's scoped to just that one default-shown track (the same "planned by
// default" convention idealOrFirstTrack/dayMapStops/deriveSummary already
// use), not the earliest moment across every sibling candidate: a sibling
// track's own content can start well before the one actually displayed, and
// anchoring to that borrowed, earlier moment would leave anything landing in
// the gap between it and the *displayed* track's own real start looking like
// it renders after the whole tab group despite its own time being earlier.
// The tradeoff is the reverse of the nested case below: switching which tab
// is live-selected can leave the badge's own backbone position stale
// relative to newly-displayed content, since that pick isn't known yet at
// this pure, selection-independent build step — accepted deliberately here
// in exchange for a placement that's normally correct.
function buildSequence(
  dayStays: EnrichedStay[],
  transitsForSequence: EnrichedTransit[],
  dayActivities: EnrichedActivity[],
  date: string,
  dayStart: string,
  scenarioAnchorKey: string | null,
): SequenceItem[] {
  const items: PreSequenceItem[] = [
    ...dayStays.map((stay) => {
      const relation = stayRelation(stay, date);
      return { type: 'stay' as const, stay, relation, key: stayEventKey(stay, relation, dayStart) };
    }),
    ...transitsForSequence
      .filter((t) => !t.scenarioId)
      .flatMap((transit) => transitItemsOnDate(transit, date)),
    ...resolveActivityKeys(
      dayActivities.filter((a) => !a.scenarioId),
      dayStart,
    ),
  ];
  if (scenarioAnchorKey) items.push({ type: 'scenario-tabs', key: scenarioAnchorKey });
  return collapseActivityRuns(mergeByTime(items));
}

// A track's own scenario can carry `parentScenarioId`, naming another
// scenario present the *same* day it nests under instead of standing as its
// own top-level tab — e.g. Jul 1's "if it flew today" / "if grounded today"
// split only makes sense once you're already inside the alt track's own
// afternoon, so it renders as its own small tab group inside that track's
// panel rather than as a sibling of Jul 1's ideal/alt pair. buildTrack
// recurses to pick up any such children — each nested group gets folded into
// its PARENT's own sequence as a { type: 'scenario-tabs', tracks } placeholder,
// keyed to the earliest of its children's own real times, for exactly the
// reason scenarioAnchorKey (above) exists for the day's outer tab group:
// without it, the nested tabs would always render after every other item in
// the parent panel regardless of when their own content actually falls, the
// same bug that placeholder was built to avoid one level up.
function buildScenarioTracks(
  transitsForSequence: EnrichedTransit[],
  dayActivities: EnrichedActivity[],
  scenariosById: Map<string, Scenario>,
  notes: Note[],
  date: string,
  dayStart: string,
): { tracks: ScenarioTrack[]; anchorKey: string | null } {
  const present = new Set([
    ...transitsForSequence.map((t) => t.scenarioId).filter((id): id is string => Boolean(id)),
    ...dayActivities.map((a) => a.scenarioId).filter((id): id is string => Boolean(id)),
  ]);

  function trackOwnItems(
    scenarioId: string,
  ): (TransitBoundarySequenceItem | TransitStageSequenceItem | KeyedActivity)[] {
    return [
      ...transitsForSequence
        .filter((t) => t.scenarioId === scenarioId)
        .flatMap((transit) => transitItemsOnDate(transit, date)),
      ...resolveActivityKeys(
        dayActivities.filter((a) => a.scenarioId === scenarioId),
        dayStart,
      ),
    ];
  }

  function earliestKey(items: Keyed[]): string | null {
    return items.reduce<string | null>(
      (min, item) => (min === null || item.key < min ? item.key : min),
      null,
    );
  }

  // A *real* earliest key for one scenario's own content — unlike ownKey
  // (below, from trackOwnItems), which runs a Transit's boundary through
  // transitSortKey and so clamps a transit already in progress before today
  // (departsAt before dayStart) up to dayStart. That clamp is correct for
  // where the boundary itself renders in today's sequence, but wrong for
  // deciding where a *nested* group's tab placeholder belongs relative to
  // the parent's real timeline (see its one use, below) — a transit that's
  // actually been running since yesterday shouldn't out-rank a same-day 7am
  // event just because its clamped key reads as "start of day".
  function realOwnKey(scenarioId: string): string | null {
    const transitKeys = transitsForSequence
      .filter((t) => t.scenarioId === scenarioId)
      .map((t) => t.departsAt);
    const activityKeys = dayActivities
      .filter((a) => a.scenarioId === scenarioId)
      .map((a) => activitySortKey(a, dayStart));
    return earliestKey([...transitKeys, ...activityKeys].map((key) => ({ key })));
  }

  function buildTrack(scenarioId: string, scenario: Scenario): ScenarioTrack {
    const items = trackOwnItems(scenarioId);
    const ownKey = earliestKey(items);

    const children: ScenarioTrack[] = [];
    for (const [childId, childScenario] of scenariosById) {
      if (childScenario.parentScenarioId !== scenarioId) continue;
      const childTrack = includableTrack(childId, childScenario, date);
      if (childTrack) children.push(childTrack);
    }
    const realAnchorKey = children.length
      ? earliestKey(
          [realOwnKey(scenarioId), ...children.map((c) => c.realAnchorKey)]
            .filter((k): k is string => k !== null)
            .map((key) => ({ key })),
        )
      : realOwnKey(scenarioId);
    const sequenceItems: PreSequenceItem[] = [...items];
    if (children.length) {
      // A nested placeholder is keyed off a *real* signal wherever one
      // exists in the subtree (e.g. Jul 1's actual 7:30am flight attempt),
      // falling back to the possibly-borrowed per-child anchor only if the
      // whole nested group is genuinely unanchored, and dayStart only if
      // that's unanchored too.
      const childKey =
        earliestKey(
          children
            .map((c) => c.realAnchorKey)
            .filter((k): k is string => k !== null)
            .map((key) => ({ key })),
        ) ??
        earliestKey(
          children.filter((c) => c.anchorKey !== null).map((c) => ({ key: c.anchorKey as string })),
        );
      sequenceItems.push({ type: 'scenario-tabs', key: childKey ?? dayStart, tracks: children });
    }
    return {
      scenario,
      notes: notesForEntity(notes, 'scenario', scenarioId),
      sequence: collapseActivityRuns(mergeByTime(sequenceItems)),
      anchorKey: ownKey,
      realAnchorKey,
    };
  }

  // A scenarioId can land in `present` without actually putting anything on
  // *this* date: transitsForSequence (buildDay) folds in every Transit that
  // merely departed yesterday, purely so an overnight one's post-midnight
  // stages/Arrive still render today — a same-day Transit that doesn't
  // cross midnight is still in that list, contributing its scenarioId to
  // `present` while resolving to zero real items today (trackOwnItems'
  // transitItemsOnDate returns nothing for it on this date). Building the
  // track and checking its own sequence, rather than trusting `present`
  // alone, is what tells that apart from a genuinely-empty, deliberately
  // date-anchored new scenario (blankScenario's own `date` field) — the
  // former must stay invisible (nothing to show, and no droppable target
  // makes sense for content that isn't actually missing), the latter is
  // exactly the case DayTimeline's own EmptyDropZone exists for.
  function includableTrack(
    scenarioId: string,
    scenario: Scenario,
    forDate: string,
  ): ScenarioTrack | null {
    const isNewEmpty = !present.has(scenarioId) && scenario.date === forDate;
    if (!present.has(scenarioId) && !isNewEmpty) return null;
    const track = buildTrack(scenarioId, scenario);
    if (!track.sequence.length && !isNewEmpty) return null;
    return track;
  }

  const tracks: ScenarioTrack[] = [];
  for (const [scenarioId, scenario] of scenariosById) {
    if (scenario.parentScenarioId) continue; // picked up as a child, above
    const track = includableTrack(scenarioId, scenario, date);
    if (track) tracks.push(track);
  }
  // A brand-new scenario with no Activity/Transit of its own yet has no real
  // anchorKey to offer (ownKey comes back null from an empty trackOwnItems) —
  // falling back to dayStart, rather than leaving anchorKey null, is what
  // keeps buildSequence below willing to splice the { type: 'scenario-tabs' }
  // placeholder into today's sequence at all; a null anchorKey there is read
  // as "no scenario content exists today," which would silently drop the
  // whole tab group (including any *other*, real-content sibling track)
  // whenever the ideal-or-first pick happens to be the still-empty one.
  const anchorKey = tracks.length
    ? (idealOrFirstTrack({ scenarioTracks: tracks })?.anchorKey ?? dayStart)
    : null;
  return { tracks, anchorKey };
}

function truncateSummary(text: string): string {
  return text.length > 140 ? `${text.slice(0, 137)}…` : text;
}

// A branching day's headline event (e.g. flightseeing) only exists on one
// scenario track — the "planned" one, same convention used throughout: ideal
// if present, otherwise whichever track is there.
function idealOrFirstTrack(day: Pick<Day, 'scenarioTracks'>): ScenarioTrack | null {
  return (
    day.scenarioTracks.find((t) => t.scenario.tone === 'ideal') ?? day.scenarioTracks[0] ?? null
  );
}

// Every place with a resolvable id touched by a day, in the same
// chronological order `sequence` itself renders in — used to find "the
// first/last place of the day" for the live weather strip's sunrise/sunset.
// A scenario-tabs split recurses into its ideal-or-first track (same
// convention as idealOrFirstTrack/plannedTrackCandidates above) rather than
// every branch, since only one branch is what actually happens.
function orderedPlaceIds(sequence: SequenceItem[]): string[] {
  return sequence.flatMap((item): string[] => {
    switch (item.type) {
      case 'stay': {
        const id = item.stay.lodging?.placeId;
        return id ? [id] : [];
      }
      case 'transit-boundary': {
        const id = item.phase === 'depart' ? item.transit.from?.id : item.transit.to?.id;
        return id ? [id] : [];
      }
      case 'transit-stage':
        return item.stage.placeId ? [item.stage.placeId] : [];
      case 'section':
        return item.activities.flatMap((a) => (a.place?.id ? [a.place.id] : []));
      case 'scenario-tabs': {
        const track = idealOrFirstTrack({ scenarioTracks: item.tracks ?? [] });
        return track ? orderedPlaceIds(track.sequence) : [];
      }
    }
  });
}

function firstActivityIn(sequence: SequenceItem[]): EnrichedActivity | null {
  return (
    (sequence.find((i) => i.type === 'section') as SectionSequenceItem | undefined)
      ?.activities[0] ?? null
  );
}

function deriveSummary(
  day: Pick<Day, 'scenarioTracks' | 'sequence' | 'stays' | 'location'>,
): string {
  const idealTrack = idealOrFirstTrack(day);
  const first =
    firstActivityIn(day.sequence) ?? (idealTrack && firstActivityIn(idealTrack.sequence));
  if (first) return truncateSummary(first.text);
  if (day.stays[0]) return `Staying at ${day.stays[0].lodging?.name ?? day.location}`;
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

export function sectionActivities(sequence: SequenceItem[]): EnrichedActivity[] {
  return (sequence.filter((i) => i.type === 'section') as SectionSequenceItem[]).flatMap(
    (i) => i.activities,
  );
}

// Same as sectionActivities, but also recurses into every nested
// scenario-tabs split's own tracks (unlike plannedTrackCandidates, which
// stops at the first sibling with a candidate) — for callers that need
// every Activity a day could possibly render, regardless of which branch,
// e.g. mealOptions.ts's overlap-warning pool.
export function sectionActivitiesDeep(sequence: SequenceItem[]): EnrichedActivity[] {
  return sequence.flatMap((item) => {
    if (item.type === 'section') return item.activities;
    if (item.type === 'scenario-tabs') {
      return (item.tracks ?? []).flatMap((track) => sectionActivitiesDeep(track.sequence));
    }
    return [];
  });
}

// A single track's own priority-activity candidates, plus whatever its
// nested scenario-tabs split (if any) contributes — resolveNested decides
// which nested track(s) that comes from, so this same walk serves both the
// build-time "planned" convention (plannedTrackCandidates below, which
// falls through nested siblings) and a live-selection-aware caller
// (scenarioSelection.ts's ownActiveCandidates, which follows exactly the
// currently-active nested track) without duplicating the own-activities/
// find-scenario-tabs-item shape twice.
export function ownTrackCandidates(
  track: ScenarioTrack,
  resolveNested: (tracks: ScenarioTrack[]) => EnrichedActivity[],
): EnrichedActivity[] {
  const own = sectionActivities(track.sequence).filter((a) => a.priority);
  const tabs = track.sequence.find(
    (i): i is ScenarioTabsSequenceItem => i.type === 'scenario-tabs',
  );
  const nested = tabs?.tracks?.length ? resolveNested(tabs.tracks) : [];
  return [...own, ...nested];
}

// Tries a group of sibling tracks ideal-tone-first (same convention as
// idealOrFirstTrack), recursing into any nested scenario-tabs split each
// track contains — but if the preferred track's own chain carries no
// headline (priority) event at all, falls through to the next sibling
// rather than surfacing a blank title. Jul 1 is exactly this case: the
// top-level "Relaxed drive-back day" (ideal) branch has no priority
// activity, but its sibling "Last-chance backup day" does, two levels down
// inside its own "Flight goes" split — so that's what should title the day.
// Still never combines two branches' candidates together — the first
// sibling with any candidate wins outright, so a flightseeing day's title
// doesn't also drag in its own weathered-out backup.
function plannedTrackCandidates(tracks: ScenarioTrack[]): EnrichedActivity[] {
  if (!tracks.length) return [];
  const ideal = idealOrFirstTrack({ scenarioTracks: tracks });
  const ordered = ideal ? [ideal, ...tracks.filter((t) => t !== ideal)] : tracks;
  for (const track of ordered) {
    const candidates = ownTrackCandidates(track, plannedTrackCandidates);
    if (candidates.length) return candidates;
  }
  return [];
}

// Pulled from day.sequence (the fixed backbone) plus the planned scenario
// tracks.
function titleCandidates(day: Pick<Day, 'scenarioTracks' | 'sequence'>): EnrichedActivity[] {
  const fixed = sectionActivities(day.sequence).filter((a) => a.priority);
  return [...fixed, ...plannedTrackCandidates(day.scenarioTracks)];
}

// Exported so a live-selection-aware caller (DayBlock, via
// scenarioSelection.ts's activeTitleCandidates) can join its own candidate
// list the same way day.title's build-time default does, rather than
// duplicating the priority-rank/tie-join rule.
export function deriveTitle(location: string, candidates: EnrichedActivity[]): string {
  if (!candidates.length) return location;
  const topRank = Math.max(...candidates.map((a) => PRIORITY_RANK[a.priority as string]));
  return candidates
    .filter((a) => PRIORITY_RANK[a.priority as string] === topRank)
    .map((a) => a.text)
    .join(' & ');
}

// ---------- day map — a computed Google Maps embed for the day-list header's
// map button. Built from the same places already in day.sequence/
// scenarioTracks, in that same chronological order, rather than a stored
// per-day map field (there's nowhere in the data model that would belong —
// it's entirely derivable from the Stay/Transit/Activity places already on
// the day, same as everything else buildDay computes). Uses the classic
// maps.google.com/maps?...&output=embed iframe form rather than the official
// (paid, key-gated) Maps Embed API — every stop here is plain text a person
// could type into Maps' own search box, and this trip's places.ts Places API
// key is deliberately restricted to Places API calls only, so this avoids
// both a second API to enable and a second key restriction to maintain. ----------

// A Stay's check-in/check-out events are keyed to their own clock time (see
// stayEventKey above) so they sort into day.sequence wherever that falls —
// but rather than let an 11am formal checkout land after a 6:30am departure,
// or a mid-afternoon check-in land ahead of an 8am breakfast, checkout always
// sorts first and check-in always last: each reads as "leaving here"/"staying
// here tonight" context for the day rather than a scheduled event competing
// with the timeline between them. A 'Staying' night (no check-in/check-out
// event today) reads the same way as check-in — "this is where tonight ends
// up" — so it groups with check-in rather than sitting wherever its
// synthetic dayStart anchor (stayEventKey) would otherwise sort it, which
// was always the very top of the day. Shared by the visible day list
// (DayTimeline) and dayMapStops below (so the computed map's last stop is
// always tonight's actual lodging, not wherever check-in's raw timestamp
// happened to sort).
export function splitOutStayBoundaries(sequence: SequenceItem[]): {
  checkOuts: SequenceItem[];
  rest: SequenceItem[];
  checkIns: SequenceItem[];
} {
  const checkOuts = sequence.filter(
    (item) => item.type === 'stay' && item.relation === 'Check out',
  );
  const checkIns = sequence.filter(
    (item) => item.type === 'stay' && (item.relation === 'Check in' || item.relation === 'Staying'),
  );
  const rest = sequence.filter((item) => !checkOuts.includes(item) && !checkIns.includes(item));
  return { checkOuts, rest, checkIns };
}

// A meal's own place lives on whichever MealOption is still open
// (data-model.html) rather than activity.place. Matching the row's own live
// tab selection needs the meal row's activeMealOptions helper (it filters
// out options an earlier Stay checkout already closed off — see
// isIncludedOptionActive) to know which candidate a tab index even refers
// to, and this module deliberately doesn't import that helper (which already
// imports from here) to get it — so a caller that resolved the selection off
// live UI state itself passes the *place* it landed on directly, as
// mealPlaces (activityId -> place or null, only for activities the caller
// actually found a meal row for). Anything not in the map — a non-meal
// activity, or a caller that skipped reading live state — falls back to the
// first candidate that names a place, same as before this was made selectable.
function resolveActivityPlace(
  activity: EnrichedActivity,
  mealPlaces?: Map<string, Place | null>,
): Place | null {
  if (activity.place) return activity.place;
  if (mealPlaces?.has(activity._id)) return mealPlaces.get(activity._id) ?? null;
  return activity.options?.find((o) => o.place)?.place ?? null;
}

// Same "planned by default" convention deriveSummary/deriveTitle use, but
// overridable by a live scenario-tab selection (scenarioTone) a caller read
// off live UI state — see dayMapStops/dayFullRouteStops below, both of which
// want whichever branch the reader is actually looking at, not always the plan.
function selectedTrack(
  day: Pick<Day, 'scenarioTracks'>,
  scenarioTone?: string,
): ScenarioTrack | null {
  if (scenarioTone) {
    const track = day.scenarioTracks.find((t) => t.scenario.tone === scenarioTone);
    if (track) return track;
  }
  return idealOrFirstTrack(day);
}

function sequenceMapLabels(
  sequence: SequenceItem[],
  mealPlaces?: Map<string, Place | null>,
): string[] {
  const labels: string[] = [];
  for (const item of sequence) {
    // A 'Staying' item (every night of a multi-night Stay that isn't the
    // actual arrival/departure day) only counts as a map stop when its
    // lodging carries a real placeId — a fixed hotel/lodge, whose name
    // geocodes reliably on its own. A Stay with no fixed point at all — a
    // cruise ship mid-voyage (lodging.placeId: null) — stays excluded even
    // on a 'Staying' night: Google's classic embed resolves the free-text
    // ship name to the cruise line's corporate HQ address instead, plotting
    // a fictional thousands-of-miles driving route on a day that's really
    // just shore excursions. Check in/Check out/Overnight stay on the map
    // by name regardless of placeId, same as before.
    if (
      item.type === 'stay' &&
      item.stay.lodging?.name &&
      (item.relation !== 'Staying' || item.stay.lodging.placeId)
    ) {
      labels.push(item.stay.lodging.name);
    } else if (item.type === 'transit-boundary') {
      labels.push((item.phase === 'depart' ? item.transit.from : item.transit.to).label);
      // transit-stage (a route's interim places) is deliberately skipped —
      // not a data-quality concern (every place now resolves to a real Place
      // ID or explicit coordinates; see data-model.html's Route entity), but
      // because dayMapEmbedUrl below only ever draws a start→end route: this
      // same keyless embed endpoint mis-plots the trip when fed waypoints via
      // daddr's "+to:" chaining, even when every stop is individually
      // unambiguous — it's the waypoint-chaining mechanism itself that's
      // unreliable, verified by hand against this trip's own routes, not the
      // input data. The resolved place/coordinates are still there on each
      // Route's own places[] (routes.json) if a future page ever needs to plot
      // a stage on its own — stageTimesForVariant above just doesn't carry
      // them through to routeStageItems, since nothing reads them yet.
    } else if (item.type === 'section') {
      for (const activity of item.activities) {
        const place = resolveActivityPlace(activity, mealPlaces);
        if (place) labels.push(place.label);
      }
    }
  }
  return labels;
}

// Replaces every { type: 'scenario-tabs' } placeholder in `sequence` with
// its selected track's own sequence, in place of the placeholder, instead of
// dropping it — buildSequence/buildTrack key that placeholder to the
// branching content's own earliest real time (scenarioAnchorKey/childKey) so
// it merge-sorts into the right chronological slot, but a scenario-less
// Activity that falls *after* the branch content (Jul 1's dinner, once every
// weather branch has converged on the same hotel for the evening) still
// needs the branch's own events actually expanded there to land before it —
// otherwise a caller that just filters the placeholder out and appends the
// track separately (as dayMapStops/dayFullRouteStops used to) always sorts
// the whole branch ahead of that later backbone content, regardless of its
// real time. The top-level placeholder (from buildSequence) carries no
// `tracks` of its own — `track` is that level's live selection, resolved by
// the caller via selectedTrack. A nested placeholder (from buildTrack, e.g.
// Jul 1's flew/grounded split) does carry its own `tracks`; DaySelections
// has no live choice for that level, so it falls back to idealOrFirstTrack,
// the same "planned by default" convention orderedPlaceIds/
// plannedTrackCandidates already use for nested groups.
function expandScenarioTabs(sequence: SequenceItem[], track: ScenarioTrack | null): SequenceItem[] {
  return sequence.flatMap((item): SequenceItem[] => {
    if (item.type !== 'scenario-tabs') return [item];
    const chosen = item.tracks ? idealOrFirstTrack({ scenarioTracks: item.tracks }) : track;
    return chosen ? expandScenarioTabs(chosen.sequence, null) : [];
  });
}

// A same-day "there and back" excursion — a floatplane day trip, a shuttle
// bus past a private-vehicle closure like Denali's — shows up in a resolved
// sequence as a pair of non-'drive' Transit boundaries: an outbound `depart`
// whose `to` matches a later `arrive`'s own `from`. Returns each such pair's
// own [outboundIdx, returnIdx] span. Shared by drivableRuns below, which
// uses it to both drop each pair's own interior (the remote destination, and
// anything that happened there) and recognize that a pair's *outer*
// boundary — the outbound depart and the return arrive, both firmly on the
// drivable side (the floatplane dock, the tour depot) — isn't a break in the
// day's own drivable network, unlike a genuine one-way relocation.
function findExcursionPairs(sequence: SequenceItem[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  let outboundIdx: number | null = null;
  let awaitedReturnLabel: string | null = null;
  sequence.forEach((item, i) => {
    if (item.type !== 'transit-boundary' || item.transit.mode === 'drive') return;
    if (outboundIdx === null) {
      // Not currently inside a pending excursion — only a 'depart' can open
      // one; an 'arrive' with nothing pending is either a genuine
      // relocation's arrival, or the day's very first non-'drive' Transit —
      // drivableRuns below is what actually tells those apart.
      if (item.phase === 'depart') {
        outboundIdx = i;
        awaitedReturnLabel = item.transit.to.label;
      }
      return;
    }
    // Already inside a pending excursion — only an 'arrive' whose own
    // `from` matches where the outbound leg went closes it. Everything else
    // along the way (the outbound's own arrival at that destination, the
    // return leg's own departure from it, any interior Activities) stays
    // inside the span once it closes — including a same-mode 'depart' here,
    // which is the *return* leg's departure, not a fresh excursion.
    if (item.phase === 'arrive' && item.transit.from.label === awaitedReturnLabel) {
      pairs.push([outboundIdx, i]);
      outboundIdx = null;
      awaitedReturnLabel = null;
    }
  });
  return pairs;
}

// Splits a resolved sequence into the maximal chronological runs that are
// all mutually reachable by driving, dropping each same-day excursion's own
// interior (findExcursionPairs above) along the way. A genuine relocation —
// a non-'drive' Transit boundary that isn't part of any same-day excursion
// pair, e.g. the one-way Anchorage -> Kotzebue flight — starts a brand new
// run: its own `to` was never visited earlier in the current run, so
// nothing before it and nothing after it are on the same road network, and
// a single driving route (or the classic embed's single origin/destination
// pair) can never legitimately span across it. An excursion's own outer
// boundary doesn't split anything, since both ends are the same real,
// already-drivable point (the dock you left from and the one you land back
// at) — only its interior gets dropped. Shared by dayMapStops and
// dayFullRouteStops so both agree on how many separate maps/routes a day
// actually needs, and what belongs in each one.
function drivableRuns(sequence: SequenceItem[]): SequenceItem[][] {
  const pairs = findExcursionPairs(sequence);
  const pairStarts = new Set(pairs.map(([start]) => start));
  const pairEnds = new Set(pairs.map(([, end]) => end));
  const insideExcursionInterior = (i: number) => pairs.some(([start, end]) => i > start && i < end);

  const runs: SequenceItem[][] = [[]];
  sequence.forEach((item, i) => {
    if (insideExcursionInterior(i)) return;
    const isGenuineRelocation =
      item.type === 'transit-boundary' &&
      item.transit.mode !== 'drive' &&
      !pairStarts.has(i) &&
      !pairEnds.has(i);
    // An unpaired 'arrive' is landing somewhere new — nothing in the
    // current (about-to-be-closed) run is reachable from here, so it opens
    // the next run instead of joining this one.
    if (isGenuineRelocation && item.phase === 'arrive') runs.push([]);
    runs[runs.length - 1].push(item);
    // An unpaired 'depart' is the last drivable thing before leaving the
    // road network entirely — it stays in this run, which then closes.
    if (isGenuineRelocation && item.phase === 'depart') runs.push([]);
  });
  return runs.filter((run) => run.length > 0);
}

// A branching day maps only its planned (ideal, or first) track by default —
// same "planned by default" convention deriveSummary/deriveTitle already
// use — rather than plotting both weather branches' places onto one
// confusing route, unless selections names a live scenario/meal choice to
// follow instead (see selectedTrack/resolveActivityPlace above).
//
// Shared by dayMapStops and dayFullRouteStops below: both split a day's
// sequence into drivable runs (drivableRuns above), then bookend the FIRST
// run with the Stay's own checkout/morning-anchor and the LAST with its
// check-in — even when a relocation elsewhere in the day has split the
// middle into more than one run — before collapsing immediate repeats (e.g.
// a Transit arriving exactly where the next Activity already is; a real
// detour back to an earlier place later in the day still keeps both
// listings, just not the same stop twice in a row) and dropping any run left
// empty once bookended. Only how a sequence maps into stops (mapSequence)
// and how two stops compare as "the same place" (sameStop) differ between
// the two callers — one wants plain labels, the other place-id-carrying
// RouteStops.
function bookendedRunSegments<T>(
  day: Day,
  selections: DaySelections,
  mapSequence: (sequence: SequenceItem[]) => T[],
  sameStop: (a: T, b: T) => boolean,
): T[][] {
  const { checkOuts, rest, checkIns } = splitOutStayBoundaries(day.sequence);
  const track = selectedTrack(day, selections.scenarioTone);
  // A 'Staying' night (splitOutStayBoundaries groups it into checkIns
  // alongside a real Check in) is where the day both starts and ends — you
  // left there this morning as much as you're going back there tonight —
  // unlike Check in, which only ever happens once, in the evening. Relisting
  // it here too puts that same lodging at the very front of the day's first
  // run as well, so it reads as the actual there-and-back loop it is instead
  // of starting from wherever the first real activity happens to be.
  const morningStay = checkIns.filter(
    (item) => item.type === 'stay' && item.relation === 'Staying',
  );
  const runs = drivableRuns(expandScenarioTabs(rest, track));
  const segments = (runs.length ? runs : [[]]).map((run) => mapSequence(run));
  segments[0] = [...mapSequence(morningStay), ...mapSequence(checkOuts), ...segments[0]];
  segments[segments.length - 1] = [...segments[segments.length - 1], ...mapSequence(checkIns)];
  return segments
    .map((stops) => stops.filter((stop, i) => i === 0 || !sameStop(stop, stops[i - 1])))
    .filter((stops) => stops.length > 0);
}

// Returns one stop-list per drivable run (drivableRuns above) — almost
// always just one, but a day that crosses a genuine relocation (a one-way
// flight/ferry with no same-day return, e.g. Anchorage -> Kotzebue) can't
// honestly be plotted as a single route, so it comes back as more than one.
export function dayMapStops(day: Day, selections: DaySelections = {}): string[][] {
  return bookendedRunSegments(
    day,
    selections,
    (sequence) => sequenceMapLabels(sequence, selections.mealPlaces),
    (a, b) => a === b,
  );
}

// Only ever plots each run's own first and last stop, never the ones
// between — verified by hand against this trip's own multi-stop days: this
// keyless embed (maps.google.com/maps?...&output=embed, which redirects to
// the un-keyed google.com/maps/embed?origin=mfe&pb=... behind the scenes)
// geocodes a plain two-point origin/destination correctly, but feeding it
// waypoints via daddr's "+to:" chaining silently mis-geocodes one of them
// nowhere near Alaska, once sending the drawn route on a fictional 300-hour
// detour through the Lower 48. A start→end route is still a real, useful
// "where does this leg of the day go" answer; every stop in between is
// already right there in the day's own timeline. One URL per drivable run
// (dayMapStops above) — almost always one, but never a single embed spanning
// a relocation with no road between its two ends.
export function dayMapEmbedUrl(day: Day, selections: DaySelections = {}): string[] {
  return dayMapStops(day, selections).map((stops) => {
    if (stops.length === 1)
      return `https://maps.google.com/maps?q=${encodeURIComponent(stops[0])}&output=embed`;
    const start = encodeURIComponent(stops[0]);
    const end = encodeURIComponent(stops[stops.length - 1]);
    return `https://maps.google.com/maps?saddr=${start}&daddr=${end}&output=embed`;
  });
}

// ---------- day full-route link — a second, non-embedded map action shown
// alongside dayMapEmbedUrl's iframe. Targets the real Directions URL API
// (https://developers.google.com/maps/documentation/urls/get-started#directions-action)
// instead of the classic keyless embed above: verified by hand that a
// `place_id:<id>` value inline in origin/destination/waypoints — the syntax
// the URL API's older docs imply — doesn't actually resolve; Google Maps
// treats it as literal unmatched search text. The documented, working
// mechanism instead pairs each text stop with a same-position id in a
// separate parameter: origin/origin_place_id, destination/
// destination_place_id, and waypoints/waypoint_place_ids (pipe-separated,
// positionally matched to waypoints — see routeStop/dayFullRouteUrls below).
// This also isn't limited to a start→end pair the way the embed is, so
// route vias and activities can ride along as real waypoints. Can't be
// embedded in an iframe the way the classic endpoint can — Google blocks
// framing the interactive Maps site — so this always opens in a new
// tab instead. ----------

// Google caps this URL at 9 waypoints — a hard ceiling on this URL scheme,
// not a raisable quota (the paid Directions/Routes API allows more, but
// costs a second billed API and a key that can't stay Places-only, the same
// trade-off already rejected for dayMapEmbedUrl above). Confirmed by hand: a
// 10th waypoint gets silently dropped rather than rejected, so exceeding
// this is a real, silent content bug, not just a theoretical one. Google's
// own docs describe a lower 3-waypoint ceiling specific to mobile browsers,
// but that tier doesn't apply here in practice — tapping this link on a
// phone launches the native Maps app by default (verified by hand), which
// gets the same 9-waypoint allowance as desktop.
const MAX_ROUTE_WAYPOINTS = 9;

interface RouteStop {
  label: string;
  placeId: string | null;
  // Whether this label is trustworthy enough to route Directions through as
  // a *middle* waypoint even without a resolved placeId (see
  // dayFullRouteUrls' own candidate filter below) — true for a Stay's
  // lodging or an Activity's place, which data-model.html requires to
  // always name one specific point even before that point's Google Place ID
  // gets looked up (e.g. "Rust's Flying Service"); false for a Transit's
  // bare from/to, which can legitimately be a whole city or highway
  // junction ("Anchorage") — precise enough as the day's own first/last
  // stop, but too broad a target for Directions to snap to mid-route.
  // Defaults true; only the transit-boundary call site below passes false.
  trustedAsWaypoint: boolean;
}

// A stop's routable identity: always a label (Directions URL stops are text
// first, an id can only ever supplement one), plus a placeId when one's
// resolved (Activity.place.id, Stay.lodging.placeId, Transit.from/to.placeId)
// — null for the endpoints (a whole city, an unresolved via) that don't have
// one, which still geocode fine by name alone.
function routeStop(
  placeLike:
    | { label?: string; name?: string; id?: string | null; placeId?: string | null }
    | null
    | undefined,
  fallbackLabel?: string,
  trustedAsWaypoint = true,
): RouteStop | null {
  const label = placeLike?.label ?? placeLike?.name ?? fallbackLabel ?? null;
  if (!label) return null;
  return { label, placeId: placeLike?.id ?? placeLike?.placeId ?? null, trustedAsWaypoint };
}

// A routed Transit's live-selected tone: whichever the reader has actually
// picked in routeTones (transitId -> tone), falling back to the model's own
// default (routeInfo.selectedTone) — shared by DayTimeline/RouteVariantTabs'
// rendering and this file's own dayFullRouteStops below, rather than each
// re-deriving the same override-over-default lookup.
export function activeRouteTone(
  transit: { _id: string; routeInfo: ResolvedRouteInfo | null },
  routeTones?: Map<string, string>,
): string | null {
  if (!transit.routeInfo) return null;
  return routeTones?.get(transit._id) ?? transit.routeInfo.selectedTone;
}

// Same chronological order as dayMapStops (checkouts, the day's own
// sequence, the planned scenario track, checkins), but every stop keeps its
// place id when it has one so dayFullRouteUrls can route through it
// precisely, and — same as dayMapStops — comes back as one RouteStop[] per
// drivable run (drivableRuns above) rather than a single flat list, so a
// genuine relocation never gets bridged by a link that has no real road to
// offer.
//
// selections extends the { scenarioTone, mealPlaces } shape dayMapStops
// takes with a third live choice this link also has to honor: routeTones
// (transitId -> tone), overriding which variant's stages count as this
// day's route for a Transit whose picker the reader has actually switched
// away from the model's own default. All three fall back to their own model
// default (routeInfo.selectedTone; idealOrFirstTrack; the first
// place-bearing option) for whatever a caller didn't supply.
function dayFullRouteStops(day: Day, selections: DaySelections = {}): RouteStop[][] {
  const pushSequence = (stops: RouteStop[], sequence: SequenceItem[]) => {
    for (const item of sequence) {
      if (item.type === 'stay') {
        // Same placeId gate as sequenceMapLabels above — a 'Staying' night
        // with no fixed point (a cruise ship mid-voyage) shouldn't route
        // through its own free-text name every day at sea; Check out/Check
        // in still do, unconditionally.
        if (item.relation === 'Staying' && !item.stay.lodging?.placeId) continue;
        const stop = routeStop(item.stay.lodging ?? undefined);
        if (stop) stops.push(stop);
      } else if (item.type === 'transit-boundary') {
        const place = item.phase === 'depart' ? item.transit.from : item.transit.to;
        // Trusted exactly when the movement itself is scheduled/chartered
        // (mode !== 'drive': a flight, a tour bus) — that kind of transport
        // always has one exact departure/arrival point (an airport, a
        // depot), unlike a 'drive' Transit's from/to, which can legitimately
        // be a whole city ("Anchorage") with no one correct point to route a
        // waypoint through. This never reintroduces an excursion's own
        // remote destination as a waypoint — drivableRuns above already
        // drops that boundary event (and everything inside it) before
        // pushSequence ever sees it; what's left here is only an
        // excursion's *outer* boundary, which is drivable by construction,
        // or a genuine relocation's own boundary, which is always its own
        // run's first or last stop (never a mid-run waypoint) by the same
        // logic.
        const stop = routeStop(place, undefined, item.transit.mode !== 'drive');
        if (stop) stops.push(stop);
      } else if (item.type === 'transit-stage') {
        // day.sequence carries every route variant's stages (see
        // routeStageItems), each just tagged hidden for the live-selection
        // toggle — so without this filter a Transit with 2+ variants (e.g.
        // New vs. Old Glenn Highway) would mix both routes' via-points into
        // one link. Prefer whichever tone the reader actually has selected
        // (selections.routeTones); only fall back to routeInfo's own
        // default when the caller didn't pass one.
        const tone = activeRouteTone(item.transit, selections.routeTones);
        if (item.variant.tone !== tone) continue;
        const stop = routeStop({ id: item.stage.placeId, label: item.stage.label });
        if (stop) stops.push(stop);
      } else if (item.type === 'section') {
        for (const activity of item.activities) {
          const place = resolveActivityPlace(activity, selections.mealPlaces);
          const stop = routeStop(place ?? undefined);
          if (stop) stops.push(stop);
        }
      }
    }
  };
  const mapSequence = (sequence: SequenceItem[]) => {
    const stops: RouteStop[] = [];
    pushSequence(stops, sequence);
    return stops;
  };
  return bookendedRunSegments(day, selections, mapSequence, (a, b) => a.label === b.label);
}

function buildDirectionsUrl(
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
    // dayFullRouteUrls below, so this stays positionally 1:1 with waypoints
    // — required, since Google matches the two lists by index rather than
    // by any id embedded in the text.
    params.set('waypoint_place_ids', waypoints.map((stop) => stop.placeId as string).join('|'));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

// A run with more real stops than one link can hold (see
// MAX_ROUTE_WAYPOINTS) gets split into consecutive links instead of picking
// which stops to drop: each link's destination becomes the next link's
// origin, so every stop still ends up in some link, in the same
// chronological order, just spread across more than one tap. Applied
// independently per drivable run (dayFullRouteStops above), so a genuine
// relocation always gets its own separate link(s) too — never one link
// straddling a gap with no road in it.
export function dayFullRouteUrls(day: Day, selections: DaySelections = {}): string[] {
  return dayFullRouteStops(day, selections).flatMap((stops) => {
    if (stops.length < 2) return [];
    const first = stops[0];
    const last = stops[stops.length - 1];
    // A middle waypoint needs either a real placeId or a trustworthy label
    // (RouteStop.trustedAsWaypoint — a Stay/Activity's own place, always one
    // specific point per data-model.html, even before its Google Place ID
    // gets looked up) to be precise enough to route through. A city-level
    // label like "Anchorage" (a Transit's from/to with no placeId) is too
    // ambiguous to trust as a waypoint, even though it's fine as a link's
    // own origin/destination — those skip this filter entirely, essential
    // regardless of whether they resolved to a place id, and pass their id
    // via the separate _place_id parameter instead (see the section header
    // comment above for why it can't just live inline).
    const candidates = stops.slice(1, -1).filter((stop) => stop.placeId || stop.trustedAsWaypoint);
    const points = [first, ...candidates, last];
    const urls: string[] = [];
    let originIndex = 0;
    while (originIndex < points.length - 1) {
      const destinationIndex = Math.min(originIndex + MAX_ROUTE_WAYPOINTS + 1, points.length - 1);
      const waypoints = points.slice(originIndex + 1, destinationIndex);
      urls.push(buildDirectionsUrl(points[originIndex], points[destinationIndex], waypoints));
      originIndex = destinationIndex;
    }
    return urls;
  });
}

function buildDay(
  date: string,
  legs: Leg[],
  legDateRanges: Map<string, DateRange | null>,
  stays: EnrichedStay[],
  transits: EnrichedTransit[],
  activitiesByDate: Map<string, EnrichedActivity[]>,
  scenariosById: Map<string, Scenario>,
  notes: Note[],
): Day | null {
  // A date that falls inside two legs' computed ranges at once (e.g. a
  // same-day handoff, one leg's checkout and the next leg's departure both
  // landing on it) still renders every entity from every leg that claims the
  // date — nothing here is dropped. Only the day's own *identity* (its
  // `leg`/header, used for LegDialog's day list and default location)
  // resolves to whichever leg sorts first in legs' own authored order —
  // there's no boundary field left to disambiguate that with.
  const legsForDate = legs.filter((l) => {
    const range = legDateRanges.get(l._id);
    return range && range.startDate <= date && date <= range.endDate;
  });
  const leg = legsForDate[0];
  if (!leg) return null;
  const legIds = new Set(legsForDate.map((l) => l._id));

  const dayStart = `${date}T00:00`;
  const dayEnd = `${addDaysStr(date, 1)}T00:00`;

  const dayStays = stays.filter((s) => legIds.has(s.legId) && stayOverlapsDay(s, dayStart, dayEnd));
  const legTransits = transits.filter((t) => legIds.has(t.legId));
  const dayTransits = legTransits.filter((t) => transitDepartsOnDay(t, date));
  const dayActivities = (activitiesByDate.get(date) ?? []).filter((a) => legIds.has(a.legId));

  // A Transit that departed yesterday but rolls past midnight (see
  // transitItemsOnDate) still owes today's sequence its own post-midnight
  // stages/Arrive boundary — looked up against the full trip's transits,
  // not just this leg's, since the overnight drive can be the very Transit
  // that crosses a leg boundary. transitsForSequence is what actually feeds
  // the day's rendered timeline; dayTransits (departure-day only) stays the
  // set used for the day's own identity (transits, arrivingTransit, etc.).
  const previousDate = addDaysStr(date, -1);
  const spilloverTransits = transits.filter((t) => transitDepartsOnDay(t, previousDate));
  const transitsForSequence = [...dayTransits, ...spilloverTransits];

  // The stay whose checkout is today but check-in wasn't (i.e. only touching
  // this day on the way out) is skipped in favor of wherever the day actually
  // ends up — the incoming stay, or the one already in progress.
  const primaryStay =
    dayStays.find((s) => !(dateOnly(s.checkOutAt) === date && dateOnly(s.checkInAt) !== date)) ??
    dayStays[0] ??
    null;
  // Looked up against every one of the leg's Transits, not just dayTransits —
  // a day with nothing else to name itself after still needs to know one
  // arrived here, even though (per transitItemsOnDate) the Arrive boundary
  // itself now also renders inline in today's sequence.
  const arrivingTransit = legTransits.find((t) => t.arrivesAt && dateOnly(t.arrivesAt) === date);
  const location =
    primaryStay?.lodging?.name ??
    arrivingTransit?.to?.label ??
    dayTransits[0]?.from?.label ??
    leg.name;
  const locationPlaceId =
    primaryStay?.lodging?.placeId ?? arrivingTransit?.to?.id ?? dayTransits[0]?.from?.id ?? null;

  const { tracks: scenarioTracks, anchorKey: scenarioAnchorKey } = buildScenarioTracks(
    transitsForSequence,
    dayActivities,
    scenariosById,
    notes,
    date,
    dayStart,
  );
  const sequence = buildSequence(
    dayStays,
    transitsForSequence,
    dayActivities,
    date,
    dayStart,
    scenarioAnchorKey,
  );

  // Sunrise/sunset track wherever the day actually starts and ends —
  // chronological order already puts a checkout Stay first and a check-in
  // Stay last (see buildSequence's own stay-boundary-ordering note), so this
  // is just "the first/last place with a resolvable id", not a special case.
  const dayPlaceIds = orderedPlaceIds(sequence);
  const sunrisePlaceId = dayPlaceIds[0] ?? null;
  const sunsetPlaceId = dayPlaceIds[dayPlaceIds.length - 1] ?? null;
  // The high/low temperature follows the same priority the header title
  // does — a flightseeing day's weather is the flightseeing spot's, not the
  // hotel's — falling back to the day's own default location otherwise.
  // Computed once here and reused below for the title itself, rather than
  // each re-deriving its own titleCandidates() pass over the same day.
  const candidates = titleCandidates({ scenarioTracks, sequence });
  const weatherPlaceId = candidates.find((a) => a.place?.id)?.place?.id ?? locationPlaceId;

  const day: Day = {
    date,
    dateLabel: formatDateLabel(date),
    leg,
    location,
    sunrisePlaceId,
    sunsetPlaceId,
    weatherPlaceId,
    stays: dayStays,
    transits: dayTransits,
    sequence,
    scenarioTracks,
    notes: notesForDay(notes, date),
    summary: '',
    title: '',
  };
  day.summary = deriveSummary(day);
  day.title = deriveTitle(day.location, candidates);
  return day;
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

function inTransitActivities(transit: Transit, activities: EnrichedActivity[]): EnrichedActivity[] {
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
  transit: Transit,
  formatOverrides?: Map<string, DiningFormat>,
): boolean {
  if (!activity.startAt) return false;
  const minutes = activityDurationMinutes(activity, formatOverrides);
  if (minutes == null) return false;
  const activityEndsAt = addMinutesIso(activity.startAt, minutes);
  return (
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
  const departing = transits.find((t) =>
    transitDepartsDuringActivity(activity, t, formatOverrides),
  );
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
function activitiesOverlap(
  a: Activity,
  b: Activity,
  formatOverrides?: Map<string, DiningFormat>,
): boolean {
  if (!a.startAt || !b.startAt) return false;
  if (a.legId !== b.legId || a.scenarioId !== b.scenarioId) return false;
  const aEnd = addMinutesIso(a.startAt, activityDurationMinutes(a, formatOverrides) ?? 0);
  const bEnd = addMinutesIso(b.startAt, activityDurationMinutes(b, formatOverrides) ?? 0);
  return a.startAt < bEnd && b.startAt < aEnd;
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
  return (
    activities.find(
      (other) =>
        other._id !== activity._id &&
        activitiesOverlap(activity, other, formatOverrides) &&
        !isIncludedWithActivity(activity, other) &&
        !isIncludedWithActivity(other, activity),
    ) ?? null
  );
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
      ? `Overlaps with "${overlappingActivity.text}".`
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
// Directions URL (dayMapEmbedUrl, dayFullRouteUrls), that silently sent a
// real "open in Google Maps" link on an 8-hour detour. The non-negative
// durationMinutes check guards a second, subtler way order could break: a
// route is an ordered list — variant.places.map in stageTimesForVariant
// (above) always walks it in that authored order — but each stage's own
// computed key still gets sorted alongside every other event in the day by
// mergeByTime. That sort only ever preserves the places list's authored
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
  activities: EnrichedActivity[],
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
        label: stay.lodging?.name ?? 'Lodging',
        date: dateOnly(stay.checkInAt),
        booking: stay.booking,
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
        label: activity.text,
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
          label: option.place ? `${activity.text} — ${option.place.label}` : activity.text,
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

function groupBudgetByLeg(legs: Leg[], rows: BudgetRow[]): BudgetLegGroup[] {
  return legs
    .map((leg) => {
      const legRows = rows.filter((r) => r.legId === leg._id);
      return { leg, totals: totalsFor(legRows), rows: legRows };
    })
    .filter((g) => g.rows.length);
}

function groupBudgetByDay(days: Day[], rows: BudgetRow[]): BudgetDayGroup[] {
  const datedRows = rows.filter((r) => r.date);
  return days
    .map((day) => {
      const dayRows = datedRows.filter((r) => r.date === day.date);
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
    } else {
      const share = travelers.length || 1;
      const cost = {
        amount: (row.booking.cost as Money).amount / share,
        currency: (row.booking.cost as Money).currency,
      };
      for (const t of travelers)
        addToBudgetTotals(totalsByName.get(t.name) as BudgetTotals, row.bucket, cost);
    }
  }
  return [...totalsByName.entries()].map(([name, totals]) => ({ name, totals }));
}

export function buildBudgetView(
  trip: Trip,
  legs: Leg[],
  days: Day[],
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
  includedIn: Ref | null | undefined,
  packagesById: Map<string, Package>,
): string[] | null {
  if (!includedIn || !('entity' in includedIn) || includedIn.entity !== 'package') return null;
  const everyone = tripTravelers.map((t) => t.name);
  const pkg = packagesById.get(includedIn.id);
  if (!pkg?.travelers?.length) return everyone;
  const byId = travelersById(tripTravelers);
  const names = pkg.travelers.map((id) => byId.get(id)).filter((n): n is string => Boolean(n));
  return names.length ? names : everyone;
}

function resolveExcursionTravelers(
  tripTravelers: Traveler[],
  travelerIds: string[] | null | undefined,
): string[] | null {
  if (!travelerIds?.length) return null;
  const byId = travelersById(tripTravelers);
  const names = travelerIds.map((id) => byId.get(id)).filter((n): n is string => Boolean(n));
  return names.length ? names : null;
}

export function buildTripView(data: TripData): TripView {
  const { trip, legs, stays, transits, activities, scenarios, notes, routes } = data;
  validateActivityTiming(activities);
  validateRoutes(routes);
  const scenariosById = new Map(scenarios.map((s) => [s._id, s]));
  const routesById = new Map((routes ?? []).map((r) => [r._id, r]));
  const packagesById = new Map(stays.flatMap((s) => s.packages ?? []).map((p) => [p._id, p]));

  const enrichedActivities: EnrichedActivity[] = activities.map((a) => {
    // A meal starting mid-drive is exempt — see DEFAULT_MEAL_DURATION_MINUTES
    // above for why that's normal, not a modeling mistake. A departure
    // scheduled mid-meal still isn't exempt (transitOverlapFor's own note).
    const { transitOverlapWarning, activityOverlapWarning } = overlapWarningsFor(
      a,
      activities,
      transits,
    );
    return {
      ...a,
      date: resolveActivityDate(a),
      notes: notesForEntity(notes, 'activity', a._id),
      hasWarningNote: entityHasWarning(notes, 'activity', a._id),
      transitOverlapWarning,
      activityOverlapWarning,
      travelers: a.mealType
        ? resolveMealTravelers(trip.travelers, a.includedIn, packagesById)
        : resolveExcursionTravelers(trip.travelers, a.travelers),
      options: a.options
        ? a.options.map((o): EnrichedMealOption => ({
            ...o,
            travelers: resolveMealTravelers(trip.travelers, o.includedIn, packagesById),
            notes: notesForEntity(notes, 'mealOption', o._id),
          }))
        : a.options,
    };
  });

  const enrichedStays: EnrichedStay[] = stays.map((s) => ({
    ...s,
    notes: notesForEntity(notes, 'stay', s._id),
    hasWarningNote: entityHasWarning(notes, 'stay', s._id),
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
      notes: notesForEntity(notes, 'transit', t._id),
      hasWarningNote: entityHasWarning(notes, 'transit', t._id),
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
      buildDay(
        date,
        legs,
        legDateRanges,
        enrichedStays,
        routedTransits,
        activitiesByDate,
        scenariosById,
        notes,
      ),
    )
    .filter((d): d is Day => d !== null);

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

  const legSummaries: LegSummary[] = sortedLegs.map((leg) => {
    const { progress, percent } = legBookingSummary(leg, stays, transits, activities);
    return {
      leg,
      dateRange: legDateRanges.get(leg._id) ?? null,
      days: days.filter((d) => d.leg._id === leg._id),
      notes: notesForEntity(notes, 'leg', leg._id),
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

  const activitiesById = new Map(enrichedActivities.map((a) => [a._id, a]));

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
    scenariosById,
    routesById,
    budget,
    bookingProgress,
    bookingPercent,
  };
}
