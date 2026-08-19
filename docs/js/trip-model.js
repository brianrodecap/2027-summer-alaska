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
  const [[trip, legs, stays, transits, activities, scenarios, notes], routes] = await Promise.all([
    Promise.all(files.map((f) => fetch(`${base}${f}.json`).then((r) => r.json()))),
    fetch('data/routes.json').then((r) => r.json()),
  ]);
  return { trip, legs, stays, transits, activities, scenarios, notes, routes };
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

function entityHasWarning(notes, entity, id) {
  return notes.some((n) => n.kind === 'warning' && n.concerns.some((r) => refMatchesEntity(r, entity, [id])));
}

// ---------- filter tags — the token vocabulary the trip page's filter nav
// (docs/js/filters.js) reads to show or hide each Stay/Transit/Activity row.
// Every row always carries at least a leg:<id> token; the booking/attr
// tokens only get added when the entity actually has something to say on
// that axis. filters.js's rowMatches groups tokens by their `prefix:` (OR
// within a group, AND across groups), so this is the entire vocabulary a new
// filter option would need to plug into.

// TODO(you): a Leg can be booked as one bundle — leg_cruise's own `booking`
// covers the whole week — while nearly every Stay/Transit/Activity inside it
// still carries `booking: null` of its own, because nothing about that one
// day was reserved separately. Right now this only ever looks at the
// entity's own booking, so almost everything inside a bundled leg shows as
// neither "Booked" nor "Needs booking" in the filter nav, even though the
// leg itself is fully paid for. Decide whether/how a bundled leg's own
// booking.status should roll down onto a child with no booking of its own —
// `entity` is the Stay/Transit/Activity in question, `leg` is the Leg it
// belongs to (day.leg), with its own optional `booking` — every call site
// below already has both in hand.
//
// This placeholder only ever looks at the entity's own booking, so the
// feature works end to end while you decide the real rule.
function resolveBookingTag(entity, leg) {
  if (entity.booking?.status === 'booked') return 'booking:booked';
  if (entity.booking?.status === 'planning') return 'booking:needs';
  return null;
}

export function filterTagsFor(entity, leg) {
  const tags = [`leg:${leg._id}`];
  const bookingTag = resolveBookingTag(entity, leg);
  if (bookingTag) tags.push(bookingTag);
  if (entity.priority) tags.push('attr:highlight');
  if (entity.hasWarningNote) tags.push('attr:attention');
  return tags;
}

// ---------- building the computed Day view ----------

function stayOverlapsDay(stay, dayStart, dayEnd) {
  return stay.checkInAt < dayEnd && stay.checkOutAt > dayStart;
}

// A Transit renders only on the day it departs — even one that spans
// midnight (e.g. an 11:15pm departure arriving 1:45am the next day) — rather
// than on every calendar date its [departsAt, arrivesAt) span touches. It's
// one trip event with one clock-time to sort by; showing it a second time on
// the arrival day would duplicate it in the timeline for no new information.
function transitDepartsOnDay(transit, date) {
  return dateOnly(transit.departsAt) === date;
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
// anchored to the start of the day. Fuzzy-timed activities (timeLabel only,
// no startAt/endAt) have no real timestamp either, but timeLabel is a closed
// vocabulary (TIME_LABEL_ANCHORS below) rather than free text, so per
// Guiding principle 03 each one gets a real anchor time straight from that
// table — validateActivityTiming (below) enforces every Activity has one of
// startAt, endAt, or a table entry, so there's never a timeLabel left over
// with no anchor to fall back on.

// The only anchors this trip's days actually need — deliberately coarse,
// since a fuzzy label like "Morning" was never claiming more precision than
// this in the first place. Each maps to an HH:MM used only to compute a sort
// key; activityTimeLabel (above) still shows the label text itself, never
// this clock time. "All day" is for a whole-day banner activity (e.g. a
// cruise sea day) that has no time of its own and belongs before the day's
// other, real-timed activities — hence the earliest possible anchor.
const TIME_LABEL_ANCHORS = {
  'All day': '00:00',
  Morning: '09:00',
  Afternoon: '13:00',
  Evening: '20:00',
};

// Every Activity must resolve to a real sort position: startAt, endAt, or a
// timeLabel drawn from TIME_LABEL_ANCHORS above. A timeLabel outside that
// closed vocabulary (a one-off conditional string) doesn't count — it has no
// anchor time of its own. Checked once at load time so a bad entry fails
// loudly here rather than sorting on an undefined key downstream — this is
// what lets activitySortKey (below) always return a real value instead of
// needing its own null-handling fallback.
function validateActivityTiming(activities) {
  const untimed = activities.filter((a) => !a.startAt && !a.endAt && !TIME_LABEL_ANCHORS[a.timeLabel]);
  if (untimed.length) {
    throw new Error(
      `Activity(s) missing startAt, endAt, and a valid timeLabel anchor: ${untimed.map((a) => a._id).join(', ')}`
    );
  }
}

function activitySortKey(activity, dayStart) {
  if (activity.startAt) return activity.startAt;
  if (activity.endAt) return activity.endAt;
  return `${dayStart.slice(0, 10)}T${TIME_LABEL_ANCHORS[activity.timeLabel]}`;
}

function resolveActivityKeys(activities, dayStart) {
  return activities.map((activity) => ({ type: 'activity', activity, key: activitySortKey(activity, dayStart) }));
}

function stayEventKey(stay, relation, dayStart) {
  if (relation === 'Check out') return stay.checkOutAt;
  if (relation === 'Staying') return dayStart;
  return stay.checkInAt; // 'Check in' or 'Overnight' both anchor on arrival
}

function transitSortKey(transit, dayStart) {
  return transit.departsAt < dayStart ? dayStart : transit.departsAt;
}

// A stage carries no timestamp of its own — routes.json's via[] is dateless
// reference geography — but each entry does carry its own durationMinutes
// (the drive time to reach it from whichever via point, or Depart, came
// before), so a stage's place in the day's real chronological order is
// computed by walking that variant's via[] and accumulating those durations
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
function wallClockMs(iso) {
  const [datePart, timePart] = iso.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm);
}

