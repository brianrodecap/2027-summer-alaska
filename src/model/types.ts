// TypeScript re-expression of docs/data-model.html's schema. The schema itself is not
// redesigned here — every shape below mirrors that document's own field lists exactly.

import type { DayVisits } from './dayMap';
import type { TimelineEvent } from './timeline';

export type PlanStatus = 'planning' | 'active' | 'completed' | 'cancelled';
export type BookingStatus = 'planning' | 'booked' | 'cancelled';

// Trip and Leg carry no status of their own — it's computed by rolling up
// the booking.status (and Package.status) of every leaf entity underneath
// them (see tripModel.ts's legBookingProgress/tripBookingProgress): 'booked'
// once every leaf with a booking is booked, 'unplanned' when none are,
// 'partial' otherwise. A Leg with its own booking (a whole-leg bundle like a
// cruise fare) is judged on that booking alone, rather than diluted by
// unbooked odds and ends (shore excursions, included meals) underneath it.
export type BookingProgress = 'booked' | 'partial' | 'unplanned';

export interface Image {
  uri: string;
  credit: string | null;
  caption: string | null;
}

export interface Money {
  amount: number;
  currency: string;
}

export interface Passenger {
  name: string;
  fare: Money;
  ticketNumber?: string;
  seat?: string;
}

export interface BookedThrough {
  name: string;
  confirmationNumber: string | null;
}

export interface Booking {
  status: BookingStatus;
  cost: Money | null;
  confirmationNumber: string | null;
  bookedThrough?: string | BookedThrough;
  depositPaidAt?: string;
  finalPaymentDueAt?: string;
  passengers?: Passenger[];
}

export interface Traveler {
  id: string;
  name: string;
  age?: number;
}

export interface Trip {
  _id: string;
  name: string;
  summary?: string | null;
  travelers: Traveler[];
  images: Image[];
}

// A trip's date span isn't authored on Trip itself — it's computed as the
// outer bound of its own Legs (see tripModel.ts's tripDateRange), the same
// "computed, not duplicated" treatment as the Day view. null for a trip
// with no Legs yet.
export interface DateRange {
  startDate: string;
  endDate: string;
}

// No startDate/endDate — a Leg's own date span is computed as the outer
// bound of whichever Stay/Transit/Activity documents carry its _id as their
// legId (tripModel.ts's legDateRange), the same "computed, not duplicated"
// treatment Trip's own span already gets from its Legs. A brand-new Leg with
// nothing attached to it yet simply has no span until its first Stay/
// Transit/Activity is added.
export interface Leg {
  _id: string;
  tripId: string;
  name: string;
  skeletonAuthority: 'self' | 'operator';
  booking?: Booking | null;
  images: Image[];
}

// A pinned Google Place ID (or null for a named-but-unresolvable point) plus a display
// label. Reused verbatim for Activity.place, Stay.lodging, Route places[].place,
// and Transit from/to.
// showWeather/showElevation are opt-in per occurrence, not per physical place — the
// same real-world place named on two different entities (or on Transit's two distinct
// endpoints) can show conditions on one and not the other, so each Place value carries
// its own pair rather than the toggle living once on some shared/canonical place record.
// Only meaningful once id/label actually name a resolvable place — see PlaceConditionsLine.
export interface Place {
  id: string | null;
  label: string;
  images?: Image[];
  showWeather?: boolean;
  showElevation?: boolean;
  // Fallback contact details for a place that hasn't been resolved to a real
  // Google Place id yet (or never will be) — once a real id exists, the
  // Places API lookup is the live source of truth for phone/website (see
  // PlaceDetails.phone/websiteUri in model/places.ts) and
  // these two fields are unnecessary, same "known but not yet resolved" role
  // Ref-less coordinates play elsewhere for a place with no id. `email` has
  // no Places API equivalent at all (Google doesn't expose one), so it's
  // shown from here regardless of whether the place ever gets a real id.
  phone?: string;
  website?: string;
  email?: string;
}

// Route's own from/to endpoints. Resolved against the Places API and
// persisted the same way Place is — RouteEditForm relies on the stored id to
// auto-hydrate each variant's first and final leg's drive time (see
// recomputeVariant) without requiring a re-pick every time the route is
// reopened. Kept as its own type rather than reused Place, though, because a
// route's endpoint is frequently a whole city or highway junction
// ('Anchorage', 'Coldfoot') rather than one specific point — fine as a
// Directions-API duration lookup, but the wrong id to hand to a map/embed
// URL that plots one exact pin (see mapEmbedUrls/routeUrls in
// dayMap.ts, which draw only from Transit.from/to and
// variants[].places[].place, never from a Route's own from/to). This type
// exists so that boundary has to be crossed on purpose.
export interface RouteEndpoint {
  id: string | null;
  label: string;
}

