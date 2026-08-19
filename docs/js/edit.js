// Editing day-list line items — Activity, Stay, and Transit, the three kinds
// scoped for this pass (a Route's via[] stages and a MealOption candidate are
// both computed/nested rather than a standalone line item, so neither gets
// its own edit form here). Two chrome shells share this same form/apply pair
// rather than each having their own copy: the activity side sheet swaps its
// read-only body for renderEditForm('activity', ...) in place (see app.js's
// enterActivityEditMode), and the standalone #edit-dialog popup (opened from
// any row's pencil button, including Stay/Transit, which have no side sheet
// at all) hosts the same form. Both call applyEdit on Save.
//
// There's no backend this can write to — see CLAUDE.md: docs/ is served
// as-is by GitHub Pages from static *.json files. So an edit only ever
// mutates the in-memory entity object trip-model.js's buildTripView was
// built from; app.js rebuilds the view and re-renders after every save. For
// an edit to survive past this page load, the touched *.json file(s) need
// exporting (see app.js's markDirty/downloadJson) and manually copying back
// into docs/data/<slug>/ — the same hand-authoring path this trip's data
// already went through once.
//
// Every Activity field is covered here *except* legId, scenarioId, images,
// options, and includedIn — not because they're unimportant, but because
// each is load-bearing for *where this activity even appears*: legId/
// scenarioId decide which day/leg or which scenario-branch tab this activity
// is filtered into (trip-model.js's buildDay/buildScenarioTracks), so a
// casual reassignment here could silently vanish it from the day list rather
// than move it; images is a media concern this text-first form doesn't
// touch; options/includedIn are the MealOption-candidate machinery, already
// out of scope per the note above. _id and order (vestigial — nothing reads
// it) aren't real attributes to edit at all.

function toNode(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

function field(label, name, value, type = 'text') {
  return `<md-outlined-text-field class="edit-field" label="${label}" name="${name}" type="${type}" value="${value ?? ''}"></md-outlined-text-field>`;
}

function select(label, name, value, options) {
  const optionsHtml = options.map((o) => `<md-select-option value="${o.value}"><div slot="headline">${o.label}</div></md-select-option>`).join('');
  return `<md-outlined-select class="edit-field" name="${name}" label="${label}" value="${value ?? ''}">${optionsHtml}</md-outlined-select>`;
}

const STATUS_OPTIONS = [
  { value: 'planning', label: 'Planning' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

// Booking has its own, shorter status ladder than the plan-status one above
// (see data-model.html's ladder section: planning -> booked / cancelled — no
// active/completed, since those describe the trip actually happening, not a
// reservation existing) — a genuinely different vocabulary, not a subset of
// STATUS_OPTIONS to filter down from.
const BOOKING_STATUS_OPTIONS = [
  { value: 'planning', label: 'Planning' },
  { value: 'booked', label: 'Booked' },
  { value: 'cancelled', label: 'Cancelled' },
];

const PRIORITY_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

// The same closed vocabulary as trip-model.js's TIME_LABEL_ANCHORS — a
// timeLabel outside this list is tolerated there (it just borrows the
// nearest preceding real timestamp) but this form only ever writes one of
// these four, or none.
const TIME_LABEL_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'Morning', label: 'Morning' },
  { value: 'Afternoon', label: 'Afternoon' },
  { value: 'Evening', label: 'Evening' },
  { value: 'All day', label: 'All day' },
];

const MEAL_TYPE_OPTIONS = [
  { value: '', label: 'Not a meal' },
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snack' },
];

const DINING_FORMAT_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'included', label: 'Included with the stay' },
  { value: 'package', label: 'Covered by package' },
  { value: 'sit-down', label: 'Sit-down' },
  { value: 'grab-and-go', label: 'Grab-and-go' },
  { value: 'drivethru', label: 'Drive-thru' },
  { value: 'self-catered', label: 'Self-catered' },
];