function formatWallClock(ms) {
  const dt = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}`;
}

// Every variant gets its own independent walk — even though only one
// variant's stages are visible at a time (day-render.js's route-variant
// tabs), the hidden one still needs its own correct times ready for when
// it's switched to. inTransitActivities is consumed here as a local queue,
// one via segment's durationMinutes at a time: if an activity's real
// startAt falls inside the segment currently being driven, only the portion
// of the segment up to that point is spent as drive time, the clock then
// jumps to that activity's own real endAt (its actual duration, not an
// estimate), and whatever of the segment's duration is still left keeps
// driving from there — so a lunch stop's real 30 minutes and a segment's
// estimated 45 minutes of driving both actually elapse, instead of one
// silently swallowing the other. Clamped just under arrivesAt so an
// underestimated remainder never sorts a stage after the Transit's own
// Arrive row.
function stageTimesForVariant(variant, transit, inTransitActivities) {
  const arriveMs = wallClockMs(transit.arrivesAt);
  let clockMs = wallClockMs(transit.departsAt);
  const queue = [...inTransitActivities];
  return variant.via.map((v) => {
    let remainingMs = (v.durationMinutes ?? 0) * 60000;
    while (remainingMs > 0) {
      const next = queue[0];
      const nextStartMs = next ? wallClockMs(next.startAt) : null;
      if (next && nextStartMs >= clockMs && nextStartMs <= clockMs + remainingMs) {
        const driveMs = nextStartMs - clockMs;
        remainingMs -= driveMs;
        clockMs = wallClockMs(next.endAt ?? next.startAt);
        queue.shift();
      } else {
        clockMs += remainingMs;
        remainingMs = 0;
      }
    }
    clockMs = Math.min(clockMs, arriveMs - 60000);
    return { label: v.label ?? v.place.label, placeId: v.place?.id ?? null, note: v.note ?? null, kind: v.kind, key: formatWallClock(clockMs) };
  });
}

function routeStageItems(transit) {
  const { variants, selectedTone } = transit.routeInfo;
  return variants.flatMap((variant) =>
    variant.stages.map((stage) => ({
      type: 'transit-stage',
      transit,
      variant,
      stage,
      hidden: variant.tone !== selectedTone,
      key: stage.key,
    }))
  );
}

// A Transit is never one opaque block in the timeline — it expands into a
// "Depart"/"Arrive" boundary pair (still its own rows in the flat sequence,
// not hidden inside the Transit's own block), with any Route's own stages
// (see resolveTransitRoute, below) spread between them — see
// routeStageItems above.
function transitSequenceItems(transit, dayStart) {
  const items = [{ type: 'transit-boundary', transit, phase: 'depart', key: transitSortKey(transit, dayStart) }];
  if (transit.routeInfo) {
    items.push(...routeStageItems(transit));
  }
  items.push({ type: 'transit-boundary', transit, phase: 'arrive', key: transit.arrivesAt });
  return items;
}

// Merge-sorts already-keyed items (key: an ISO timestamp — every item has a
// real one by now, see activitySortKey) into chronological order. A stable
// sort so same-key items (e.g. two activities both anchored to the same
// "Morning" timeLabel) keep their original already-authored order.
function mergeByTime(items) {
  return [...items].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
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

// scenarioAnchorKey (from buildScenarioTracks below) is the earliest real key
// among everything in the day's branching content — passed in here so a
// single { type: 'scenario-tabs' } placeholder can be merge-sorted into the
// backbone at that real chronological position, instead of the tab group
// always trailing every other event on the day regardless of when its own
// content actually falls (see renderDayDetailBody in day-render.js, which
// now just renders whatever lands at that slot rather than special-casing
// the tab group's placement itself).
function buildSequence(dayStays, dayTransits, dayActivities, date, dayStart, scenarioAnchorKey) {
  const items = [
    ...dayStays.map((stay) => {
      const relation = stayRelation(stay, date);
      return { type: 'stay', stay, relation, key: stayEventKey(stay, relation, dayStart) };
    }),
    ...dayTransits
      .filter((t) => !t.scenarioId)
      .flatMap((transit) => transitSequenceItems(transit, dayStart)),
    ...resolveActivityKeys(
      dayActivities.filter((a) => !a.scenarioId),
      dayStart
    ),
  ];
  if (scenarioAnchorKey) items.push({ type: 'scenario-tabs', key: scenarioAnchorKey });
  return collapseActivityRuns(mergeByTime(items));
}

// A track's own scenario can carry `parentScenarioId`, naming another
// scenario present the *same* day it nests under instead of standing as its
// own top-level tab — e.g. Jul 1's "if it flew today" / "if grounded today"
// split only makes sense once you're already inside the alt track's own
// afternoon, so it renders as its own small <md-tabs> inside that track's
// panel (see renderScenarioTabs in day-render.js) rather than as a sibling
// of Jul 1's ideal/alt pair. buildTrack recurses to pick up any such
// children — each nested group gets folded into its PARENT's own sequence as
// a { type: 'scenario-tabs', tracks } placeholder, keyed to the earliest of
// its children's own real times, for exactly the reason scenarioAnchorKey
// (above) exists for the day's outer tab group: without it, the nested tabs
// would always render after every other item in the parent panel regardless
// of when their own content actually falls, the same bug that placeholder
// was built to avoid one level up.
function buildScenarioTracks(dayTransits, dayActivities, scenariosById, notes, dayStart) {
  const present = new Set([
    ...dayTransits.map((t) => t.scenarioId).filter(Boolean),
    ...dayActivities.map((a) => a.scenarioId).filter(Boolean),
  ]);
  let anchorKey = null;

  function trackOwnItems(scenarioId) {
    return [
      ...dayTransits
        .filter((t) => t.scenarioId === scenarioId)
        .flatMap((transit) => transitSequenceItems(transit, dayStart)),
      ...resolveActivityKeys(
        dayActivities.filter((a) => a.scenarioId === scenarioId),
        dayStart
      ),
    ];
  }

  function earliestKey(items) {
    return items.reduce((min, item) => (min === null || item.key < min ? item.key : min), null);
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
  function realOwnKey(scenarioId) {
    const transitKeys = dayTransits.filter((t) => t.scenarioId === scenarioId).map((t) => t.departsAt);
    const activityKeys = dayActivities.filter((a) => a.scenarioId === scenarioId).map((a) => activitySortKey(a, dayStart));
    return earliestKey([...transitKeys, ...activityKeys].map((key) => ({ key })));
  }

  function buildTrack(scenarioId, scenario) {
    const items = trackOwnItems(scenarioId);
    const ownKey = earliestKey(items);
    if (ownKey !== null && (anchorKey === null || ownKey < anchorKey)) anchorKey = ownKey;

    const children = [];
    for (const [childId, childScenario] of scenariosById) {
      if (childScenario.parentScenarioId === scenarioId && present.has(childId)) {
        children.push(buildTrack(childId, childScenario));
      }
    }
    const realAnchorKey = children.length
      ? earliestKey([realOwnKey(scenarioId), ...children.map((c) => c.realAnchorKey)].filter((k) => k !== null).map((key) => ({ key })))
      : realOwnKey(scenarioId);
    const sequenceItems = [...items];
    if (children.length) {
      // A nested placeholder is keyed off a *real* signal wherever one
      // exists in the subtree (e.g. Jul 1's actual 7:30am flight attempt),
      // falling back to the possibly-borrowed per-child anchor only if the
      // whole nested group is genuinely unanchored, and dayStart only if
      // that's unanchored too.
      const childKey = earliestKey(children.map((c) => c.realAnchorKey).filter((k) => k !== null).map((key) => ({ key })))
        ?? earliestKey(children.filter((c) => c.anchorKey !== null).map((c) => ({ key: c.anchorKey })));
      sequenceItems.push({ type: 'scenario-tabs', key: childKey ?? dayStart, tracks: children });
    }
    return {
      scenario,
      notes: notesForScenario(notes, scenarioId),
      sequence: collapseActivityRuns(mergeByTime(sequenceItems)),
      anchorKey: ownKey,
      realAnchorKey,
    };
  }

  const tracks = [];
  for (const [scenarioId, scenario] of scenariosById) {
    if (scenario.parentScenarioId) continue; // picked up as a child, above
    if (!present.has(scenarioId)) continue;
    tracks.push(buildTrack(scenarioId, scenario));
  }
  return { tracks, anchorKey };
}

function truncateSummary(text) {
  return text.length > 140 ? `${text.slice(0, 137)}…` : text;
}

// A branching day's headline event (e.g. flightseeing) only exists on one
// scenario track — the "planned" one, same convention used throughout: ideal
// if present, otherwise whichever track is there.
function idealOrFirstTrack(day) {
  return day.scenarioTracks.find((t) => t.scenario.tone === 'ideal') ?? day.scenarioTracks[0] ?? null;
}

function firstActivityIn(sequence) {
  return sequence.find((i) => i.type === 'section')?.activities[0] ?? null;
}

function deriveSummary(day) {
  const idealTrack = idealOrFirstTrack(day);
  const first = firstActivityIn(day.sequence) ?? (idealTrack && firstActivityIn(idealTrack.sequence));
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

const PRIORITY_RANK = { high: 3, medium: 2, low: 1 };

function sectionActivities(sequence) {
  return sequence.filter((i) => i.type === 'section').flatMap((i) => i.activities);
}

// Pulled from day.sequence (the fixed backbone) plus the planned scenario
// track only — never both branches of a weather split at once, so a
// flightseeing day's title doesn't also drag in its own weathered-out backup.
function titleCandidates(day) {
  const idealTrack = idealOrFirstTrack(day);
  const branching = idealTrack ? sectionActivities(idealTrack.sequence) : [];
  return [...sectionActivities(day.sequence), ...branching].filter((a) => a.priority);
}

function deriveTitle(day) {
  const candidates = titleCandidates(day);
  if (!candidates.length) return day.location;
  const topRank = Math.max(...candidates.map((a) => PRIORITY_RANK[a.priority]));
  return candidates
    .filter((a) => PRIORITY_RANK[a.priority] === topRank)
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
// could type into Maps' own search box, and this trip's places.js Places API
// key is deliberately restricted to Places API calls only, so this avoids
// both a second API to enable and a second key restriction to maintain. ----------

// A Stay's check-in/check-out events are keyed to their own clock time (see
// stayEventKey above) so they sort into day.sequence wherever that falls —
// but rather than let an 11am formal checkout land after a 6:30am departure,
// or a mid-afternoon check-in land ahead of an 8am breakfast, checkout always
// sorts first and check-in always last: each reads as "leaving here"/"staying
// here tonight" context for the day rather than a scheduled event competing
// with the timeline between them. Shared by day-render.js's renderDayDetailBody
// (the visible day list) and dayMapStops below (so the computed map's last
// stop is always tonight's actual lodging, not wherever check-in's raw
// timestamp happened to sort).
export function splitOutStayBoundaries(sequence) {
  const checkOuts = sequence.filter((item) => item.type === 'stay' && item.relation === 'Check out');
  const checkIns = sequence.filter((item) => item.type === 'stay' && item.relation === 'Check in');
  const rest = sequence.filter((item) => !checkOuts.includes(item) && !checkIns.includes(item));
  return { checkOuts, rest, checkIns };
}

// A meal's own place lives on whichever MealOption is still open
// (data-model.html) rather than activity.place. Matching the row's own live
// tab selection needs day-render.js's activeMealOptions (it filters out
// options an earlier Stay checkout already closed off — see
// isIncludedOptionActive) to know which candidate a tab index even refers
// to, and this module deliberately doesn't import day-render.js (which
// already imports from here) to get it — so a caller that resolved the
// selection off the DOM against activeMealOptions itself (app.js) passes
// the *place* it landed on directly, as mealPlaces (activityId -> place or
// null, only for activities the caller actually found a meal row for).
// Anything not in the map — a non-meal activity, or a caller that skipped
// reading DOM state — falls back to the first candidate that names a place,
// same as before this was made selectable.
function resolveActivityPlace(activity, mealPlaces) {
  if (activity.place) return activity.place;
  if (mealPlaces?.has(activity._id)) return mealPlaces.get(activity._id);
  return activity.options?.find((o) => o.place)?.place ?? null;
}

// Same "planned by default" convention deriveSummary/deriveTitle use, but
// overridable by a live scenario-tab selection (scenarioTone) a caller read
// off the DOM — see dayMapStops/dayFullRouteStops below, both of which want
// whichever branch the reader is actually looking at, not always the plan.
function selectedTrack(day, scenarioTone) {
  if (scenarioTone) {
    const track = day.scenarioTracks.find((t) => t.scenario.tone === scenarioTone);
    if (track) return track;
  }
  return idealOrFirstTrack(day);
}

function sequenceMapLabels(sequence, mealPlaces) {
  const labels = [];
  for (const item of sequence) {
    // A 'Staying' item (every night of a multi-night Stay that isn't the
    // actual arrival/departure day) is deliberately excluded even when
    // lodging.name exists — dayFullRouteStops below already only anchors on
    // Check out/Check in boundaries, and a bare lodging name geocoded as
    // free text is exactly the "no canonical id/coords" shape this trip's
    // data model otherwise requires for real-world places (data-model.html's
    // Route entity note). It silently works for a fixed hotel, whose name
    // happens to geocode near itself, but fails hard for a Stay with no
    // fixed point at all — a cruise ship mid-voyage (lodging.placeId: null)
    // — where Google's classic embed resolves the free-text ship name to
    // the cruise line's corporate HQ address instead, plotting a fictional
    // thousands-of-miles driving route on a day that's really just shore
    // excursions. Dropping it here leaves those real, place-id-backed stops
    // as the map's actual start/end.
    if (item.type === 'stay' && item.relation !== 'Staying' && item.stay.lodging?.name) labels.push(item.stay.lodging.name);
    else if (item.type === 'transit-boundary') labels.push((item.phase === 'depart' ? item.transit.from : item.transit.to).label);
    // transit-stage (a route's interim via-points) is deliberately skipped —
    // not a data-quality concern (every via now resolves to a real Place ID
    // or explicit coordinates; see data-model.html's Route entity), but
    // because dayMapEmbedUrl below only ever draws a start→end route: this
    // same keyless embed endpoint mis-plots the trip when fed waypoints via
    // daddr's "+to:" chaining, even when every stop is individually
    // unambiguous — it's the waypoint-chaining mechanism itself that's
    // unreliable, verified by hand against this trip's own routes, not the
    // input data. The resolved place/coordinates are still there on each
    // Route's own via[] (routes.json) if a future page ever needs to plot a
    // stage on its own — stageTimesForVariant above just doesn't carry them
    // through to routeStageItems, since nothing reads them yet.
    else if (item.type === 'section') {
      for (const activity of item.activities) {
        const place = resolveActivityPlace(activity, mealPlaces);
        if (place) labels.push(place.label);
      }
    }
  }
  return labels;
}

// A branching day maps only its planned (ideal, or first) track by default —
// same "planned by default" convention deriveSummary/deriveTitle already
// use — rather than plotting both weather branches' places onto one
// confusing route, unless selections names a live scenario/meal choice to
// follow instead (see selectedTrack/resolveActivityPlace above). selections
// is `{ scenarioTone, mealPlaces }`, both optional — see
// dayFullRouteStops below for the sibling shape routeTones adds.
export function dayMapStops(day, selections = {}) {
  const { checkOuts, rest, checkIns } = splitOutStayBoundaries(day.sequence);
  const track = selectedTrack(day, selections.scenarioTone);
  const all = [
    ...sequenceMapLabels(checkOuts, selections.mealPlaces),
    ...sequenceMapLabels(rest, selections.mealPlaces),
    ...(track ? sequenceMapLabels(track.sequence, selections.mealPlaces) : []),
    ...sequenceMapLabels(checkIns, selections.mealPlaces),
  ];
  // Collapses immediate repeats (e.g. a Transit arriving exactly where the
  // next Activity already is) — a real detour back to an earlier place later
  // in the day still keeps both listings, just not the same stop twice in a row.
  return all.filter((label, i) => label !== all[i - 1]);
}

// Only ever plots the day's first and last stop as a route, never the ones
// between — verified by hand against this trip's own multi-stop days: this
// keyless embed (maps.google.com/maps?...&output=embed, which redirects to
// the un-keyed google.com/maps/embed?origin=mfe&pb=... behind the scenes)
// geocodes a plain two-point origin/destination correctly, but feeding it
// waypoints via daddr's "+to:" chaining silently mis-geocodes one of them
// nowhere near Alaska, once sending the drawn route on a fictional 300-hour
// detour through the Lower 48. A start→end route is still a real, useful
// "where does today go" answer; every stop in between is already right there
// in the day's own timeline.
export function dayMapEmbedUrl(day, selections = {}) {
  const stops = dayMapStops(day, selections);
  if (!stops.length) return null;
  if (stops.length === 1) return `https://maps.google.com/maps?q=${encodeURIComponent(stops[0])}&output=embed`;
  const start = encodeURIComponent(stops[0]);
  const end = encodeURIComponent(stops[stops.length - 1]);
  return `https://maps.google.com/maps?saddr=${start}&daddr=${end}&output=embed`;
}