export interface Lodging {
  place: Place;
  roomType?: string | null;
  roomNumber?: string | null;
  campsite?: string | null;
  // cruise-cabin-only extensions
  bedConfiguration?: string;
  deckGroup?: string;
  shipZone?: string;
  // reserved-campsite-only extensions
  partySize?: number;
  equipment?: string;
  vehicleCount?: number;
}

export interface Package {
  _id: string;
  name: string;
  status: BookingStatus;
  cost: Money | null;
  confirmationNumber: string | null;
  benefits: string[] | null;
  travelers: string[] | null; // Trip.travelers[].id; null = whole party
}

export interface Stay {
  _id: string;
  legId: string;
  scenarioId: string | null;
  checkInAt: string;
  checkOutAt: string;
  status: PlanStatus;
  lodging: Lodging | null;
  booking: Booking | null;
  packages?: Package[] | null;
  images: Image[];
}

export type TransitMode = 'drive' | 'flight' | 'ferry' | (string & {});

export interface Transit {
  _id: string;
  legId: string;
  journeyId: string | null;
  scenarioId: string | null;
  status: PlanStatus;
  mode: TransitMode;
  carrier?: string;
  flightNumber?: string;
  from: Place;
  to: Place;
  departsAt: string;
  arrivesAt: string | null; // null whenever routeId is set — never authored for a routed drive
  routeId: string | null;
  routeVariant: string | null;
  // A routed drive's from/to are usually general places (a whole city or
  // park), so maps, directions links and drive totals leave them out unless
  // this is set — e.g. a loop that starts and ends at one specific depot.
  showEndpointsOnMap?: boolean;
  booking: Booking | null;
  images: Image[];
}

export type RoutePlaceKind = 'waypoint' | 'via';

// Calculated drive time/distance for one stretch of a route (from the
// previous place, or Depart, to this one; or, as a variant's finalTravel,
// from the last place to the route's own `to`). Never hand-typed —
// RouteEditForm recomputes it from Google Directions whenever the stop
// sequence or endpoints change; stored only so the timeline can be built
// without an API call. miles is informational only — never fed into any
// time math.
export interface RouteTravel {
  minutes: number;
  miles?: number;
}

export interface RoutePlaceEntry {
  kind: RoutePlaceKind;
  place?: Place;
  coordinates?: { lat: number; lng: number }; // fallback only when place has no resolvable id
  label?: string; // used together with coordinates, when place is absent
  travel: RouteTravel;
  // Authored time spent stopped here — a waypoint only (a via is a
  // pass-through with no stop). Absent = DEFAULT_WAYPOINT_DURATION_MINUTES.
  durationMinutes?: number;
  note?: string | null;
}

export interface RouteVariant {
  tone: string; // e.g. 'scenic' | 'direct' — a route choice, not a go/no-go branch
  label: string;
  places: RoutePlaceEntry[];
  finalTravel: RouteTravel;
}

export interface Route {
  _id: string;
  from: RouteEndpoint;
  to: RouteEndpoint;
  variants: RouteVariant[];
  images: Image[];
}

export interface Scenario {
  _id: string;
  legId: string;
  tone: 'ideal' | 'alternate';
  label: string;
  icon: string;
  // Placement hint for a scenario with no Activity/Transit of its own yet —
  // consulted only while that's true (scenarioGroups.ts),
  // so the day list has somewhere to show its (empty, droppable) tab. Once a
  // real Activity/Transit points its scenarioId here, that content's own
  // date takes over as the real anchor and this is ignored, same as
  // Activity.date is superseded the moment a real startAt exists.
  date?: string;
  // Names a scenario on the day this one narratively follows — resolved
  // dynamically (tripModel.ts's followedScenarioId/resolveScenarioDates)
  // against whatever date that scenario's own content actually lands on, so
  // moving the followed scenario's Activities/Transits to a new date can
  // never leave this reference stale the way a hand-typed calendar date
  // could. Only needed when requiresScenarioId doesn't already name a
  // scenario to follow (an ungated "always follows this day" case, e.g. a
  // relaxed-vs-backup day after a fixed flightseeing day) — a gated
  // scenario's own requiresScenarioId[0] already answers "which day do I
  // follow," so this stays unset there.
  followsScenarioId?: string;
  requiresScenarioId?: string[];
  parentScenarioId?: string;
  images: Image[];
}