// Booking is optional on all three kinds (see data-model.html) — the "Has a
// booking" checkbox is what actually decides whether one exists after Save
// (see applyBookingEdit), so the fields underneath render pre-filled with a
// blank/planning default even when there's no booking yet, letting this form
// both edit an existing booking and add a brand new one.
function bookingFields(booking) {
  const b = booking ?? { status: 'planning', cost: null, confirmationNumber: null };
  return `
    <div class="edit-section-label md-typescale-label-large">Booking</div>
    <label class="edit-checkbox-row">
      <md-checkbox name="hasBooking" ${booking ? 'checked' : ''}></md-checkbox>
      <span>Has a booking / reservation</span>
    </label>
    ${select('Status', 'bookingStatus', b.status, BOOKING_STATUS_OPTIONS)}
    <div class="edit-field-row">
      ${field('Confirmation #', 'bookingConfirmationNumber', b.confirmationNumber)}
      ${field('Cost', 'bookingCostAmount', b.cost?.amount, 'number')}
    </div>`;
}

function readBookingEdit(formEl, currentBooking) {
  if (!formEl.querySelector('[name="hasBooking"]')?.checked) return null;
  const amount = readField(formEl, 'bookingCostAmount');
  return {
    status: readField(formEl, 'bookingStatus') || 'planning',
    confirmationNumber: readField(formEl, 'bookingConfirmationNumber') || null,
    cost: amount ? { amount: Number(amount), currency: currentBooking?.cost?.currency ?? 'USD' } : null,
  };
}

function placeFields(place) {
  return `
    <div class="edit-section-label md-typescale-label-large">Place</div>
    <div class="edit-field-row">
      ${field('Name', 'placeLabel', place?.label)}
      ${field('Google Place ID', 'placeId', place?.id)}
    </div>`;
}

function readPlaceEdit(formEl, currentPlace) {
  const label = readField(formEl, 'placeLabel');
  if (!label) return null;
  return { id: readField(formEl, 'placeId') || null, label, images: currentPlace?.images ?? [] };
}

// Trip.travelers[].id checkboxes — only meaningful on an excursion (mealType
// null); a meal's own attendee chip is derived from includedIn/Package
// instead (trip-model.js's resolveMealTravelers), so this list still saves
// but has no visible effect while mealType is set. None checked means
// "everyone," the same null-is-the-common-case convention the raw field
// already uses (see data-model.html's Activity.travelers).
function travelersFields(activity, tripTravelers) {
  if (!tripTravelers?.length) return '';
  const checked = new Set(activity.travelers ?? []);
  const rows = tripTravelers
    .map(
      (t) => `
      <label class="edit-checkbox-row">
        <md-checkbox data-traveler-id="${t.id}" ${checked.has(t.id) ? 'checked' : ''}></md-checkbox>
        <span>${t.name}</span>
      </label>`
    )
    .join('');
  return `
    <div class="edit-section-label md-typescale-label-large">Travelers (excursions only — leave all unchecked for everyone)</div>
    <div class="edit-checkbox-group">${rows}</div>`;
}

function readTravelersEdit(formEl) {
  const ids = [...formEl.querySelectorAll('[data-traveler-id]')].filter((cb) => cb.checked).map((cb) => cb.dataset.travelerId);
  return ids.length ? ids : null;
}

// datetime-local's native rendered value ("06/26/2027, 09:30 PM") doesn't
// reflow to a narrower box the way text does — it just overflows past it —
// so two of them never fit side by side in either host's width (the side
// sheet's ~24rem panel, the popup's ~26rem dialog). Every other field pairs
// up via .edit-field-row; every datetime-local field gets its own full-width
// line instead.
function activityFields(activity, { tripTravelers } = {}) {
  return `
    ${field('What', 'text', activity.text)}
    ${select('Status', 'status', activity.status, STATUS_OPTIONS)}
    ${select('Priority', 'priority', activity.priority, PRIORITY_OPTIONS)}
    ${field('Starts', 'startAt', activity.startAt, 'datetime-local')}
    ${field('Ends', 'endAt', activity.endAt, 'datetime-local')}
    ${select('Fuzzy time (used only when Starts/Ends are both blank)', 'timeLabel', activity.timeLabel, TIME_LABEL_OPTIONS)}
    ${placeFields(activity.place)}
    ${select('Meal type', 'mealType', activity.mealType, MEAL_TYPE_OPTIONS)}
    ${select('Dining format', 'diningFormat', activity.diningFormat, DINING_FORMAT_OPTIONS)}
    ${travelersFields(activity, tripTravelers)}
    ${bookingFields(activity.booking)}`;
}