// ---------- day full-route link — a second, non-embedded map action shown
// alongside dayMapEmbedUrl's iframe (see day-render.js's
// renderDayMapSheetBody). Targets the real Directions URL API
// (https://developers.google.com/maps/documentation/urls/get-started#directions-action)
// instead of the classic keyless embed above: verified by hand that a
// `place_id:<id>` value inline in origin/destination/waypoints — the syntax
// the URL API's older docs imply — doesn't actually resolve; Google Maps
// treats it as literal unmatched search text. The documented, working
// mechanism instead pairs each text stop with a same-position id in a
// separate parameter: origin/origin_place_id, destination/
// destination_place_id, and waypoints/waypoint_place_ids (pipe-separated,
// positionally matched to waypoints — see routeStop/dayFullRouteUrl below).
// This also isn't limited to a start→end pair the way the embed is, so
// route vias and activities can ride along as real waypoints. Can't be
// embedded in an iframe the way the classic endpoint can — Google blocks
// framing the interactive Maps site — so this always opens in a new
// tab instead. ----------

// Google caps this URL at 9 waypoints — a hard ceiling on this URL scheme,
// not a raisable quota (the paid Directions/Routes API allows more, but
// costs a second billed API and a key that can't stay Places-only, the same
// trade-off already rejected for dayMapEmbedUrl above).
const MAX_ROUTE_WAYPOINTS = 9;

