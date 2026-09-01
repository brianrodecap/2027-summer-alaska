// TypeScript re-expression of docs/data-model.html's schema. The schema itself is not
// redesigned here — every shape below mirrors that document's own field lists exactly.

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
export interface Place {
  id: string | null;
  label: string;
  images?: Image[];
}

// Route's own from/to endpoints. Resolved against the Places API and
// persisted the same way Place is — RouteEditForm relies on the stored id to
// auto-hydrate each variant's first and final leg's drive time (see
// recomputeVariant) without requiring a re-pick every time the route is
// reopened. Kept as its own type rather than reused Place, though, because a
// route's endpoint is frequently a whole city or highway junction
// ('Anchorage', 'Coldfoot') rather than one specific point — fine as a
// Directions-API duration lookup, but the wrong id to hand to a map/embed
// URL that plots one exact pin (see dayMapEmbedUrl/dayFullRouteUrls in
// tripModel.ts, which draw only from Transit.from/to and
// variants[].places[].place, never from a Route's own from/to). This type
// exists so that boundary has to be crossed on purpose.
export interface RouteEndpoint {
  id: string | null;
  label: string;
}

export interface Lodging {
  placeId: string | null;
  name: string;
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
  booking: Booking | null;
  images: Image[];
}

export type RoutePlaceKind = 'waypoint' | 'via';

export interface RoutePlaceEntry {
  kind: RoutePlaceKind;
  place?: Place;
  coordinates?: { lat: number; lng: number }; // fallback only when place has no resolvable id
  label?: string; // used together with coordinates, when place is absent
  durationMinutes: number;
  distanceMiles?: number; // informational only — never fed into any time math
  note?: string | null;
}

export interface RouteVariant {
  tone: string; // e.g. 'scenic' | 'direct' — a route choice, not a go/no-go branch
  label: string;
  places: RoutePlaceEntry[];
  finalLegMinutes: number;
  finalLegMiles?: number; // informational only — never fed into any time math
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
  // consulted only while that's true (buildScenarioTracks in tripModel.ts),
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

export type TimeLabel = 'All day' | 'Morning' | 'Afternoon' | 'Evening' | (string & {});
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
  text: string;
  place: Place | null;
  booking: Booking | null;
  mealType: MealType | null;
  diningFormat: DiningFormat | null;
  includedIn: Ref | null;
  options: MealOption[] | null;
  travelers: string[] | null; // Trip.travelers[].id — excursions only
  images: Image[];
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
  label: string;
  placeId: string | null;
  note: string | null;
  kind: RoutePlaceKind;
  key: string;
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

// ---------- day.sequence ----------

export type StayRelation = 'Overnight' | 'Check in' | 'Check out' | 'Staying';

export interface StaySequenceItem {
  type: 'stay';
  stay: EnrichedStay;
  relation: StayRelation;
  key: string;
}

export interface TransitBoundarySequenceItem {
  type: 'transit-boundary';
  transit: EnrichedTransit;
  phase: 'depart' | 'arrive';
  key: string;
}

export interface TransitStageSequenceItem {
  type: 'transit-stage';
  transit: EnrichedTransit;
  variant: ResolvedRouteVariant;
  stage: RouteStage;
  hidden: boolean;
  key: string;
}

export interface SectionSequenceItem {
  type: 'section';
  activities: EnrichedActivity[];
}

export interface ScenarioTabsSequenceItem {
  type: 'scenario-tabs';
  key: string;
  tracks?: ScenarioTrack[];
}

export type SequenceItem =
  | StaySequenceItem
  | TransitBoundarySequenceItem
  | TransitStageSequenceItem
  | SectionSequenceItem
  | ScenarioTabsSequenceItem;

export interface ScenarioTrack {
  scenario: Scenario;
  notes: Note[];
  sequence: SequenceItem[];
  anchorKey: string | null;
  realAnchorKey: string | null;
}

export interface Day {
  date: string;
  dateLabel: string;
  leg: Leg;
  location: string;
  // Real Google Place ids for the live weather strip — resolved once here
  // rather than in the component, since each answers a different question:
  // sunrise/sunset track wherever the day actually starts/ends (the first
  // and last place with a resolvable id in `sequence`'s own chronological
  // order — typically the morning's checkout Stay and the evening's
  // check-in Stay), while the high/low temperature follows the same
  // priority the day's own header title does (deriveTitle's priority
  // Activity, e.g. a flightseeing day's temperature is the flightseeing
  // spot's, not the hotel's) — falling back to the same place `location`'s
  // label was drawn from when no priority Activity claims the day. null
  // wherever nothing in that day resolves to a real geocodable point.
  sunrisePlaceId: string | null;
  sunsetPlaceId: string | null;
  weatherPlaceId: string | null;
  stays: EnrichedStay[];
  transits: EnrichedTransit[];
  sequence: SequenceItem[];
  scenarioTracks: ScenarioTrack[];
  notes: Note[];
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
  days: Day[];
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

export type BudgetEntityKind = 'leg' | 'stay' | 'transit' | 'activity' | 'mealOption';

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
  day: Day;
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
  days: Day[];
  legSummaries: LegSummary[];
  activitiesById: Map<string, EnrichedActivity>;
  scenariosById: Map<string, Scenario>;
  routesById: Map<string, Route>;
  budget: BudgetView;
  bookingProgress: BookingProgress;
  bookingPercent: number;
}

// ---------- live selections — what a React caller feeds back into resolveTransitRoute /
// dayMapStops / dayFullRouteUrls in place of the model's own authored defaults. Today's
// vanilla-JS app read this off rendered DOM tab state; in the React app this is real state
// (TripSelectionsContext) passed in as plain arguments instead. ----------

export interface LiveRouteOverrides {
  formatOverrides?: Map<string, DiningFormat>;
  routeVariant?: string;
}

export interface DaySelections {
  scenarioTone?: string;
  mealPlaces?: Map<string, Place | null>;
  routeTones?: Map<string, string>;
}
