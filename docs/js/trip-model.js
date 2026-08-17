// Loads a trip's raw entity collections (docs/data/<slug>/*.json — see
// docs/data/data-model.html for the schema) and derives the one thing the
// model deliberately never stores: "what's happening on a given date." Nothing
// here is content — the itinerary itself lives entirely in the JSON.
//
// All dates/timestamps are compared as plain ISO strings ('YYYY-MM-DD' /
// 'YYYY-MM-DDTHH:MM'), never parsed into local-timezone Date objects — the
// zero-padded format sorts and compares correctly as strings, which sidesteps
// timezone drift entirely for a site with no timezone-sensitive behavior.

export async function loadTripData(slug) {
  const base = `data/${slug}/`;
  const files = ['trip', 'legs', 'stays', 'transits', 'activities', 'scenarios', 'notes'];
  const [trip, legs, stays, transits, activities, scenarios, notes] = await Promise.all(
    files.map((f) => fetch(`${base}${f}.json`).then((r) => r.json()))
  );
  return { trip, legs, stays, transits, activities, scenarios, notes };
}

// docs/data/trips.json lists only trip slugs (the folder names under
// docs/data/); everything displayed about a trip — name, dates, status — is
// read from that trip's own trip.json, never duplicated into the index.
export async function loadTripsIndex() {
  const manifest = await fetch('data/trips.json').then((r) => r.json());
  return Promise.all(
    manifest.map(({ slug }) =>
      fetch(`data/${slug}/trip.json`).then((r) => r.json()).then((trip) => ({ slug, trip }))
    )
  );
}

// ---------- date/time formatting ----------

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function dateOnly(iso) {
  return iso.slice(0, 10);
}

function addDaysStr(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function dateRangeArray(start, end) {
  const out = [];
  for (let cur = start; cur <= end; cur = addDaysStr(cur, 1)) out.push(cur);
  return out;
}

export function formatDateLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[weekday]} ${MONTHS[m - 1]} ${d}`;
}

function formatFullDate(dateStr) {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${FULL_MONTHS[m - 1]} ${d}`;
}

export function formatTripDateChip(trip, dayCount) {
  return `${formatFullDate(trip.startDate)} – ${formatFullDate(trip.endDate)}, ${trip.endDate.slice(0, 4)} · ${dayCount} days`;
}

// Lets the trips list show a day count from trip.json alone (start/end date),
// without fetching and building that trip's full day-by-day view.
export function tripDayCount(trip) {
  return dateRangeArray(trip.startDate, trip.endDate).length;
}

export function formatTime(iso) {
  let [h, m] = iso.slice(11, 16).split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')}${ampm}`;
}

export function formatMoney(cost) {
  if (!cost) return null;
  return cost.amount.toLocaleString('en-US', { style: 'currency', currency: cost.currency });
}

export function activityTimeLabel(activity) {
  if (activity.startAt) return formatTime(activity.startAt) + (activity.endAt ? `–${formatTime(activity.endAt)}` : '');
  if (activity.endAt) return `By ${formatTime(activity.endAt)}`;
  if (activity.timeLabel) return activity.timeLabel;
  return 'Time TBD';
}

// ---------- Activity's date is usually startAt/endAt, but a handful of
// single-item days (e.g. act_jul7_1) were migrated with neither — the old
// per-day file structure implied the date positionally, and Activity has no
// date field to carry that forward. As a last resort, read it out of the
// activity's own _id (e.g. "act_jul7_1" -> 2027-07-07): the id is stored data,
// even though it's meant as an opaque key rather than a date field. ----------

const ID_DATE_RE = /^act_(jun|jul)(\d{1,2})(?:_|$)/;
const MONTH_NUM = { jun: '06', jul: '07' };

function resolveActivityDate(activity, tripYear) {
  if (activity.startAt) return dateOnly(activity.startAt);
  if (activity.endAt) return dateOnly(activity.endAt);
  const m = ID_DATE_RE.exec(activity._id);
  if (!m) return null;
  return `${tripYear}-${MONTH_NUM[m[1]]}-${m[2].padStart(2, '0')}`;
}

// ---------- Note.concerns matching — see docs/data/data-model.html's Ref type.
// Notes are bucketed to exactly one drill-down level by which kind of ref they
// carry: entity:leg -> the Leg dialog, date/dateRange/entity:stay/entity:transit
// -> that day's inline notes, entity:scenario -> once at the top of that
// scenario's own tab panel, entity:activity -> that activity's side sheet. A
// note with several refs (e.g. one leg ref plus a dateRange) naturally
// surfaces at more than one level. ----------