// A stop's routable identity: always a label (Directions URL stops are text
// first, an id can only ever supplement one), plus a placeId when one's
// resolved (Activity.place.id, Stay.lodging.placeId, Transit.from/to.placeId)
// — null for the endpoints (a whole city, an unresolved via) that don't have
// one, which still geocode fine by name alone.
function routeStop(placeLike, fallbackLabel) {
  const label = placeLike?.label ?? placeLike?.name ?? fallbackLabel ?? null;
  if (!label) return null;
  return { label, placeId: placeLike?.id ?? placeLike?.placeId ?? null };
}

// Same chronological order as dayMapStops (checkouts, the day's own
// sequence, the planned scenario track, checkins), but every stop keeps its
// place id when it has one and is tagged with which priority tier it
// belongs to — 'boundary' (the day's own Stay checkout/check-in, always
// first/last), 'via' (a Transit's own endpoints or a Route's interim
// stages — physical points on the day's path), or 'activity' (a chosen
// thing to do, ranked by its own priority like deriveTitle above).
// selectRouteWaypoints (below) is what actually uses the tagging.
//
// selections extends the { scenarioTone, mealPlaces } shape dayMapStops
// takes with a third live choice this link also has to honor: routeTones
// (transitId -> tone), overriding which variant's stages count as this
// day's route for a Transit whose picker (day-render.js's
// renderRouteVariantTabs) the reader has actually switched away from the
// model's own default. All three fall back to their own model default
// (routeInfo.selectedTone; idealOrFirstTrack; the first place-bearing
// option) for whatever a caller didn't read off the DOM — see app.js's
// map-button handler, which reads every live tab selection back off the
// day-block's DOM the same way selectedMealOption does for a single meal row.
function dayFullRouteStops(day, selections = {}) {
  const { checkOuts, rest, checkIns } = splitOutStayBoundaries(day.sequence);
  const track = selectedTrack(day, selections.scenarioTone);
  const stops = [];
  const pushStay = (item) => {
    const stop = routeStop(item.stay.lodging);
    if (stop) stops.push({ ...stop, tier: 'boundary', priorityRank: null });
  };
  const pushSequence = (sequence) => {
    for (const item of sequence) {
      if (item.type === 'transit-boundary') {
        const place = item.phase === 'depart' ? item.transit.from : item.transit.to;
        const stop = routeStop(place);
        if (stop) stops.push({ ...stop, tier: 'via', priorityRank: null });
      } else if (item.type === 'transit-stage') {
        // day.sequence carries every route variant's stages (see
        // routeStageItems), each just tagged hidden for the DOM tab toggle —
        // so without this filter a Transit with 2+ variants (e.g. New vs.
        // Old Glenn Highway) would mix both routes' via-points into one
        // link. Prefer whichever tone the reader actually has selected
        // (selections.routeTones); only fall back to routeInfo's own
        // default when the caller didn't pass one (e.g. no DOM to read yet).
        const tone = selections.routeTones?.get(item.transit._id) ?? item.transit.routeInfo.selectedTone;
        if (item.variant.tone !== tone) continue;
        const stop = routeStop({ id: item.stage.placeId, label: item.stage.label });
        if (stop) stops.push({ ...stop, tier: 'via', priorityRank: null });
      } else if (item.type === 'section') {
        for (const activity of item.activities) {
          const place = resolveActivityPlace(activity, selections.mealPlaces);
          const stop = routeStop(place);
          if (stop) stops.push({ ...stop, tier: 'activity', priorityRank: PRIORITY_RANK[activity.priority] ?? 0 });
        }
      }
    }
  };
  checkOuts.forEach(pushStay);
  pushSequence(rest);
  if (track) pushSequence(track.sequence);
  checkIns.forEach(pushStay);
  return stops.filter((stop, i) => i === 0 || stop.label !== stops[i - 1].label);
}

