// Form-state shapes and pure apply functions for the edit dialog — a direct
// port of edit.js's per-kind read/apply logic, adapted to read a plain form
// object instead of a DOM formEl. Each applyXyzEdit function mutates the
// entity passed in (the caller passes a clone — see EditContext) and
// returns null on success or a message to show inline, exactly like the
// original.
import {
  type BookingFormValue,
  bookingFormValueFrom,
  readBookingFormValue,
} from '../components/edit/bookingFormValue';
import { transitRouteLabel } from './tripModel';
import type {
  Activity,
  DiningFormat,
  Leg,
  MealOption,
  MealType,
  Place,
  PlanStatus,
  Priority,
  Ref,
  Route,
  Scenario,
  Stay,
  TimeLabel,
  Transit,
  Trip,
} from './types';

// ---------- blank entities, for the day list's own "Add" button ----------
//
// Each starts with just enough filled in to place it on the day it was
// added from (legId, plus a same-day date/time default) — every other field
// is left at its "nothing decided yet" value, same as an author would leave
// it blank in the JSON. The edit dialog's own validation (applyActivityForm
// et al.) is what forces a real time to be entered before Save.

export function blankActivity(legId: string, date: string): Activity {
  return {
    _id: crypto.randomUUID(),
    legId,
    scenarioId: null,
    status: 'planning',
    startAt: null,
    durationMinutes: null,
    timeLabel: null,
    date,
    order: null,
    priority: null,
    text: '',
    place: null,
    booking: null,
    mealType: null,
    diningFormat: null,
    includedIn: null,
    options: null,
    travelers: null,
    images: [],
  };
}

export function blankStay(legId: string, date: string): Stay {
  return {
    _id: crypto.randomUUID(),
    legId,
    checkInAt: `${date}T15:00`,
    checkOutAt: `${date}T15:00`,
    status: 'planning',
    lodging: { placeId: null, name: '' },
    booking: null,
    packages: null,
    images: [],
  };
}

export function blankTransit(legId: string, date: string): Transit {
  return {
    _id: crypto.randomUUID(),
    legId,
    journeyId: null,
    scenarioId: null,
    status: 'planning',
    mode: 'drive',
    from: { id: null, label: '' },
    to: { id: null, label: '' },
    departsAt: `${date}T09:00`,
    arrivesAt: null,
    routeId: null,
    routeVariant: null,
    booking: null,
    images: [],
  };
}

// ---------- kind→collection dispatch, shared by EditContext, EditDialog,
// and ImportDocumentDialog rather than each re-deriving it ----------

export type EditKind = 'activity' | 'stay' | 'transit';

export const COLLECTION_FOR_KIND: Record<EditKind, 'activities' | 'stays' | 'transits'> = {
  activity: 'activities',
  stay: 'stays',
  transit: 'transits',
};

export function findByKind<
  T extends { activities: Activity[]; stays: Stay[]; transits: Transit[] },
>(kind: EditKind, id: string, data: T): Activity | Stay | Transit | undefined {
  return (data[COLLECTION_FOR_KIND[kind]] as (Activity | Stay | Transit)[]).find(
    (e) => e._id === id,
  );
}

export function entityLabel(kind: EditKind, entity: Activity | Stay | Transit): string {
  if (kind === 'stay') return (entity as Stay).lodging?.name || 'Untitled stay';
  if (kind === 'transit') return transitRouteLabel(entity as Transit);
  return (entity as Activity).text || 'Untitled activity';
}