export type RefEntityKind =
  | 'trip'
  | 'leg'
  | 'stay'
  | 'transit'
  | 'route'
  | 'activity'
  | 'scenario'
  | 'package'
  | 'mealOption';

export type Ref =
  { entity: RefEntityKind; id: string } | { date: string } | { dateRange: [string, string] };

export type NoteKind = 'warning' | 'footnote' | 'info';

export interface Note {
  _id: string;
  kind: NoteKind;
  text: string;
  concerns: Ref[];
  images: Image[];
}

export type DiningFormat =
  | 'included'
  | 'package'
  | 'included-with-activity'
  | 'included-with-transit'
  | 'sit-down'
  | 'grab-and-go'
  | 'drivethru'
  | 'self-catered';

// Candidate shape used only by Activity.options, while a meal choice is genuinely
// undecided — deciding means promoting one candidate's 3 fields onto the Activity itself
// and clearing options back to null; the array never holds decided state. Still carries
// its own `_id` (a `mealOption` Ref target), since a Note can concern one specific
// candidate rather than the Activity as a whole — see notesForEntity in tripModel.ts.
export interface MealOption {
  _id: string;
  diningFormat: DiningFormat;
  place: Place | null;
  includedIn: Ref | null;
  // Whether this specific candidate's reservation has been made — independent of
  // includedIn: a 'package' option can be fully covered by a paid-up package
  // (includedIn.entity === 'package') while its actual table/time slot is still
  // unreserved. null for options where a reservation isn't a thing (walk-in venues).
  booking: Booking | null;
}

export type TimeLabel =
  | 'All day'
  | 'Sunrise'
  | 'Morning'
  | 'Midday'
  | 'Afternoon'
  | 'Sunset'
  | 'Evening'
  | 'Night'
  | 'Midnight'
  | (string & {});
export type Priority = 'high' | 'medium' | 'low';
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface Activity {
  _id: string;
  legId: string;
  scenarioId: string | null;
  status: PlanStatus;
  startAt: string | null;
  durationMinutes: number | null; // null when unknown/point-in-time; see activityDurationMinutes
  timeLabel: TimeLabel | null;
  date: string | null; // set only when startAt is null
  priority: Priority | null;
  // null when a Place already names the row — see activityHeadline
  // (tripModel.ts), which every reader of this field's display text goes
  // through instead of reading .text directly.
  text: string | null;
  place: Place | null;
  booking: Booking | null;
  mealType: MealType | null;
  diningFormat: DiningFormat | null;
  includedIn: Ref | null;
  options: MealOption[] | null;
  travelers: string[] | null; // Trip.travelers[].id — excursions only
  images: Image[];
}

// Mirrors the Google Routes API's own travelMode enum values this site
// offers a picker for in the day timeline's travel-info footer (see
// TravelModeOverride below and DayTimeline.tsx's TravelInfoControl) —
// TWO_WHEELER (mopeds/scooters) is a real fifth value Google supports, but
// nothing in this trip's data calls for it.
export type TravelMode = 'DRIVE' | 'WALK' | 'BICYCLE' | 'TRANSIT';

// A viewer's non-default travel-mode pick for one day-timeline segment (a
// consecutive pair of rows that each name a real Place) — segmentKey is that
// pair's own composite key (see DayTimeline.tsx's travelFooters pass), not a
// reference to any other entity, so this never appears in a Note.concerns
// Ref the way every other real content entity can. DRIVE is the default
// every segment already falls back to without one of these, so this list
// only ever holds a segment actually set to something else — picking DRIVE
// back removes its entry rather than storing it explicitly (see
// applyTravelModeSelection in editForms.ts).
export interface TravelModeOverride {
  segmentKey: string;
  mode: TravelMode;
}

// ---------- raw, as-loaded data ----------

export interface TripData {
  trip: Trip;
  legs: Leg[];
  stays: Stay[];
  transits: Transit[];
  activities: Activity[];
  scenarios: Scenario[];
  notes: Note[];
  travelModeOverrides: TravelModeOverride[];
  routes: Route[];
}