function refMatchesDate(ref, date) {
  if (ref.date) return ref.date === date;
  if (ref.dateRange) return date >= ref.dateRange[0] && date <= ref.dateRange[1];
  return false;
}

function refMatchesEntity(ref, entity, ids) {
  return ref.entity === entity && ids.includes(ref.id);
}

function notesForLeg(notes, legId) {
  return notes.filter((n) => n.concerns.some((r) => refMatchesEntity(r, 'leg', [legId])));
}

function notesForDay(notes, date, stayIds, transitIds) {
  return notes.filter((n) =>
    n.concerns.some((r) => refMatchesDate(r, date) || refMatchesEntity(r, 'stay', stayIds) || refMatchesEntity(r, 'transit', transitIds))
  );
}

function notesForScenario(notes, scenarioId) {
  return notes.filter((n) => n.concerns.some((r) => refMatchesEntity(r, 'scenario', [scenarioId])));
}

function notesForActivity(notes, activityId) {
  return notes.filter((n) => n.concerns.some((r) => refMatchesEntity(r, 'activity', [activityId])));
}

// ---------- building the computed Day view ----------

function stayOverlapsDay(stay, dayStart, dayEnd) {
  return stay.checkInAt < dayEnd && stay.checkOutAt > dayStart;
}

function transitOverlapsDay(transit, dayStart, dayEnd) {
  return transit.departsAt < dayEnd && transit.arrivesAt > dayStart;
}