// Swaps two array entries by index — shared by RouteEditForm's variant
// reordering and MealOptionList's candidate reordering.
export function swapItems<T>(arr: T[], i: number, j: number): T[] {
  const next = [...arr];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

// ---------- includedIn (Activity's own decided dining format, and every
// MealOption candidate, both point at whichever Stay/Package/Activity/Transit
// a diningFormat of 'included'/'package'/'included-with-activity'/
// 'included-with-transit' is actually included/covered by) ----------
//
// includedIn points at a whole Stay's base rate, one specific Package nested
// inside a Stay, the other Activity this meal is bundled into for
// 'included-with-activity' (a packed lunch eaten mid-hike, say), or the
// Transit it's served during for 'included-with-transit' (an in-flight meal,
// a ferry snack bar) — flattened here into a single select whose value
// encodes both the entity kind and id ('stay:<id>' / 'package:<id>' /
// 'activity:<id>' / 'transit:<id>'). Only non-meal Activities are offered: a
// meal being "included with" another meal isn't a real case.
// One candidate for the "Included in" select — grouped and jumped-to by
// date (see IncludedInField), since names alone can repeat across the trip
// (e.g. two different days both have a "Free time" activity).
export interface IncludedInOption {
  value: string;
  label: string;
  date: string; // ISO date, for grouping
  sortKey: string; // ISO datetime, for chronological order within a group
}

// The only diningFormat values whose meaning actually depends on an
// includedIn ref — the same set includedInOptions below branches on, shared
// so every includedIn-showing form (the single-choice ActivityEditForm path
// and each MealOptionList candidate row) gates the field identically.
export const DINING_FORMATS_WITH_INCLUDED_IN: DiningFormat[] = [
  'included',
  'package',
  'included-with-activity',
  'included-with-transit',
];

// The candidate list depends on which diningFormat is selected — 'included'
// only offers stays, 'package' only offers packages, and so on — so callers
// must pass the current diningFormat to keep the dropdown from mixing
// unrelated entity kinds together. Labels are bare names (no "Included
// with"/"Package:" prefix) — the date grouping disambiguates instead.
// Options come back sorted chronologically, which also keeps each date's
// entries contiguous for grouping.
export function includedInOptions(
  diningFormat: DiningFormat | '',
  stays: Stay[],
  activities: Activity[],
  transits: Transit[],
): IncludedInOption[] {
  const options: IncludedInOption[] = [];
  if (diningFormat === 'included') {
    for (const stay of stays) {
      options.push({
        value: `stay:${stay._id}`,
        label: stay.lodging?.name ?? stay._id,
        date: stay.checkInAt.slice(0, 10),
        sortKey: stay.checkInAt,
      });
    }
  } else if (diningFormat === 'package') {
    for (const stay of stays) {
      for (const pkg of stay.packages ?? []) {
        options.push({
          value: `package:${pkg._id}`,
          label: pkg.name,
          date: stay.checkInAt.slice(0, 10),
          sortKey: stay.checkInAt,
        });
      }
    }
  } else if (diningFormat === 'included-with-activity') {
    for (const activity of activities) {
      if (activity.mealType) continue;
      const date = activity.startAt ? activity.startAt.slice(0, 10) : activity.date;
      if (date == null) continue;
      options.push({
        value: `activity:${activity._id}`,
        label: activity.text,
        date,
        sortKey: activity.startAt ?? `${date}T00:00`,
      });
    }
  } else if (diningFormat === 'included-with-transit') {
    for (const transit of transits) {
      options.push({
        value: `transit:${transit._id}`,
        label: transitRouteLabel(transit),
        date: transit.departsAt.slice(0, 10),
        sortKey: transit.departsAt,
      });
    }
  }
  options.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  return options;
}

export function includedInValue(includedIn: Ref | null): string {
  return includedIn && 'entity' in includedIn ? `${includedIn.entity}:${includedIn.id}` : '';
}

export function parseIncludedIn(value: string): Ref | null {
  if (!value) return null;
  const [entity, id] = value.split(':');
  return entity === 'stay' || entity === 'package' || entity === 'activity' || entity === 'transit'
    ? { entity, id }
    : null;
}

// ---------- Activity ----------

export interface ActivityFormState {
  startsDate: string | null;
  startsTime: string | null;
  durationMinutes: number | null;
  timeLabel: TimeLabel | '';
  text: string;
  status: PlanStatus;
  priority: Priority | '';
  mealType: MealType | '';
  diningFormat: DiningFormat | '';
  place: Place | null;
  includedIn: Ref | null;
  options: MealOption[];
  travelerIds: string[];
  booking: BookingFormValue;
}

// Starts' date field carries activity.date when there's no startAt — the
// only way a fuzzy-timeLabel activity's date ever reaches the form at all.
export function activityFormFrom(activity: Activity): ActivityFormState {
  const startsDate = activity.startAt ? activity.startAt.slice(0, 10) : (activity.date ?? null);
  const startsTime = activity.startAt ? activity.startAt.slice(11, 16) : null;
  return {
    startsDate,
    startsTime,
    durationMinutes: activity.durationMinutes,
    timeLabel: activity.timeLabel ?? '',
    text: activity.text,
    status: activity.status,
    priority: activity.priority ?? '',
    mealType: activity.mealType ?? '',
    diningFormat: activity.diningFormat ?? '',
    place: activity.place,
    includedIn: activity.includedIn,
    options: activity.options ?? [],
    travelerIds: activity.travelers ?? [],
    booking: bookingFormValueFrom(activity.booking),
  };
}

// Every Activity must resolve to both a real sort position and a real date
// — startAt, or a Starts date paired with a fuzzy timeLabel. An exact Starts
// always wins over the fuzzy time select when both are given.
export function applyActivityForm(activity: Activity, form: ActivityFormState): string | null {
  const text = form.text.trim();
  if (!text) return 'Needs a description.';
  const startAt =
    form.startsDate && form.startsTime ? `${form.startsDate}T${form.startsTime}` : null;
  activity.text = text;
  activity.status = form.status;
  activity.priority = form.priority || null;
  if (startAt) {
    activity.startAt = startAt;
    activity.durationMinutes = form.durationMinutes;
    activity.timeLabel = null;
    activity.date = null;
  } else if (form.startsDate && form.timeLabel) {
    activity.startAt = null;
    activity.durationMinutes = null;
    activity.date = form.startsDate;
    activity.timeLabel = form.timeLabel;
  } else {
    return 'Needs a start date+time, or a Starts date with a fuzzy time.';
  }
  activity.mealType = form.mealType || null;
  // A non-empty candidate list always wins: options and the Activity's own
  // place/diningFormat/includedIn are mutually exclusive — any candidates
  // present here mean this meal is still genuinely undecided, so the
  // decided single-answer fields get cleared back to null.
  if (form.options.length) {
    activity.options = form.options;
    activity.place = null;
    activity.diningFormat = null;
    activity.includedIn = null;
  } else {
    activity.options = null;
    activity.place = form.place;
    activity.diningFormat = form.diningFormat || null;
    activity.includedIn = form.includedIn;
  }
  activity.travelers = form.travelerIds.length ? form.travelerIds : null;
  activity.booking = readBookingFormValue(form.booking, activity.booking);
  return null;
}

// ---------- Stay ----------

export interface StayFormState {
  lodgingName: string;
  checkInDate: string | null;
  checkInTime: string | null;
  checkOutDate: string | null;
  checkOutTime: string | null;
  booking: BookingFormValue;
}

export function stayFormFrom(stay: Stay): StayFormState {
  return {
    lodgingName: stay.lodging?.name ?? '',
    checkInDate: stay.checkInAt.slice(0, 10),
    checkInTime: stay.checkInAt.slice(11, 16),
    checkOutDate: stay.checkOutAt.slice(0, 10),
    checkOutTime: stay.checkOutAt.slice(11, 16),
    booking: bookingFormValueFrom(stay.booking),
  };
}

export function applyStayForm(stay: Stay, form: StayFormState): string | null {
  const checkInAt =
    form.checkInDate && form.checkInTime ? `${form.checkInDate}T${form.checkInTime}` : null;
  const checkOutAt =
    form.checkOutDate && form.checkOutTime ? `${form.checkOutDate}T${form.checkOutTime}` : null;
  if (!checkInAt || !checkOutAt) return 'Needs both check-in and check-out times.';
  stay.checkInAt = checkInAt;
  stay.checkOutAt = checkOutAt;
  if (stay.lodging) stay.lodging.name = form.lodgingName.trim() || stay.lodging.name;
  stay.booking = readBookingFormValue(form.booking, stay.booking);
  return null;
}

// ---------- Transit ----------

export interface TransitFormState {
  fromLabel: string;
  toLabel: string;
  departsDate: string | null;
  departsTime: string | null;
  arrivesDate: string | null;
  arrivesTime: string | null;
  routeId: string | null;
  routeVariant: string | null;
  booking: BookingFormValue;
}

export function transitFormFrom(transit: Transit): TransitFormState {
  return {
    fromLabel: transit.from.label,
    toLabel: transit.to.label,
    departsDate: transit.departsAt.slice(0, 10),
    departsTime: transit.departsAt.slice(11, 16),
    arrivesDate: transit.arrivesAt ? transit.arrivesAt.slice(0, 10) : null,
    arrivesTime: transit.arrivesAt ? transit.arrivesAt.slice(11, 16) : null,
    routeId: transit.routeId,
    routeVariant: transit.routeVariant,
    booking: bookingFormValueFrom(transit.booking),
  };
}

// A routed Transit's Arrives is never authored — it's walked live from
// Departs plus the selected route variant's own drive times, so the field
// simply stays null in the data rather than carrying a guess nothing ever
// reads. Only a Transit with no route picked still needs a real one.
export function applyTransitForm(transit: Transit, form: TransitFormState): string | null {
  const departsAt =
    form.departsDate && form.departsTime ? `${form.departsDate}T${form.departsTime}` : null;
  const arrivesAt = form.routeId
    ? null
    : form.arrivesDate && form.arrivesTime
      ? `${form.arrivesDate}T${form.arrivesTime}`
      : null;
  if (!departsAt || (!form.routeId && !arrivesAt))
    return 'Needs both a departure and arrival time.';
  transit.departsAt = departsAt;
  transit.arrivesAt = arrivesAt;
  transit.from.label = form.fromLabel.trim() || transit.from.label;
  transit.to.label = form.toLabel.trim() || transit.to.label;
  transit.routeId = form.routeId;
  transit.routeVariant = form.routeId ? form.routeVariant : null;
  transit.booking = readBookingFormValue(form.booking, transit.booking);
  return null;
}

// Shared by TransitEditForm and the wizard's own TransitRouteStep — a
// route-picker <TextField select> always wants "None" first, then every
// route alphabetized by its own display label.
export function routeSelectOptions(routes: Route[]): { value: string; label: string }[] {
  const options = routes.map((r) => ({ value: r._id, label: transitRouteLabel(r) }));
  options.sort((a, b) => a.label.localeCompare(b.label));
  return [{ value: '', label: 'None' }, ...options];
}

export function routeVariantOptions(route: Route | null): { value: string; label: string }[] {
  return route
    ? route.variants.map((v) => ({ value: v.tone, label: v.label }))
    : [{ value: '', label: '—' }];
}

// Shared closed-vocabulary <TextField select> option lists — used by both
// the flat ActivityEditForm and the wizard's own step components, so they
// can't silently drift apart.
export const TIME_LABEL_OPTIONS: { value: TimeLabel | ''; label: string }[] = [
  { value: '', label: 'None' },
  { value: 'Morning', label: 'Morning' },
  { value: 'Afternoon', label: 'Afternoon' },
  { value: 'Evening', label: 'Evening' },
  { value: 'All day', label: 'All day' },
];

export const PRIORITY_OPTIONS: { value: Priority | ''; label: string }[] = [
  { value: '', label: 'None' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

export const DINING_FORMAT_OPTIONS: { value: DiningFormat | ''; label: string }[] = [
  { value: '', label: 'None' },
  { value: 'included', label: 'Included with the stay' },
  { value: 'package', label: 'Covered by package' },
  { value: 'included-with-activity', label: 'Included with another activity' },
  { value: 'included-with-transit', label: 'Included with travel' },
  { value: 'sit-down', label: 'Sit-down' },
  { value: 'grab-and-go', label: 'Grab-and-go' },
  { value: 'drivethru', label: 'Drive-thru' },
  { value: 'self-catered', label: 'Self-catered' },
];

// ---------- Route ----------
//
// Route (routes.json) is reference data, not a day-list line item — a
// Transit only ever *points at* one via routeId/routeVariant (see above).
// Its own shape (from/to plus an ordered variants[]/places[] tree) is
// already exactly what a form needs, so the form state is just a working
// clone of the Route itself rather than a parallel FormState shape.

export function routeFormFrom(route: Route): Route {
  return structuredClone(route);
}

// Mirrors docs/js/edit.js's own applyRouteEdit validation: every place entry
// needs a real place and a non-negative duration, every variant needs a
// label and a non-negative final leg, and a route needs at least one
// variant — a Transit pointing at this route always needs a real one to
// select.
export function applyRouteForm(route: Route, form: Route): string | null {
  const fromLabel = form.from.label.trim();
  const toLabel = form.to.label.trim();
  if (!fromLabel || !toLabel) return 'Needs both a From and To label.';
  if (!form.variants.length) return 'Needs at least one variant.';
  for (const variant of form.variants) {
    if (!variant.label.trim()) return 'Every variant needs a label.';
    for (const place of variant.places) {
      if (!place.place?.label) return 'Every place entry needs a place name.';
      if (!place.place?.id) return 'Every place entry needs a Google Place ID.';
      if (!Number.isFinite(place.durationMinutes) || place.durationMinutes < 0) {
        return 'Every place entry needs a duration of zero or more minutes.';
      }
    }
    if (!Number.isFinite(variant.finalLegMinutes) || variant.finalLegMinutes < 0) {
      return 'Every variant needs a final-leg duration of zero or more minutes.';
    }
  }
  route.from = { ...form.from, label: fromLabel };
  route.to = { ...form.to, label: toLabel };
  route.variants = form.variants;
  return null;
}

// ---------- Scenario (the day list's own "Manage scenarios" dialog) ----------
//
// Scenario, like Route, isn't a day-list line item scoped to one entity id —
// it's reference data an Activity/Transit points at via scenarioId, and
// several scenarios can share a followsScenarioDate/requiresScenarioId chain
// that spans days. So this mirrors routeFormFrom/applyRouteForm's shape (the
// form state is a working clone of the Scenario itself) rather than the
// per-field FormState shape Activity/Stay/Transit use.

// `date` seeds a brand-new scenario's own placement hint (Scenario.date) so
// it shows up on the day it was added from even before it has any
// Activity/Transit of its own — left unset for ScenariosDialog's own "Add
// scenario" flow, which isn't scoped to any one day.
export function blankScenario(legId: string, date?: string): Scenario {
  return {
    _id: crypto.randomUUID(),
    legId,
    tone: 'ideal',
    label: '',
    icon: 'help_outline',
    date,
    images: [],
  };
}

export function scenarioFormFrom(scenario: Scenario): Scenario {
  return structuredClone(scenario);
}

// A requiresScenarioId/parentScenarioId pointing at a scenario that's since
// been deleted would silently break that scenario's own tab gating (see
// scenarioSelection.ts), so both get scrubbed of any id no longer present in
// allScenarios — same fail-closed spirit as a Route's required non-negative
// durations, just applied to id references instead of numbers.
export function applyScenarioForm(
  scenario: Scenario,
  form: Scenario,
  allScenarios: Scenario[],
): string | null {
  const label = form.label.trim();
  if (!label) return 'Needs a label.';
  if (!form.legId) return 'Needs a leg.';
  const validIds = new Set(allScenarios.map((s) => s._id));
  validIds.delete(scenario._id);
  scenario.legId = form.legId;
  scenario.tone = form.tone;
  scenario.label = label;
  scenario.icon = form.icon || 'help_outline';
  scenario.followsScenarioDate = form.followsScenarioDate || undefined;
  const requires = (form.requiresScenarioId ?? []).filter((id) => validIds.has(id));
  scenario.requiresScenarioId = requires.length ? requires : undefined;
  scenario.parentScenarioId =
    form.parentScenarioId && validIds.has(form.parentScenarioId)
      ? form.parentScenarioId
      : undefined;
  return null;
}

// tripModel.ts's buildScenarioTracks only ever builds a track for a
// scenarioId still present in scenariosById (see its own top-of-function
// comment) — and day.sequence is built from everything *without* a
// scenarioId. So an Activity/Transit left pointing at a deleted scenario
// doesn't fall back into the day's plain sequence, it silently stops
// rendering anywhere. Deleting a scenario therefore has to clear that
// scenarioId back to null on every Activity/Transit that carried it (same
// fail-closed spirit applyScenarioForm already applies to
// requires/parentScenarioId above), not just remove the scenario itself.
export function applyScenarioDeletion<
  T extends { scenarios: Scenario[]; activities: Activity[]; transits: Transit[] },
>(data: T, scenarioId: string): T {
  return {
    ...data,
    scenarios: data.scenarios
      .filter((s) => s._id !== scenarioId)
      .map((s) => {
        const requires = (s.requiresScenarioId ?? []).filter((id) => id !== scenarioId);
        const parentScenarioId = s.parentScenarioId === scenarioId ? undefined : s.parentScenarioId;
        if (
          requires.length === (s.requiresScenarioId ?? []).length &&
          parentScenarioId === s.parentScenarioId
        ) {
          return s;
        }
        return {
          ...s,
          requiresScenarioId: requires.length ? requires : undefined,
          parentScenarioId,
        };
      }),
    activities: data.activities.map((a) =>
      a.scenarioId === scenarioId ? { ...a, scenarioId: null } : a,
    ),
    transits: data.transits.map((t) =>
      t.scenarioId === scenarioId ? { ...t, scenarioId: null } : t,
    ),
  };
}

// ---------- Trip (the trips list's own Add/Edit trip dialog) ----------
//
// Trip carries no startDate/endDate of its own — tripModel.ts's
// tripDateRange computes the trip's span from its own Legs instead, so
// there's nothing date-related for this form to own. applyTripForm covers
// both create and edit: pass the existing Trip as `base` to update it in
// place (preserving its _id/travelers/images), or null to build a fresh one.

export interface TripFormState {
  name: string;
  slug: string;
  summary: string;
}

export function blankTripForm(): TripFormState {
  return { name: '', slug: '', summary: '' };
}

export function tripFormFrom(trip: Trip, slug: string): TripFormState {
  return { name: trip.name, slug, summary: trip.summary ?? '' };
}

export function applyTripForm(
  base: Trip | null,
  form: TripFormState,
  existingSlugs: string[],
): { slug: string; trip: Trip } | string {
  const name = form.name.trim();
  if (!name) return 'Needs a name.';
  const slug = form.slug.trim();
  if (!slug) return 'Needs a slug.';
  if (existingSlugs.includes(slug)) return 'That slug is already used by another trip.';
  const trip: Trip = {
    _id: base?._id ?? crypto.randomUUID(),
    name,
    summary: form.summary.trim() || null,
    travelers: base?.travelers ?? [],
    images: base?.images ?? [],
  };
  return { slug, trip };
}

// ---------- Leg (Overview's own "Add leg" dialog) ----------
//
// A brand-new trip starts with zero Legs, and buildTripView only produces a
// Day for dates that fall inside one (see buildDay in tripModel.ts) — so
// until a first Leg exists, there's nothing for the day list's own "Add to
// this day" button to attach to, and no computed trip date range either
// (tripModel.ts's tripDateRange). Mirrors applyTripForm's shape: builds and
// returns a finished Leg rather than mutating one in place, since Add leg
// (like Add trip) only ever creates, never edits an existing Leg.
//
// No startDate/endDate/status here either — a Leg's own span is computed
// from whatever Stay/Transit/Activity ends up pointing at it (tripModel.ts's
// legDateRange), so a freshly created Leg simply has no span (and shows up
// with none) until its first entity is added.

export interface LegFormState {
  name: string;
  skeletonAuthority: Leg['skeletonAuthority'];
}

export function blankLegForm(): LegFormState {
  return { name: '', skeletonAuthority: 'self' };
}

export function applyLegForm(form: LegFormState, tripId: string): { leg: Leg } | string {
  const name = form.name.trim();
  if (!name) return 'Needs a name.';
  const leg: Leg = {
    _id: crypto.randomUUID(),
    tripId,
    name,
    skeletonAuthority: form.skeletonAuthority,
    booking: null,
    images: [],
  };
  return { leg };
}

// ---------- Add/edit wizard (the day list's guided "Add to this day" flow,
// plus the same step-by-step treatment for editing an existing Activity/
// Stay/Transit) ----------
//
// The wizard's first question ("what are you adding?") answers onto a
// WizardCategory rather than straight onto an EditKind, because Activity
// splits into two materially different follow-ups (a plain Activity vs. a
// meal, which additionally needs the decided/still-deciding branch) and
// Scenario — which never went through EditKind at all, see blankScenario
// above — joins as a fifth choice. Editing an existing entity skips that
// first question (its EditKind is already fixed), but an existing Activity
// still gets the smaller "is this a meal?" branch, so it can move between
// the two without leaving the wizard.

// A superset of EditKind (not an independent enum that happens to share
// spellings) so that treating a fixed EditKind as its own WizardCategory —
// see EditEventWizard's initial `category` state — is checked structurally
// rather than relying on the two literal unions staying in sync by hand.
export type WizardCategory = EditKind | 'meal' | 'scenario';

export type MealDecision = 'decided' | 'undecided';

// Key order doubles as the CategoryStep's display order — keep the most
// common choice (a place to sleep) first.
export const WIZARD_CATEGORY_META: Record<WizardCategory, { label: string; helper: string }> = {
  stay: {
    label: 'Somewhere to sleep',
    helper: 'A hotel, lodge, cabin, or campsite — anywhere you check in and check out of.',
  },
  meal: {
    label: 'A meal',
    helper: 'Breakfast, lunch, dinner, or a snack — even if the place is still up in the air.',
  },
  transit: {
    label: 'Getting somewhere',
    helper: 'A drive, flight, ferry, or any other leg that moves from one place to another.',
  },
  activity: {
    label: 'Something to do',
    helper: 'A hike, tour, museum, or anything else that happens at a place and a time.',
  },
  scenario: {
    label: 'A weather-branch or backup plan',
    helper: "Two versions of a day — an 'ideal' plan and the 'alternate' it falls back to.",
  },
};

// A brand-new Activity (blankActivity's own mealType: null / options: null)
// reads back as 'activity' here, matching the wizard's own "Something to
// do" default.
export function categoryForActivity(
  form: Pick<ActivityFormState, 'mealType' | 'options'>,
): WizardCategory {
  return form.mealType !== '' || form.options.length > 0 ? 'meal' : 'activity';
}

export function mealDecisionForActivity(form: Pick<ActivityFormState, 'options'>): MealDecision {
  return form.options.length > 0 ? 'undecided' : 'decided';
}

export type WizardStepId =
  | 'category'
  | 'mealBranch'
  | 'stayDetails'
  | 'stayWhen'
  | 'transitWhere'
  | 'transitRoute'
  | 'transitWhen'
  | 'activityWhat'
  | 'activityWhen'
  | 'activityPlace'
  | 'extras'
  | 'mealWhat'
  | 'mealWhen'
  | 'mealDecision'
  | 'mealPlace'
  | 'mealOptions'
  | 'booking'
  | 'scenarioDetails'
  | 'review';

export const WIZARD_STEP_LABEL: Record<WizardStepId, string> = {
  category: 'What are you adding?',
  mealBranch: 'Is this a meal?',
  stayDetails: "Where you're staying",
  stayWhen: 'Check-in / check-out',
  transitWhere: 'From / to',
  transitRoute: 'Route',
  transitWhen: 'Departs / arrives',
  activityWhat: 'What is it?',
  activityWhen: 'When',
  activityPlace: 'Place',
  extras: 'A few more details',
  mealWhat: 'What meal?',
  mealWhen: 'When',
  mealDecision: 'Do you know where yet?',
  mealPlace: 'Where',
  mealOptions: 'The candidates',
  booking: 'Booking',
  scenarioDetails: 'Scenario details',
  review: 'Review',
};

// Only steps worth a nudge get an entry — most fields (Priority, Route
// variant, ...) are self-explanatory enough not to need one.
export const WIZARD_STEP_TIP: Partial<Record<WizardStepId, string>> = {
  category: 'Pick whichever comes closest — the next questions adjust to match.',
  mealBranch: "Meals get an extra step for whether you've picked a restaurant yet.",
  stayDetails: 'Just a name for now — the exact address comes later if you need it.',
  transitWhere: "Plain place names are fine; you don't need a full address.",
  transitRoute:
    "Picking a route with known stages fills in travel time automatically and surfaces this leg's stops on the day. Leave it as None for a simple point-to-point trip.",
  activityWhen: 'No exact time yet? Leave Starts time blank and pick a fuzzy time of day instead.',
  activityPlace: "Leave this blank if there's no specific real-world location.",
  mealWhen: 'No exact time yet? Leave Starts time blank and pick a fuzzy time of day instead.',
  mealDecision:
    'Still choosing between a few restaurants? Say so — you can list every candidate next.',
  mealOptions: "Add every place still in the running; each gets its own tab on the day's list.",
  extras: "Both are optional — skip either if they don't apply.",
  booking: "Only fill this in once there's an actual reservation or confirmation number.",
  scenarioDetails:
    "Ideal is the plan you're hoping for; Alternate is what this day falls back to if it doesn't pan out.",
};

// `lead` is either the category question (a brand-new entity, kind
// undecided) or the smaller meal-branch question (editing an existing
// Activity, kind already fixed) — the two are mutually exclusive, and
// editing a Stay/Transit gets no lead step at all, since there's nothing
// left to ask before its own details.
export function wizardStepsForCategory(
  category: WizardCategory,
  opts: {
    mealDecision: MealDecision;
    hasTravelers: boolean;
    lead: 'category' | 'mealBranch' | null;
  },
): WizardStepId[] {
  const lead: WizardStepId[] = opts.lead ? [opts.lead] : [];
  const extras: WizardStepId[] = opts.hasTravelers ? ['extras'] : [];
  switch (category) {
    case 'stay':
      return [...lead, 'stayDetails', 'stayWhen', 'booking', 'review'];
    case 'transit':
      return [...lead, 'transitWhere', 'transitRoute', 'transitWhen', 'booking', 'review'];
    case 'activity':
      return [
        ...lead,
        'activityWhat',
        'activityWhen',
        'activityPlace',
        ...extras,
        'booking',
        'review',
      ];
    case 'meal':
      return [
        ...lead,
        'mealWhat',
        'mealWhen',
        'mealDecision',
        opts.mealDecision === 'decided' ? 'mealPlace' : 'mealOptions',
        ...extras,
        'booking',
        'review',
      ];
    case 'scenario':
      return [...lead, 'scenarioDetails', 'review'];
  }
}

// Gates a step's Next button — mirrors only the hard requirements each
// applyXyzForm above already enforces at save time (a real start, a real
// check-in/out, ...), so nothing here can block Save from ever being
// reachable. Every other step (Place, Booking, the meal candidates, ...) is
// genuinely optional and always returns true.
export function wizardStepCanProceed(
  stepId: WizardStepId,
  forms: {
    activityForm?: ActivityFormState;
    stayForm?: StayFormState;
    transitForm?: TransitFormState;
    scenarioForm?: Scenario;
  },
): boolean {
  switch (stepId) {
    case 'stayWhen': {
      const f = forms.stayForm;
      return Boolean(f && f.checkInDate && f.checkInTime && f.checkOutDate && f.checkOutTime);
    }
    case 'transitWhen': {
      const f = forms.transitForm;
      return Boolean(
        f && f.departsDate && f.departsTime && (f.routeId || (f.arrivesDate && f.arrivesTime)),
      );
    }
    case 'activityWhat':
    case 'mealWhat':
      return Boolean(forms.activityForm && forms.activityForm.text.trim() !== '');
    case 'activityWhen':
    case 'mealWhen': {
      const f = forms.activityForm;
      return Boolean(f && f.startsDate && (f.startsTime || f.timeLabel));
    }
    case 'scenarioDetails':
      return Boolean(forms.scenarioForm && forms.scenarioForm.label.trim() !== '');
    default:
      return true;
  }
}