function stayFields(stay) {
  return `
    ${field('Lodging name', 'lodgingName', stay.lodging?.name)}
    ${field('Check in', 'checkInAt', stay.checkInAt, 'datetime-local')}
    ${field('Check out', 'checkOutAt', stay.checkOutAt, 'datetime-local')}
    ${bookingFields(stay.booking)}`;
}

function transitFields(transit) {
  return `
    <div class="edit-field-row">
      ${field('From', 'fromLabel', transit.from.label)}
      ${field('To', 'toLabel', transit.to.label)}
    </div>
    ${field('Departs', 'departsAt', transit.departsAt, 'datetime-local')}
    ${field('Arrives', 'arrivesAt', transit.arrivesAt, 'datetime-local')}
    ${bookingFields(transit.booking)}`;
}

export const EDIT_ENTITY_LABEL = { activity: 'Edit activity', stay: 'Edit stay', transit: 'Edit transit' };

// `context` is only used for kind: 'activity' — { tripTravelers: Trip.travelers }
// (see app.js's callers) — Stay/Transit ignore it.
export function renderEditForm(kind, entity, context) {
  const html = kind === 'activity' ? activityFields(entity, context) : kind === 'stay' ? stayFields(entity) : transitFields(entity);
  return toNode(`<div class="edit-form" data-kind="${kind}">${html}</div>`);
}

function readField(formEl, name) {
  return formEl.querySelector(`[name="${name}"]`)?.value.trim() ?? '';
}

// Every Activity must resolve to a real sort position — startAt, endAt, or a
// timeLabel drawn from trip-model.js's TIME_LABEL_ANCHORS (see
// validateActivityTiming there). An exact Starts/Ends always wins over the
// fuzzy time select when both are given; the fuzzy time only actually gets
// saved when both exact fields are left blank.
function applyActivityEdit(activity, formEl) {
  const text = readField(formEl, 'text');
  if (!text) return 'Needs a description.';
  const startAt = readField(formEl, 'startAt');
  const endAt = readField(formEl, 'endAt');
  const timeLabel = readField(formEl, 'timeLabel') || null;
  if (!startAt && !endAt && !timeLabel) return 'Needs a start/end time or a fuzzy time.';
  activity.text = text;
  activity.status = readField(formEl, 'status') || activity.status;
  activity.priority = readField(formEl, 'priority') || null;
  activity.startAt = startAt || null;
  activity.endAt = endAt || null;
  activity.timeLabel = startAt || endAt ? null : timeLabel;
  activity.place = readPlaceEdit(formEl, activity.place);
  activity.mealType = readField(formEl, 'mealType') || null;
  activity.diningFormat = readField(formEl, 'diningFormat') || null;
  activity.travelers = readTravelersEdit(formEl);
  activity.booking = readBookingEdit(formEl, activity.booking);
  return null;
}

function applyStayEdit(stay, formEl) {
  const checkInAt = readField(formEl, 'checkInAt');
  const checkOutAt = readField(formEl, 'checkOutAt');
  if (!checkInAt || !checkOutAt) return 'Needs both check-in and check-out times.';
  stay.checkInAt = checkInAt;
  stay.checkOutAt = checkOutAt;
  if (stay.lodging) stay.lodging.name = readField(formEl, 'lodgingName') || stay.lodging.name;
  stay.booking = readBookingEdit(formEl, stay.booking);
  return null;
}

function applyTransitEdit(transit, formEl) {
  const departsAt = readField(formEl, 'departsAt');
  const arrivesAt = readField(formEl, 'arrivesAt');
  if (!departsAt || !arrivesAt) return 'Needs both a departure and arrival time.';
  transit.departsAt = departsAt;
  transit.arrivesAt = arrivesAt;
  transit.from.label = readField(formEl, 'fromLabel') || transit.from.label;
  transit.to.label = readField(formEl, 'toLabel') || transit.to.label;
  transit.booking = readBookingEdit(formEl, transit.booking);
  return null;
}

// Mutates `entity` in place and returns null on success, or a message to
// show inline (see the per-kind functions above) without closing the form.
export function applyEdit(kind, entity, formEl) {
  if (kind === 'activity') return applyActivityEdit(entity, formEl);
  if (kind === 'stay') return applyStayEdit(entity, formEl);
  return applyTransitEdit(entity, formEl);
}