export interface TripsIndexEntry {
  slug: string;
  trip: Trip;
  legs: Leg[];
  stays: Stay[];
  transits: Transit[];
  activities: Activity[];
}

// ---------- enriched entities, as buildTripView produces them ----------

export interface EnrichedMealOption extends MealOption {
  travelers: string[] | null; // resolved display names, not ids
  notes: Note[]; // this candidate's own notes, not the Activity's — only shown while it's the selected option
}

export interface EnrichedActivity extends Omit<Activity, 'options' | 'travelers'> {
  notes: Note[];
  hasWarningNote: boolean;
  transitOverlapWarning: string | null;
  activityOverlapWarning: string | null;
  travelers: string[] | null; // resolved display names, not ids
  options: EnrichedMealOption[] | null;
}

export interface EnrichedStay extends Stay {
  notes: Note[];
  hasWarningNote: boolean;
}

export interface RouteStage {
  note: string | null;
  kind: RoutePlaceKind;
  key: string;
  place: Place;
}

export interface ResolvedRouteVariant {
  tone: string;
  label: string;
  stages: RouteStage[];
  arrivesAt: string;
}

export interface ResolvedRouteInfo {
  variants: ResolvedRouteVariant[];
  selectedTone: string;
  resolvedArrivesAt: string;
}

export interface EnrichedTransit extends Omit<Transit, 'arrivesAt'> {
  routeInfo: ResolvedRouteInfo | null;
  arrivesAt: string | null; // overridden with the route walk's resolved arrival, when routed
  notes: Note[];
  hasWarningNote: boolean;
}

// ---------- day rows ----------

export type StayRelation = 'Overnight' | 'Check in' | 'Check out' | 'Staying';

// One row per timeline event — the day list's vocabulary. Only two things on
// the list are NOT events: the stay you are in the middle of ("Staying", a
// StayRow with no event) and a scenario box (BoxRow: its tab strip and the
// active branch's own rows). `key` is the row's sort instant (an event row's
// `event.at`), kept on every row because DayMapSidebar and the drag metas
// identify rows by it.
export interface ActivityRow {
  type: 'activity';
  event: TimelineEvent;
  activity: EnrichedActivity;
  key: string;
}

export interface StayRow {
  type: 'stay';
  // Check in / Check out / Overnight rows carry the stay's own boundary event;
  // a stay in progress has none.
  event: TimelineEvent | null;
  stay: EnrichedStay;
  relation: StayRelation;
  key: string;
}

export interface TransitBoundaryRow {
  type: 'transit';
  event: TimelineEvent;
  transit: EnrichedTransit;
  phase: 'depart' | 'arrive';
  key: string;
}

// A stop along the selected route variant.
export interface TransitStageRow {
  type: 'transit';
  event: TimelineEvent;
  transit: EnrichedTransit;
  phase: 'stage';
  stage: RouteStage;
  stageIndex: number; // its position in the variant's stages
  key: string;
}

export type TransitRow = TransitBoundaryRow | TransitStageRow;

export interface BoxRow {
  type: 'box';
  key: string; // the box's anchor
  // Every tab of the box: the active one carries the branch's rows, the others
  // are just chips. A day's top-level box lists all of its groups' tabs; a
  // nested box (inside a track's rows) lists one group's.
  tracks: ScenarioTrack[];
}

export type DayRow = ActivityRow | StayRow | TransitRow | BoxRow;

// One tab of a scenario box on one date.
export interface ScenarioTrack {
  scenario: Scenario;
  notes: Note[];
  // The branch's own rows — empty for an inactive member, whose events aren't
  // in the timeline.
  rows: DayRow[];
  groupKey: string; // the scenario group the track belongs to
  active: boolean; // whether it is the group's active member
  // Every Activity/Transit/Stay id the scenario owns on this date (including
  // a nested group's), so a whole-group drag still moves the inactive
  // alternatives along with the active one even though their rows aren't in
  // `rows`.
  members: { activityIds: string[]; transitIds: string[]; stayIds: string[] };
}

// A calendar day's data-only frame: which leg it belongs to, the stays and
// transits that touch it, and its notes. Built once per trip load
// (buildTripView) — everything about what a day CONTAINS is derived per
// selection by buildLiveDays, which turns a frame into a full Day.
export interface DayFrame {
  date: string;
  dateLabel: string;
  leg: Leg;
  // Every leg whose computed range claims this date (`leg` is the first).
  legIds: string[];
  stays: EnrichedStay[]; // the stays overlapping this date
  transits: EnrichedTransit[]; // the transits departing this date
  notes: Note[];
}