// TODO(you): the actual business decision this feature hinges on. `middle`
// holds every candidate stop between the day's first and last (already in
// real chronological order), each tagged `tier: 'via' | 'activity'` and, for
// activities, a `priorityRank` (0 for untagged, up to 3 for 'high' — see
// PRIORITY_RANK above). Google only allows `maxWaypoints` of them. Decide
// which ones survive, and return them — still in chronological order, still
// capped at maxWaypoints.
//
// This placeholder just keeps whichever stops come first, tier and priority
// ignored, so the feature works end to end while you decide the real rule.
// Some things worth weighing: should every 'via' always outrank every
// 'activity' (a via is a point you're driving past regardless, an activity
// is optional), even one marked high priority? How should two same-tier,
// same-priority stops break a tie? Is losing a stop near the middle of the
// day worse than losing one near either end?
function selectRouteWaypoints(middle, maxWaypoints) {
  return middle.slice(0, maxWaypoints);
}

export function dayFullRouteUrl(day, selections = {}) {
  const stops = dayFullRouteStops(day, selections);
  if (stops.length < 2) return null;
  const origin = stops[0];
  const destination = stops[stops.length - 1];
  // Only a stop with a real placeId is precise enough to spend one of the 9
  // scarce waypoint slots on — a city-level label like "Anchorage" (a
  // Transit's from/to with no placeId, per data-model.html) would burn a
  // slot on an imprecise, ambiguous point competing against vias/activities
  // that resolved to an exact pin. Origin/destination skip this filter —
  // they're essential regardless of whether they resolved to a place id —
  // and pass their id via the separate _place_id parameter instead (see the
  // section header comment above for why it can't just live inline).
  const candidates = stops.slice(1, -1).filter((stop) => stop.placeId);
  const waypoints = selectRouteWaypoints(candidates, MAX_ROUTE_WAYPOINTS);
  const params = new URLSearchParams({ api: '1', origin: origin.label, destination: destination.label, travelmode: 'driving' });
  if (origin.placeId) params.set('origin_place_id', origin.placeId);
  if (destination.placeId) params.set('destination_place_id', destination.placeId);
  if (waypoints.length) {
    params.set('waypoints', waypoints.map((stop) => stop.label).join('|'));
    // Every candidate here already passed the placeId filter above, so this
    // stays positionally 1:1 with waypoints — required, since Google matches
    // the two lists by index rather than by any id embedded in the text.
    params.set('waypoint_place_ids', waypoints.map((stop) => stop.placeId).join('|'));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function buildDay(date, legs, stays, transits, activitiesByDate, scenariosById, notes) {
  const leg = legs.find((l) => l.startDate <= date && date <= l.endDate);
  if (!leg) return null;

  const dayStart = `${date}T00:00`;
  const dayEnd = `${addDaysStr(date, 1)}T00:00`;

  const dayStays = stays.filter((s) => s.legId === leg._id && stayOverlapsDay(s, dayStart, dayEnd));
  const legTransits = transits.filter((t) => t.legId === leg._id);
  const dayTransits = legTransits.filter((t) => transitDepartsOnDay(t, date));
  const dayActivities = (activitiesByDate.get(date) ?? []).filter((a) => a.legId === leg._id);

  // The stay whose checkout is today but check-in wasn't (i.e. only touching
  // this day on the way out) is skipped in favor of wherever the day actually
  // ends up — the incoming stay, or the one already in progress.
  const primaryStay = dayStays.find((s) => !(dateOnly(s.checkOutAt) === date && dateOnly(s.checkInAt) !== date)) ?? dayStays[0] ?? null;
  // Looked up against every one of the leg's Transits, not just dayTransits —
  // an overnight Transit no longer renders on the day it lands (see
  // transitDepartsOnDay), but a day with nothing else to name itself after
  // still needs to know one arrived here.
  const arrivingTransit = legTransits.find((t) => dateOnly(t.arrivesAt) === date);
  const location = primaryStay?.lodging?.name ?? arrivingTransit?.to?.label ?? dayTransits[0]?.from?.label ?? leg.name;

  const stayIds = dayStays.map((s) => s._id);
  const transitIds = dayTransits.map((t) => t._id);

  const { tracks: scenarioTracks, anchorKey: scenarioAnchorKey } = buildScenarioTracks(dayTransits, dayActivities, scenariosById, notes, dayStart);

  const day = {
    date,
    dateLabel: formatDateLabel(date),
    leg,
    location,
    stays: dayStays,
    transits: dayTransits,
    sequence: buildSequence(dayStays, dayTransits, dayActivities, date, dayStart, scenarioAnchorKey),
    scenarioTracks,
    notes: notesForDay(notes, date, stayIds, transitIds),
  };
  day.summary = deriveSummary(day);
  day.title = deriveTitle(day);
  return day;
}

// ---------- Route resolution — Route (docs/data/routes.json) is reference
// data a Transit merely points at via routeId/routeVariant (see
// data-model.html); nothing here is stored back onto the Transit itself.
// A variant's via[] is a real, physically-ordered path — unlike Activity,
// nothing about a via point has (or could have) its own timestamp, so array
// order is the correct and only encoding of "which point comes before
// which"; each entry's own durationMinutes (the drive time from whichever
// via point came before it) is what turns that order into actual estimated
// clock times, in stageTimesForVariant (above). Every entry always resolves
// to a real geo-point (place.id, or coordinates as the fallback — see
// validateRoutes, below) and carries a kind of 'waypoint' or 'override'.
// stages keeps every entry, in that same sequence, reduced to
// label/note/key.
//
// A Route with only one variant ("the only practical route") is never a real
// choice, so resolveTransitRoute still exposes every variant (never just the
// one transit.routeVariant names) — day-render.js's renderRouteVariantTabs is
// what decides whether that's worth a tab group (2+ variants, e.g. the New
// vs. Old Glenn Highway) or nothing at all (1, its stages just render plain).
//
// "In transit" Activities are found by the same legId + falls-within-
// departsAt/arrivesAt test day-render.js's flat sequence already uses to
// place them — not a stored link, since which Activities a drive happens to
// pass is a fact about this trip's timing, not something Route (reusable,
// dateless reference data) should ever point back at.
function inTransitActivities(transit, activities) {
  return activities
    .filter((a) => a.legId === transit.legId && a.scenarioId === transit.scenarioId)
    .filter((a) => a.startAt && a.startAt >= transit.departsAt && a.startAt < transit.arrivesAt)
    .sort((a, b) => (a.startAt < b.startAt ? -1 : 1));
}

// Every via entry must carry a kind of 'waypoint' or 'override' (never a
// bare "you're now on Highway X" placeholder — that belongs in the variant's
// own label), resolve to a real geo-point: place.id, or coordinates only as
// the fallback for the rare point Google's Places index has no entry for —
// never a bare label with neither (see data-model.html's Route entity) —
// and carry a non-negative durationMinutes. This isn't a style rule: this
// trip's data once reused the same whole-highway Place ID as a via on two
// Route documents covering different 100+-mile stretches of the same
// highway, and because a via's place feeds straight into a live
// geocoder/Directions URL (dayMapEmbedUrl, dayFullRouteUrl), that silently
// sent a real "open in Google Maps" link on an 8-hour detour. The
// non-negative durationMinutes check guards a second, subtler way order
// could break: a route is an ordered list — variant.via.map in
// stageTimesForVariant (above) always walks it in that authored order — but
// each stage's own computed key still gets sorted alongside every other
// event in the day by mergeByTime. That sort only ever preserves the via
// list's authored order because a non-negative duration keeps
// stageTimesForVariant's running clock non-decreasing as it walks via[]; a
// negative durationMinutes would make a stage's key land earlier than the
// one before it, and the sort would then actually reorder it out of its
// authored position. Checked once at load time, same reasoning as
// validateActivityTiming above: a bad via should fail loudly here, not
// silently mis-route — or misorder — someone in the field.
const VIA_KINDS = new Set(['waypoint', 'override']);

function validateRoutes(routes) {
  const problems = [];
  for (const route of routes ?? []) {
    for (const variant of route.variants ?? []) {
      for (const via of variant.via ?? []) {
        const where = `${route._id} (${variant.tone}) via ${via.place?.label ?? via.label ?? '?'}`;
        if (!VIA_KINDS.has(via.kind)) problems.push(`${where}: kind must be 'waypoint' or 'override', got ${JSON.stringify(via.kind)}`);
        if (!via.place?.id && !via.coordinates) problems.push(`${where}: no resolvable place.id or coordinates`);
        if (typeof via.durationMinutes !== 'number' || via.durationMinutes < 0) {
          problems.push(`${where}: durationMinutes must be a non-negative number, got ${JSON.stringify(via.durationMinutes)}`);
        }
      }
    }
  }
  if (problems.length) throw new Error(`Invalid Route via entries:\n${problems.join('\n')}`);
}

function resolveTransitRoute(transit, routesById, activities) {
  if (!transit.routeId) return null;
  const route = routesById.get(transit.routeId);
  if (!route) return null;
  const inTransit = inTransitActivities(transit, activities);
  const variants = route.variants.map((v) => ({
    tone: v.tone,
    label: `${v.tone[0].toUpperCase()}${v.tone.slice(1)}`,
    stages: stageTimesForVariant(v, transit, inTransit),
  }));
  if (!variants.length) return null;
  const selectedTone = variants.some((v) => v.tone === transit.routeVariant) ? transit.routeVariant : variants[0].tone;
  return { variants, selectedTone };
}

// ---------- Budget — a computed view over every booking already in the
// model (Leg/Stay/Transit/Activity), sliced by Leg, Day, and Traveler.
// Nothing new is stored: every number below is derived from booking.status/
// cost plus, for the spent/pending split, the same depositPaidAt/
// finalPaymentDueAt pair leg_cruise's own booking already carries (see
// data-model.html) — the only booking on this trip with a real payment
// schedule today, but the rule holds for any future one that gets it too.

function todayDateStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
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
export function bookingBucket(booking, today) {
  if (!booking || booking.status === 'cancelled') return null;
  if (booking.status === 'booked') {
    return booking.finalPaymentDueAt && booking.finalPaymentDueAt > today ? 'pending' : 'spent';
  }
  return booking.cost ? 'estimated' : 'unplanned';
}

function emptyBudgetTotals() {
  return { spent: 0, pending: 0, estimated: 0, unplannedCount: 0, currency: null };
}

function addToBudgetTotals(totals, bucket, cost) {
  if (bucket === 'unplanned') { totals.unplannedCount += 1; return; }
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
function bookingLineItems(legs, stays, transits, activities) {
  const items = [];
  for (const leg of legs) {
    if (leg.booking) items.push({ entity: 'leg', id: leg._id, legId: leg._id, label: leg.name, date: null, booking: leg.booking });
  }
  for (const stay of stays) {
    if (stay.booking) items.push({ entity: 'stay', id: stay._id, legId: stay.legId, label: stay.lodging?.name ?? 'Lodging', date: dateOnly(stay.checkInAt), booking: stay.booking });
  }
  for (const transit of transits) {
    if (transit.booking) items.push({ entity: 'transit', id: transit._id, legId: transit.legId, label: `${transit.from.label} → ${transit.to.label}`, date: dateOnly(transit.departsAt), booking: transit.booking });
  }
  for (const activity of activities) {
    if (activity.booking) items.push({ entity: 'activity', id: activity._id, legId: activity.legId, label: activity.text, date: activity.date, booking: activity.booking });
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
function dedupeMirroredBookings(items) {
  const legConfirmations = new Set(
    items.filter((i) => i.entity === 'leg' && i.booking.confirmationNumber).map((i) => `${i.legId}::${i.booking.confirmationNumber}`)
  );
  return items.filter((i) => i.entity === 'leg' || !legConfirmations.has(`${i.legId}::${i.booking.confirmationNumber}`));
}

function bucketedRows(items, today) {
  const rows = [];
  for (const item of items) {
    const bucket = bookingBucket(item.booking, today);
    if (bucket) rows.push({ ...item, bucket });
  }
  return rows;
}

function totalsFor(rows) {
  const totals = emptyBudgetTotals();
  for (const row of rows) addToBudgetTotals(totals, row.bucket, row.booking.cost);
  return totals;
}

function groupBudgetByLeg(legs, rows) {
  return legs
    .map((leg) => {
      const legRows = rows.filter((r) => r.legId === leg._id);
      return { leg, totals: totalsFor(legRows), rows: legRows };
    })
    .filter((g) => g.rows.length);
}

function groupBudgetByDay(days, rows) {
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
function groupBudgetByTraveler(travelers, rows) {
  const totalsByName = new Map(travelers.map((t) => [t.name, emptyBudgetTotals()]));
  for (const row of rows) {
    if (row.bucket === 'unplanned') continue;
    if (row.booking.passengers?.length) {
      for (const p of row.booking.passengers) {
        if (!totalsByName.has(p.name)) totalsByName.set(p.name, emptyBudgetTotals());
        addToBudgetTotals(totalsByName.get(p.name), row.bucket, p.fare);
      }
    } else {
      const share = travelers.length || 1;
      const cost = { amount: row.booking.cost.amount / share, currency: row.booking.cost.currency };
      for (const t of travelers) addToBudgetTotals(totalsByName.get(t.name), row.bucket, cost);
    }
  }
  return [...totalsByName.entries()].map(([name, totals]) => ({ name, totals }));
}

export function buildBudgetView(trip, legs, days, stays, transits, activities) {
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
//    nothing to flag, so no traveler chips render at all (see day-render.js).
//
// Resolved once here rather than re-derived per render, per Guiding
// principle 03 — the same "derive, don't store" reasoning
// notesForActivity/hasWarningNote (below) already follow. Package.travelers
// holds ids, not names (every other cross-entity pointer on this page links
// by id), so a restricted package's ids are turned back into display names
// here, the one place that translation needs to happen.
function travelersById(tripTravelers) {
  return new Map(tripTravelers.map((t) => [t.id, t.name]));
}

function resolveMealTravelers(tripTravelers, includedIn, packagesById) {
  if (includedIn?.entity !== 'package') return null;
  const everyone = tripTravelers.map((t) => t.name);
  const pkg = packagesById.get(includedIn.id);
  if (!pkg?.travelers?.length) return everyone;
  const byId = travelersById(tripTravelers);
  const names = pkg.travelers.map((id) => byId.get(id)).filter(Boolean);
  return names.length ? names : everyone;
}

function resolveExcursionTravelers(tripTravelers, travelerIds) {
  if (!travelerIds?.length) return null;
  const byId = travelersById(tripTravelers);
  const names = travelerIds.map((id) => byId.get(id)).filter(Boolean);
  return names.length ? names : null;
}

export function buildTripView(data) {
  const { trip, legs, stays, transits, activities, scenarios, notes, routes } = data;
  validateActivityTiming(activities);
  validateRoutes(routes);
  const tripYear = trip.startDate.slice(0, 4);
  const scenariosById = new Map(scenarios.map((s) => [s._id, s]));
  const routesById = new Map((routes ?? []).map((r) => [r._id, r]));
  const packagesById = new Map(stays.flatMap((s) => s.packages ?? []).map((p) => [p._id, p]));

  const enrichedActivities = activities.map((a) => ({
    ...a,
    date: resolveActivityDate(a, tripYear),
    notes: notesForActivity(notes, a._id),
    hasWarningNote: entityHasWarning(notes, 'activity', a._id),
    travelers: a.mealType
      ? resolveMealTravelers(trip.travelers, a.includedIn, packagesById)
      : resolveExcursionTravelers(trip.travelers, a.travelers),
    options: a.options
      ? a.options.map((o) => ({ ...o, travelers: resolveMealTravelers(trip.travelers, o.includedIn, packagesById) }))
      : a.options,
  }));
  const activitiesById = new Map(enrichedActivities.map((a) => [a._id, a]));

  const enrichedStays = stays.map((s) => ({ ...s, hasWarningNote: entityHasWarning(notes, 'stay', s._id) }));
  const routedTransits = transits.map((t) => ({
    ...t,
    routeInfo: resolveTransitRoute(t, routesById, enrichedActivities),
    hasWarningNote: entityHasWarning(notes, 'transit', t._id),
  }));

  const activitiesByDate = new Map();
  for (const a of enrichedActivities) {
    if (!a.date) continue;
    if (!activitiesByDate.has(a.date)) activitiesByDate.set(a.date, []);
    activitiesByDate.get(a.date).push(a);
  }

  const days = dateRangeArray(trip.startDate, trip.endDate)
    .map((date) => buildDay(date, legs, enrichedStays, routedTransits, activitiesByDate, scenariosById, notes))
    .filter(Boolean);

  const legSummaries = legs.map((leg) => ({
    leg,
    days: days.filter((d) => d.leg._id === leg._id),
    notes: notesForLeg(notes, leg._id),
  }));

  const budget = buildBudgetView(trip, legs, days, enrichedStays, routedTransits, enrichedActivities);

  return { trip, days, legSummaries, activitiesById, scenariosById, budget };
}