// Which of today's two boundary events (if either) this Stay is part of.
// Exported because both the timeline sort below and day-render.js's label
// text need the same classification.
export function stayRelation(stay, date) {
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
// from a timestamp when one exists" — see docs/data/data-model.html), both
// day.sequence and each scenario track merge-sort their Stay check-in/
// check-out events, Transits, and Activities by real timestamp, then
// re-collapse consecutive Activities into one <md-list>-worthy section.
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
// anchored to the start of the day. Fuzzy-timed activities (timeLabel/order
// only, no startAt/endAt) have no timestamp either; they sort after every
// timed item, in their own already-authored order.

function activitySortKey(activity) {
  return activity.startAt ?? activity.endAt ?? null;
}

function stayEventKey(stay, relation, dayStart) {
  if (relation === 'Check out') return stay.checkOutAt;
  if (relation === 'Staying') return dayStart;
  return stay.checkInAt; // 'Check in' or 'Overnight' both anchor on arrival
}

function transitSortKey(transit, dayStart) {
  return transit.departsAt < dayStart ? dayStart : transit.departsAt;
}

// Merge-sorts already-keyed items (key: an ISO timestamp, or null for an
// untimed item) into real chronological order, untimed items trailing in
// their own already-authored order.
function mergeByTime(items) {
  const timed = items.filter((i) => i.key !== null);
  const untimed = items.filter((i) => i.key === null);
  timed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return [...timed, ...untimed];
}

// Collapses consecutive { type: 'activity' } items into one
// { type: 'section', activities } block — a Stay/Transit event in between
// breaks the run — so the renderer can group them under one <md-list>
// without re-deriving that grouping itself.
function collapseActivityRuns(ordered) {
  const sequence = [];
  let run = null;
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

function buildSequence(dayStays, dayTransits, dayActivities, date, dayStart) {
  const items = [
    ...dayStays.map((stay) => {
      const relation = stayRelation(stay, date);
      return { type: 'stay', stay, relation, key: stayEventKey(stay, relation, dayStart) };
    }),
    ...dayTransits
      .filter((t) => !t.scenarioId)
      .map((transit) => ({ type: 'transit', transit, key: transitSortKey(transit, dayStart) })),
    ...dayActivities
      .filter((a) => !a.scenarioId)
      .map((activity) => ({ type: 'activity', activity, key: activitySortKey(activity) })),
  ];
  return collapseActivityRuns(mergeByTime(items));
}

function buildScenarioTracks(dayTransits, dayActivities, scenariosById, notes, dayStart) {
  const present = new Set([
    ...dayTransits.map((t) => t.scenarioId).filter(Boolean),
    ...dayActivities.map((a) => a.scenarioId).filter(Boolean),
  ]);
  const tracks = [];
  for (const [scenarioId, scenario] of scenariosById) {
    if (!present.has(scenarioId)) continue;
    const items = [
      ...dayTransits
        .filter((t) => t.scenarioId === scenarioId)
        .map((transit) => ({ type: 'transit', transit, key: transitSortKey(transit, dayStart) })),
      ...dayActivities
        .filter((a) => a.scenarioId === scenarioId)
        .map((activity) => ({ type: 'activity', activity, key: activitySortKey(activity) })),
    ];
    tracks.push({
      scenario,
      notes: notesForScenario(notes, scenarioId),
      sequence: collapseActivityRuns(mergeByTime(items)),
    });
  }
  return tracks;
}

function truncateSummary(text) {
  return text.length > 140 ? `${text.slice(0, 137)}…` : text;
}

function firstActivityIn(sequence) {
  return sequence.find((i) => i.type === 'section')?.activities[0] ?? null;
}

function deriveSummary(day) {
  const idealTrack = day.scenarioTracks.find((t) => t.scenario.tone === 'ideal') ?? day.scenarioTracks[0];
  const first = firstActivityIn(day.sequence) ?? (idealTrack && firstActivityIn(idealTrack.sequence));
  if (first) return truncateSummary(first.text);
  if (day.stays[0]) return `Staying at ${day.stays[0].lodging?.name ?? day.location}`;
  return day.location;
}

function buildDay(date, legs, stays, transits, activitiesByDate, scenariosById, notes) {
  const leg = legs.find((l) => l.startDate <= date && date <= l.endDate);
  if (!leg) return null;

  const dayStart = `${date}T00:00`;
  const dayEnd = `${addDaysStr(date, 1)}T00:00`;

  const dayStays = stays.filter((s) => s.legId === leg._id && stayOverlapsDay(s, dayStart, dayEnd));
  const dayTransits = transits.filter((t) => t.legId === leg._id && transitOverlapsDay(t, dayStart, dayEnd));
  const dayActivities = (activitiesByDate.get(date) ?? []).filter((a) => a.legId === leg._id);

  // The stay whose checkout is today but check-in wasn't (i.e. only touching
  // this day on the way out) is skipped in favor of wherever the day actually
  // ends up — the incoming stay, or the one already in progress.
  const primaryStay = dayStays.find((s) => !(dateOnly(s.checkOutAt) === date && dateOnly(s.checkInAt) !== date)) ?? dayStays[0] ?? null;
  const arrivingTransit = dayTransits.find((t) => dateOnly(t.arrivesAt) === date);
  const location = primaryStay?.lodging?.name ?? arrivingTransit?.to?.label ?? dayTransits[0]?.from?.label ?? leg.name;

  const stayIds = dayStays.map((s) => s._id);
  const transitIds = dayTransits.map((t) => t._id);

  const day = {
    date,
    dateLabel: formatDateLabel(date),
    leg,
    location,
    stays: dayStays,
    transits: dayTransits,
    sequence: buildSequence(dayStays, dayTransits, dayActivities, date, dayStart),
    scenarioTracks: buildScenarioTracks(dayTransits, dayActivities, scenariosById, notes, dayStart),
    notes: notesForDay(notes, date, stayIds, transitIds),
  };
  day.summary = deriveSummary(day);
  return day;
}

export function deriveRouteStops(days) {
  const stops = [];
  for (const day of days) {
    if (stops[stops.length - 1] !== day.location) stops.push(day.location);
  }
  return stops;
}

export function buildTripView(data) {
  const { trip, legs, stays, transits, activities, scenarios, notes } = data;
  const tripYear = trip.startDate.slice(0, 4);
  const scenariosById = new Map(scenarios.map((s) => [s._id, s]));

  const enrichedActivities = activities.map((a) => ({
    ...a,
    date: resolveActivityDate(a, tripYear),
    notes: notesForActivity(notes, a._id),
  }));
  const activitiesById = new Map(enrichedActivities.map((a) => [a._id, a]));

  const activitiesByDate = new Map();
  for (const a of enrichedActivities) {
    if (!a.date) continue;
    if (!activitiesByDate.has(a.date)) activitiesByDate.set(a.date, []);
    activitiesByDate.get(a.date).push(a);
  }

  const days = dateRangeArray(trip.startDate, trip.endDate)
    .map((date) => buildDay(date, legs, stays, transits, activitiesByDate, scenariosById, notes))
    .filter(Boolean);

  const legSummaries = legs.map((leg) => ({
    leg,
    days: days.filter((d) => d.leg._id === leg._id),
    notes: notesForLeg(notes, leg._id),
  }));

  return { trip, days, legSummaries, activitiesById, scenariosById };
}
