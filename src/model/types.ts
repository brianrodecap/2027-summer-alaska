// TypeScript re-expression of docs/data-model.html's schema. The schema itself is not
// redesigned here — every shape below mirrors that document's own field lists exactly.

export type PlanStatus = 'planning' | 'active' | 'completed' | 'cancelled';
export type BookingStatus = 'planning' | 'booked' | 'cancelled';

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
  startDate: string;
  endDate: string;
  status: PlanStatus;
  travelers: Traveler[];
  images: Image[];
}

export interface Leg {
  _id: string;
  tripId: string;
  name: string;
  order: number;
  startDate: string;
  endDate: string;
  status: PlanStatus;
  skeletonAuthority: 'self' | 'operator';
  booking?: Booking | null;
  images: Image[];
}

// A pinned Google Place ID (or null for a named-but-unresolvable point) plus a display
// label. Reused verbatim for Activity.place, Stay.lodging, Route from/to/places[].place,
// and Transit from/to.
export interface Place {
  id: string | null;
  label: string;
  images?: Image[];
}

export interface Lodging {
  placeId: string | null;
  name: string;
  roomType?: string | null;
  roomNumber?: string | null;
  campsite?: string | null;
  checkInInstructions?: string | null;
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
  note: string | null;
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
  note?: string | null;
}

export interface RouteVariant {
  tone: string; // e.g. 'scenic' | 'direct' — a route choice, not a go/no-go branch
  label: string;
  places: RoutePlaceEntry[];
  finalLegMinutes: number;
}

export interface Route {
  _id: string;
  from: Place;
  to: Place;
  variants: RouteVariant[];
  images: Image[];
}

export interface Scenario {
  _id: string;
  legId: string;
  tone: 'ideal' | 'alternate';
  label: string;
  icon: string;
  followsScenarioDate?: string;
  requiresScenarioId?: string[];
  parentScenarioId?: string;
  images: Image[];
}

export type RefEntityKind = 'trip' | 'leg' | 'stay' | 'transit' | 'route' | 'activity' | 'scenario' | 'package';

export type Ref = { entity: RefEntityKind; id: string } | { date: string } | { dateRange: [string, string] };

export type NoteKind = 'warning' | 'footnote' | 'info';

export interface Note {
  _id: string;
  kind: NoteKind;
  text: string;
  concerns: Ref[];
  images: Image[];
}

export type DiningFormat = 'included' | 'package' | 'sit-down' | 'grab-and-go' | 'drivethru' | 'self-catered';

// Candidate shape used only by Activity.options, while a meal choice is genuinely
// undecided — deciding means promoting one candidate's 3 fields onto the Activity itself
// and clearing options back to null; the array never holds decided state.
export interface MealOption {
  diningFormat: DiningFormat;
  place: Place | null;
  includedIn: Ref | null;
  note: string | null;
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
  endAt: string | null;
  timeLabel: TimeLabel | null;
  date: string | null; // set only when startAt and endAt are both null
  order: number | null; // vestigial — nothing reads this
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
}

// ---------- enriched entities, as buildTripView produces them ----------

export interface EnrichedMealOption extends Omit<MealOption, never> {
  travelers: string[] | null; // resolved display names, not ids
}

export interface EnrichedActivity extends Omit<Activity, 'options' | 'travelers'> {
  notes: Note[];
  hasWarningNote: boolean;
  transitOverlapWarning: string | null;
  travelers: string[] | null; // resolved display names, not ids
  options: EnrichedMealOption[] | null;
}

export interface EnrichedStay extends Stay {
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
  days: Day[];
  notes: Note[];
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

export type BudgetEntityKind = 'leg' | 'stay' | 'transit' | 'activity';

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
  days: Day[];
  legSummaries: LegSummary[];
  activitiesById: Map<string, EnrichedActivity>;
  scenariosById: Map<string, Scenario>;
  routesById: Map<string, Route>;
  budget: BudgetView;
}

// ---------- live selections — what a React caller feeds back into resolveTransitRoute /
// dayMapStops / dayFullRouteUrl in place of the model's own authored defaults. Today's
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