// A day as the reader is looking at it: a frame plus what the reader's current
// selections (scenario picks, route tones, meal choices) make of it — its rows,
// scenario tabs, header and the places its map touches.
export interface Day extends DayFrame {
  location: string;
  // Real Google Place ids for the live weather strip, each answering a
  // different question: sunrise/sunset track wherever the day actually
  // starts/ends (the first and last place with a resolvable id in
  // the day's rows), while the high/low temperature follows the same priority the
  // day's own header title does (a flightseeing day's temperature is the
  // flightseeing spot's, not the hotel's) — falling back to the place
  // `location` was drawn from. null wherever nothing resolves to a real
  // geocodable point.
  sunrisePlaceId: string | null;
  sunsetPlaceId: string | null;
  weatherPlaceId: string | null;
  rows: DayRow[];
  // The day's top-level scenario tabs, flat (what the header and the follow
  // lookups read); the same tracks the day's top-level box row carries.
  scenarioTracks: ScenarioTrack[];
  // The places the day touches, which the map/route/travel queries (dayMap.ts)
  // read instead of walking the rows.
  visits: DayVisits;
  // Each still-open meal's selected diningFormat (the timeline's own
  // formatOverrides), which the rows' live overlap warnings read so they
  // agree with the route walk's timing.
  mealFormats: ReadonlyMap<string, DiningFormat>;
  summary: string;
  title: string;
}

export interface LegSummary {
  leg: Leg;
  // The leg's own computed span (tripModel.ts's legDateRange) — not derived
  // from `days` below, since a boundary date shared with another leg is
  // owned by whichever leg sorts first for day-list/header purposes, but
  // still counts toward every leg touching it here.
  dateRange: DateRange | null;
  days: DayFrame[];
  notes: Note[];
  bookingProgress: BookingProgress;
  bookingPercent: number; // 0-100, see tripModel.ts's legBookingPercent — feeds BookingProgressBar
}

// ---------- budget ----------

export type BudgetBucket = 'spent' | 'pending' | 'estimated' | 'unplanned';

export interface BudgetTotals {
  spent: number;
  pending: number;
  estimated: number;
  unplannedCount: number;
  currency: string | null;
}

export type BudgetEntityKind = 'leg' | 'stay' | 'transit' | 'activity' | 'mealOption' | 'package';

export interface BudgetLineItem {
  entity: BudgetEntityKind;
  id: string;
  legId: string;
  label: string;
  date: string | null;
  booking: Booking;
}

export interface BudgetRow extends BudgetLineItem {
  bucket: BudgetBucket;
}

export interface BudgetLegGroup {
  leg: Leg;
  totals: BudgetTotals;
  rows: BudgetRow[];
}

export interface BudgetDayGroup {
  day: DayFrame;
  totals: BudgetTotals;
  rows: BudgetRow[];
}

export interface BudgetTravelerGroup {
  name: string;
  totals: BudgetTotals;
}

export interface BudgetView {
  today: string;
  totals: BudgetTotals;
  byLeg: BudgetLegGroup[];
  byDay: BudgetDayGroup[];
  byTraveler: BudgetTravelerGroup[];
}

// ---------- the computed trip view ----------

export interface TripView {
  trip: Trip;
  dateRange: DateRange | null;
  days: DayFrame[];
  legSummaries: LegSummary[];
  activitiesById: Map<string, EnrichedActivity>;
  staysById: Map<string, EnrichedStay>;
  transitsById: Map<string, EnrichedTransit>;
  scenariosById: Map<string, Scenario>;
  scenarioNotes: Map<string, Note[]>; // notes concerning each scenario, by scenario id
  routesById: Map<string, Route>;
  budget: BudgetView;
  bookingProgress: BookingProgress;
  bookingPercent: number;
}

// ---------- live selections — what a React caller feeds back into resolveTransitRoute
// in place of the model's own authored defaults. Today's vanilla-JS app read this off
// rendered DOM tab state; in the React app this is real state (TripSelectionsContext)
// passed in as plain arguments instead (see buildLiveDays for the scenario/route/meal
// picks that shape a whole day). ----------

export interface LiveRouteOverrides {
  formatOverrides?: ReadonlyMap<string, DiningFormat>;
  routeVariant?: string;
}
