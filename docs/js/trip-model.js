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
    return { label: v.label ?? v.place.label, placeId: v.place?.id ?? null, note: v.note ?? null, key: formatWallClock(clockMs) };
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
      .flatMap((transit) => transitSequenceItems(transit, dayStart)),
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
        .flatMap((transit) => transitSequenceItems(transit, dayStart)),
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

function sequenceMapLabels(sequence) {
  const labels = [];
  for (const item of sequence) {
    if (item.type === 'stay' && item.stay.lodging?.name) labels.push(item.stay.lodging.name);
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
        // A meal's own place lives on whichever MealOption is still open
        // (data-model.html) rather than activity.place — the first candidate
        // that names one is close enough for a route waypoint; matching the
        // row's own live tab selection would need day-render.js's
        // activeMealOptions, which this module deliberately doesn't import.
        const place = activity.place ?? activity.options?.find((o) => o.place)?.place ?? null;
        if (place) labels.push(place.label);
      }
    }
  }
  return labels;
}

// A branching day maps only its planned (ideal, or first) track — same
// "planned by default" convention deriveSummary/deriveTitle already use —
// rather than plotting both weather branches' places onto one confusing route.
export function dayMapStops(day) {
  const { checkOuts, rest, checkIns } = splitOutStayBoundaries(day.sequence);
  const track = idealOrFirstTrack(day);
  const all = [
    ...sequenceMapLabels(checkOuts),
    ...sequenceMapLabels(rest),
    ...(track ? sequenceMapLabels(track.sequence) : []),
    ...sequenceMapLabels(checkIns),
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
export function dayMapEmbedUrl(day) {
  const stops = dayMapStops(day);
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
function dayFullRouteStops(day) {
  const { checkOuts, rest, checkIns } = splitOutStayBoundaries(day.sequence);
  const track = idealOrFirstTrack(day);
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
        const stop = routeStop({ id: item.stage.placeId, label: item.stage.label });
        if (stop) stops.push({ ...stop, tier: 'via', priorityRank: null });
      } else if (item.type === 'section') {
        for (const activity of item.activities) {
          const place = activity.place ?? activity.options?.find((o) => o.place)?.place ?? null;
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

export function dayFullRouteUrl(day) {
  const stops = dayFullRouteStops(day);
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
  day.title = deriveTitle(day);
  return day;
}

// ---------- Route resolution — Route (docs/data/routes.json) is reference
// data a Transit merely points at via routeId/routeVariant (see
// data-model.html); nothing here is stored back onto the Transit itself.
// A variant's via[] mixes named road segments ({ label }) and named place
// stops ({ place: { label } }), in whatever order they're actually crossed —
// every entry always carries one or the other, plus its own durationMinutes
// (the drive time from whichever via point came before it). stages keeps
// every entry, in that same sequence, reduced to label/note/key —
// stageTimesForVariant (above) is what turns durationMinutes into that key.
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

export function deriveRouteStops(days) {
  const stops = [];
  for (const day of days) {
    if (stops[stops.length - 1] !== day.location) stops.push(day.location);
  }
  return stops;
}

export function buildTripView(data) {
  const { trip, legs, stays, transits, activities, scenarios, notes, routes } = data;
  const tripYear = trip.startDate.slice(0, 4);
  const scenariosById = new Map(scenarios.map((s) => [s._id, s]));
  const routesById = new Map((routes ?? []).map((r) => [r._id, r]));

  const enrichedActivities = activities.map((a) => ({
    ...a,
    date: resolveActivityDate(a, tripYear),
    notes: notesForActivity(notes, a._id),
  }));
  const activitiesById = new Map(enrichedActivities.map((a) => [a._id, a]));

  const routedTransits = transits.map((t) => ({ ...t, routeInfo: resolveTransitRoute(t, routesById, enrichedActivities) }));

  const activitiesByDate = new Map();
  for (const a of enrichedActivities) {
    if (!a.date) continue;
    if (!activitiesByDate.has(a.date)) activitiesByDate.set(a.date, []);
    activitiesByDate.get(a.date).push(a);
  }

  const days = dateRangeArray(trip.startDate, trip.endDate)
    .map((date) => buildDay(date, legs, stays, routedTransits, activitiesByDate, scenariosById, notes))
    .filter(Boolean);

  const legSummaries = legs.map((leg) => ({
    leg,
    days: days.filter((d) => d.leg._id === leg._id),
    notes: notesForLeg(notes, leg._id),
  }));

  return { trip, days, legSummaries, activitiesById, scenariosById };
}
