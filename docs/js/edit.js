import { formatDateLabel, formatTime, addDaysStr } from './trip-model.js';
import { searchPlaces } from './places.js';
import { lookupDriveMinutes } from './directions.js';

// Editing day-list line items — Activity, Stay, and Transit — plus Route,
// the one reusable reference-data kind (routes.json) this file also covers,
// since a Transit's own routeId/routeVariant fields need somewhere to point.
// An Activity's options (MealOption[]) get their own add/edit/delete/reorder
// list right inside the Activity form — see mealOptionRowNode/
// updateMealOptionsToggle below — rather than a separate popup, since a
// candidate is nested under one Activity, not a standalone line item of its
// own. One chrome
// shell hosts renderEditForm for all four kinds: the standalone #edit-dialog
// popup (app.js's openEditPopup), opened from a Stay/Transit row's pencil
// button, the activity side sheet's own edit button, or the Routes list
// dialog (app.js's openRoutesDialog). It calls applyEdit on Save.
//
// There's no backend this can write to — see CLAUDE.md: docs/ is served
// as-is by GitHub Pages from static *.json files. So an edit only ever
// mutates the in-memory entity object trip-model.js's buildTripView was
// built from; app.js rebuilds the view and re-renders after every save. For
// an edit to survive past this page load, the touched *.json file(s) need
// exporting (see app.js's markDirty/downloadJson) and manually copying back
// into docs/data/<slug>/ (docs/data/ itself, for routes.json, which is
// shared across trips rather than scoped to one) — the same hand-authoring
// path this trip's data already went through once.
//
// Every Activity field is covered here *except* legId, scenarioId, images,
// and the Activity's own top-level includedIn — not because they're
// unimportant, but because each is load-bearing for *where this activity
// even appears*: legId/scenarioId decide which day/leg or which
// scenario-branch tab this activity is filtered into (trip-model.js's
// buildDay/buildScenarioTracks), so a casual reassignment here could
// silently vanish it from the day list rather than move it; images is a
// media concern this text-first form doesn't touch; the top-level
// includedIn (as opposed to a MealOption candidate's own, which *is*
// editable — see below) only ever gets set by promoting a decided
// candidate, never hand-authored directly. _id and order (vestigial —
// nothing reads it) aren't real attributes to edit at all.
//
// options is editable, but not as an ordinary field: data-model.html's own
// rationale for MealOption is that it and the Activity's own place/
// diningFormat/includedIn are mutually exclusive — options holds the
// still-undecided candidates, the other three hold the decided single
// answer, and only one side is ever populated at a time. The "Meal
// candidates" list below (mealOptionRowNode/updateMealOptionsToggle) is an
// add/remove/reorder list in the same append-and-splice style as Route's own
// variants[]/places[] (see the Route-editing section further down): the
// Place/Dining format fields above it are labelled .decided-meal-fields and
// hide themselves live whenever the list holds at least one row, and
// applyActivityEdit (below) is what actually enforces the exclusivity on
// Save — a non-empty candidate list wins outright, clearing place/
// diningFormat/includedIn back to null on the Activity itself, exactly the
// state data-model.html describes for "genuinely undecided."

function toNode(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

function field(label, name, value, type = 'text') {
  return `<md-outlined-text-field class="edit-field" label="${label}" name="${name}" type="${type}" value="${value ?? ''}"></md-outlined-text-field>`;
}

// ---------- date/time picker pseudo-fields — a date+time value (Activity's
// Starts/Ends, Stay's Check in/out, Transit's Departs/Arrives) renders as two
// independently-pickable fields rather than one native datetime-local input,
// opened via the M3 date-picker/time-picker dialogs (app.js's
// context.openDatePicker/openTimePicker — see renderEditForm's own wiring
// below). Splitting them matters for more than just using the real pickers:
// an Activity's date can be set while its time is left blank, which is
// exactly the fuzzy-timeLabel case (trip-model.js's Activity.date) — a
// single combined field could never represent "this date, but only roughly
// this time of day".
//
// Rendered as flat text rather than a boxed md-outlined-text-field — these
// are always readonly, opened via a full picker dialog rather than typed
// into directly, so a text field's box only spends space promising an
// affordance ("type here") the field never honors. A plain div instead, with
// the field's own label standing in as muted placeholder text until a value
// is actually picked (matching Google Calendar's own compact date/time
// editor), and a background tint on hover/focus as the only "this is
// tappable" cue (see the .date-picker-field/.time-picker-field rules in
// styles.css). Each pseudo-field's real value lives in data-value
// ('YYYY-MM-DD' or 'HH:MM', possibly '') rather than its displayed text,
// which readDateField/readTimeField (below) read back on Save; data-label
// holds the field's own label so setPickerFieldValue can fall back to it as
// the empty-value placeholder without a closure carrying it around. ----------

function formatClockTime(hhmm) {
  return formatTime(`2000-01-01T${hhmm}`);
}

function pickerFieldAriaLabel(label, displayValue) {
  return `${label}: ${displayValue || 'not set'}`;
}

// Pushes a newly-picked (or cleared) value into a date/time pseudo-field's
// DOM — the single place that keeps data-value, the visible text, the
// placeholder styling, and the aria-label in sync, since every picker
// callback and shiftPairedEndDate below all need to do exactly that together.
function setPickerFieldValue(fieldEl, rawValue, displayValue) {
  fieldEl.dataset.value = rawValue ?? '';
  fieldEl.querySelector('.picker-field-value').textContent = displayValue || fieldEl.dataset.label;
  fieldEl.classList.toggle('is-placeholder', !displayValue);
  fieldEl.setAttribute('aria-label', pickerFieldAriaLabel(fieldEl.dataset.label, displayValue));
}

function dateField(label, name, isoDate) {
  const displayValue = isoDate ? formatDateLabel(isoDate) : '';
  return `<div class="edit-field date-picker-field${displayValue ? '' : ' is-placeholder'}" name="${name}" tabindex="0" role="button" aria-label="${pickerFieldAriaLabel(label, displayValue)}" data-value="${isoDate ?? ''}" data-label="${label}">
    <md-icon>calendar_month</md-icon>
    <span class="picker-field-value">${displayValue || label}</span>
  </div>`;
}

// Time, unlike date, is genuinely optional on an Activity's Starts (see the
// file-top note above) — the trailing clear button is how it gets back to
// blank once a time picker has set it, since there's no fuzzy-time
// equivalent of "just delete the text" for a readonly field. It only shows
// once a time is actually set — nothing to clear otherwise.
function timeField(label, name, hhmm) {
  const displayValue = hhmm ? formatClockTime(hhmm) : '';
  return `<div class="edit-field time-picker-field${displayValue ? '' : ' is-placeholder'}" name="${name}" tabindex="0" role="button" aria-label="${pickerFieldAriaLabel(label, displayValue)}" data-value="${hhmm ?? ''}" data-label="${label}">
    <md-icon>schedule</md-icon>
    <span class="picker-field-value">${displayValue || label}</span>
    <md-icon-button class="clear-time-field" aria-label="Clear ${label}"${hhmm ? '' : ' hidden'}><md-icon>close</md-icon></md-icon-button>
  </div>`;
}

// One date+time pair, side by side like every other .edit-field-row —
// unlike the old single native datetime-local field, these two narrow
// pseudo-fields actually fit together. `isoValue` is a full 'YYYY-MM-DDTHH:MM'
// timestamp, or just 'YYYY-MM-DD' (a trailing bare date, time left blank) for
// an Activity's fuzzy-date case — splitting on 'T' handles both.
function dateTimeFieldRow(prefix, dateLabel, timeLabel, isoValue) {
  const [datePart, timePart] = isoValue ? isoValue.split('T') : [null, null];
  return `<div class="edit-field-row">${dateField(dateLabel, `${prefix}Date`, datePart)}${timeField(timeLabel, `${prefix}Time`, timePart)}</div>`;
}

function readDateField(formEl, name) {
  return formEl.querySelector(`[name="${name}"]`)?.dataset.value ?? '';
}

function readTimeField(formEl, name) {
  return formEl.querySelector(`[name="${name}"]`)?.dataset.value ?? '';
}

function selectOptionsHtml(options) {
  return options.map((o) => `<md-select-option value="${o.value}"><div slot="headline">${o.label}</div></md-select-option>`).join('');
}

function select(label, name, value, options) {
  return `<md-outlined-select class="edit-field" name="${name}" label="${label}" value="${value ?? ''}">${selectOptionsHtml(options)}</md-outlined-select>`;
}

// Used to repopulate a route-variant select's options after a different
// route is chosen in the sibling route select (see the routeId change
// listener in renderEditForm) — the options genuinely depend on which route
// is selected, unlike every other select in this file whose option list is
// static for the lifetime of the form.
function setSelectOptions(selectEl, options, value) {
  selectEl.innerHTML = selectOptionsHtml(options);
  selectEl.value = value ?? '';
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

// A place's Name field (prefixed 'place' for Activity's own place and for a
// Route place entry — see placeRowNode) doubles as its own type-ahead search
// box, since nobody actually knows a Google Place ID by heart: wirePlacePicker
// (below) searches live as Name is typed into and fills Name/Place ID in from
// a picked result. Both Name and the Place ID field below it stay directly
// editable too — search can miss or return the wrong match (see places.js's
// own note on why Place Details, not Text Search, is what every visitor's
// page load normally pays for), so typing the id straight in still has to
// work as a fallback.
function placePickerHtml(prefix, place) {
  return `
    <div class="place-picker">
      <md-outlined-text-field class="edit-field" label="Name" name="${prefix}Label" value="${place?.label ?? ''}">
        <md-icon slot="leading-icon">search</md-icon>
      </md-outlined-text-field>
      <div class="place-picker-results" hidden></div>
      ${field('Google Place ID', `${prefix}Id`, place?.id)}
    </div>`;
}

function placeFields(place) {
  return `
    <div class="edit-section-label md-typescale-label-large">Place</div>
    ${placePickerHtml('place', place)}`;
}

function readPlaceEdit(formEl, currentPlace) {
  const label = readField(formEl, 'placeLabel');
  if (!label) return null;
  return { id: readField(formEl, 'placeId') || null, label, images: currentPlace?.images ?? [] };
}

function renderPlaceResults(container, results, onPick) {
  if (!results.length) {
    container.innerHTML = `<p class="place-picker-status md-typescale-body-medium">No matches.</p>`;
    return;
  }
  container.replaceChildren(
    ...results.map((result) => {
      const button = toNode(`
        <button type="button" class="place-picker-result">
          <span class="place-picker-result-name md-typescale-body-large">${result.label}</span>
          <span class="place-picker-result-address md-typescale-body-medium">${result.address}</span>
        </button>`);
      button.addEventListener('click', () => onPick(result));
      return button;
    })
  );
}

// Live search fires this long after the last keystroke — short enough to
// feel immediate, long enough that a fast typist's early keystrokes never
// each cost their own Text Search call (see places.js's own note on why
// Text Search is the pricier of the two Places endpoints this codebase
// calls). A query shorter than this many characters doesn't search at all —
// 1-2 letters return too broad/noisy a result set to be worth the call.
const PLACE_SEARCH_DEBOUNCE_MS = 300;
const PLACE_SEARCH_MIN_LENGTH = 3;

// Wires every `.place-picker` block found under `root` — called once on the
// whole form for Activity's single Place and a Route's own From/To
// (renderEditForm/renderRouteEditForm below) and once per row for a Route
// variant's repeatable place entries (placeRowNode), since a place row is
// built and wired independently of the shared renderEditForm path (see the
// file-top Route-editing scope note). Scoping every querySelector to
// `picker` itself, rather than `root`, is what keeps this safe to call on a
// whole multi-row route form — one place row's own search field only ever
// touches that same row's own fields. `onPicked`, when given, fires after a
// result is filled in — placeRowNode's own duration lookup is the only
// caller that needs it; From/To and Activity's place have nothing further
// to do.
//
// Type-ahead, not search-then-click: results refresh live as the field is
// typed into (debounced below), sorted alphabetically. `requestId` guards
// against a slower, earlier search's response landing after a faster, later
// one's and clobbering it on screen — real risk once search fires on every
// keystroke instead of one explicit click.
function wirePlacePicker(root, { onPicked } = {}) {
  root.querySelectorAll('.place-picker').forEach((picker) => {
    // Guards against double-wiring: a meal-option row wires its own picker
    // at creation (mirroring placeRowNode), but also sits inside the whole
    // form's own wirePlacePicker(formNode) call at the end of
    // renderEditForm — without this guard that outer pass would attach a
    // second, duration-blind set of listeners on top of the row's own.
    if (picker.dataset.wired) return;
    picker.dataset.wired = 'true';
    const searchField = picker.querySelector('[name$="Label"]');
    const resultsEl = picker.querySelector('.place-picker-results');
    const idField = picker.querySelector('[name$="Id"]');

    let debounceTimer = null;
    let requestId = 0;

    const runSearch = async (query) => {
      const thisRequestId = ++requestId;
      resultsEl.hidden = false;
      resultsEl.innerHTML = `<p class="place-picker-status md-typescale-body-medium">Searching…</p>`;
      try {
        const results = await searchPlaces(query);
        if (thisRequestId !== requestId) return;
        results.sort((a, b) => a.label.localeCompare(b.label));
        renderPlaceResults(resultsEl, results, (result) => {
          searchField.value = result.label;
          idField.value = result.id;
          resultsEl.hidden = true;
          resultsEl.innerHTML = '';
          onPicked?.(result);
        });
      } catch {
        if (thisRequestId !== requestId) return;
        resultsEl.innerHTML = `<p class="place-picker-status md-typescale-body-medium">Search failed — check the Places API key/quota.</p>`;
      }
    };

    const clearResults = () => {
      requestId += 1;
      resultsEl.hidden = true;
      resultsEl.innerHTML = '';
    };

    searchField.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const query = searchField.value.trim();
      if (query.length < PLACE_SEARCH_MIN_LENGTH) { clearResults(); return; }
      debounceTimer = setTimeout(() => runSearch(query), PLACE_SEARCH_DEBOUNCE_MS);
    });
    searchField.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const query = searchField.value.trim();
      if (query.length < PLACE_SEARCH_MIN_LENGTH) return;
      clearTimeout(debounceTimer);
      runSearch(query);
    });
  });
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

// MealOption's own diningFormat has no 'None' value — every candidate
// commits to one of the six real formats, unlike the Activity-level field
// above it (which stays null until a candidate is actually promoted) — so
// this row-level select drops DINING_FORMAT_OPTIONS' leading 'None' entry.
const MEAL_OPTION_DINING_FORMAT_OPTIONS = DINING_FORMAT_OPTIONS.filter((o) => o.value);

// includedIn (data-model.html's Ref) points at either a whole Stay's base
// rate or one specific Package nested inside a Stay — flattened here into a
// single select whose value encodes both the entity kind and id
// ('stay:<id>' / 'package:<id>') as the simplest way to offer "pick which
// real thing this is covered by" without a second entity-kind select next to
// it. `stays` is every Stay in the trip (app.js's openEditPopup passes
// data.stays), not scoped to this activity's own leg — a candidate can
// reasonably point at any stay in the trip.
function includedInOptionsFor(stays) {
  const options = [{ value: '', label: 'Not included/covered' }];
  for (const stay of stays) {
    options.push({ value: `stay:${stay._id}`, label: `Included with ${stay.lodging?.name ?? stay._id}` });
    for (const pkg of stay.packages ?? []) {
      options.push({ value: `package:${pkg._id}`, label: `Package: ${pkg.name}` });
    }
  }
  return options;
}

// One MealOption candidate row — the same bordered-card-with-reorder-buttons
// shape as Route's own variantNode (see the Route-editing section below),
// just for "which breakfast" instead of "which route variant": a header row
// (Dining format select + move-up/move-down, mirroring variantNode's
// Tone/Label + reorder) over the rest of the candidate's own fields, with a
// bottom-right remove button matching .edit-place-row's own. Reordering
// matters here the same way it matters for a route's variants[] — options[0]
// is the candidate a meal row's tabs (meal-row-render.js's renderMealRow)
// show by default, and array order is tab order — so, unlike Route's
// append-only places[], this list gets real move-up/move-down controls, not
// just add/remove.
function mealOptionRowNode(option = { diningFormat: 'sit-down', place: null, includedIn: null, note: null }, stays) {
  const includedValue = option.includedIn ? `${option.includedIn.entity}:${option.includedIn.id}` : '';
  const row = toNode(`
    <div class="edit-variant edit-meal-option-row">
      <div class="edit-variant-header">
        <div class="edit-field-row">${select('Dining format', 'optionDiningFormat', option.diningFormat, MEAL_OPTION_DINING_FORMAT_OPTIONS)}</div>
        <div class="edit-variant-reorder">
          <md-icon-button class="move-option-up" type="button" aria-label="Move this candidate earlier"><md-icon>arrow_upward</md-icon></md-icon-button>
          <md-icon-button class="move-option-down" type="button" aria-label="Move this candidate later"><md-icon>arrow_downward</md-icon></md-icon-button>
        </div>
      </div>
      ${placePickerHtml('place', option.place)}
      ${select('Included in', 'optionIncludedIn', includedValue, includedInOptionsFor(stays))}
      ${field('Note (optional)', 'optionNote', option.note)}
      <md-icon-button class="remove-meal-option" type="button" aria-label="Remove this candidate"><md-icon>delete</md-icon></md-icon-button>
    </div>`);
  row.querySelector('.remove-meal-option').addEventListener('click', () => {
    const formNode = row.closest('.edit-form');
    row.remove();
    updateMealOptionsToggle(formNode);
  });
  // Same swap-with-sibling move as variantNode's own move-up/move-down — a
  // no-op at either end of the list.
  row.querySelector('.move-option-up').addEventListener('click', () => {
    const prev = row.previousElementSibling;
    if (prev) row.parentElement.insertBefore(row, prev);
  });
  row.querySelector('.move-option-down').addEventListener('click', () => {
    const next = row.nextElementSibling;
    if (next) row.parentElement.insertBefore(next, row);
  });
  // Self-wired at creation (placeRowNode's own move) rather than relying on
  // renderEditForm's later whole-form wirePlacePicker(formNode) call — that
  // outer pass still runs (for the Activity's own top-level Place field) and
  // would otherwise double-wire this row too, hence wirePlacePicker's own
  // dataset.wired guard.
  wirePlacePicker(row);
  return row;
}

function readMealOptionRow(rowEl) {
  const includedRaw = readField(rowEl, 'optionIncludedIn');
  const [entity, id] = includedRaw ? includedRaw.split(':') : [null, null];
  return {
    diningFormat: readField(rowEl, 'optionDiningFormat') || 'sit-down',
    place: readPlaceEdit(rowEl, null),
    includedIn: entity && id ? { entity, id } : null,
    note: readField(rowEl, 'optionNote') || null,
  };
}

// The Place/Dining format fields above the candidate list (wrapped
// .decided-meal-fields in activityFields below) only make sense while this
// meal is actually decided — once even one candidate exists, they're dead
// weight applyActivityEdit is about to null out on Save anyway (see that
// function's own note), so they hide live rather than sitting there
// misleadingly editable. Called after every add/remove, and once up front by
// renderEditForm for whatever candidates the entity already had.
function updateMealOptionsToggle(formNode) {
  if (!formNode) return;
  const hasOptions = !!formNode.querySelector('.edit-meal-option-row');
  formNode.querySelectorAll('.decided-meal-fields').forEach((el) => { el.hidden = hasOptions; });
}

// Starts' date field carries activity.date when there's no startAt — the
// only way a fuzzy-timeLabel activity's date ever reaches the form at all
// (see trip-model.js's Activity.date and dateTimeFieldRow's own note above).
// A trailing bare 'YYYY-MM-DD' with nothing after it is exactly what
// dateTimeFieldRow expects: a date with its time left blank.
function activityFields(activity, { tripTravelers } = {}) {
  const startsValue = activity.startAt ?? (activity.date ? activity.date : null);
  return `
    ${dateTimeFieldRow('starts', 'Starts date', 'Starts time', startsValue)}
    ${dateTimeFieldRow('ends', 'Ends date', 'Ends time', activity.endAt)}
    ${select('Fuzzy time (used only when Starts has a date but no time, and Ends is blank)', 'timeLabel', activity.timeLabel, TIME_LABEL_OPTIONS)}
    <div class="decided-meal-fields">${placeFields(activity.place)}</div>
    ${field('Description', 'text', activity.text)}
    ${select('Status', 'status', activity.status, STATUS_OPTIONS)}
    ${select('Priority', 'priority', activity.priority, PRIORITY_OPTIONS)}
    ${select('Meal type', 'mealType', activity.mealType, MEAL_TYPE_OPTIONS)}
    <div class="decided-meal-fields">${select('Dining format', 'diningFormat', activity.diningFormat, DINING_FORMAT_OPTIONS)}</div>
    <div class="edit-section-label md-typescale-label-large">Meal candidates — leave empty to keep the single decided place/dining format above; add a few to leave this meal undecided among them instead</div>
    <div class="edit-variant-list edit-meal-option-list"></div>
    <md-text-button class="add-meal-option" type="button">Add candidate</md-text-button>
    ${travelersFields(activity, tripTravelers)}
    ${bookingFields(activity.booking)}`;
}

function stayFields(stay) {
  return `
    ${field('Lodging name', 'lodgingName', stay.lodging?.name)}
    ${dateTimeFieldRow('checkIn', 'Check-in date', 'Check-in time', stay.checkInAt)}
    ${dateTimeFieldRow('checkOut', 'Check-out date', 'Check-out time', stay.checkOutAt)}
    ${bookingFields(stay.booking)}`;
}

// A Route (routes.json) is reusable reference data, not one of this file's
// three line-item kinds — see the file-top scope note — so a Transit only
// ever *points at* one via routeId/routeVariant. The variant select's own
// options depend on which route is currently chosen, so it starts out
// scoped to whatever route the Transit already has and gets repopulated
// live when routeId changes (see renderEditForm's routeId listener).
function routeSelectOptions(routes) {
  const options = routes.map((r) => ({ value: r._id, label: `${r.from.label} → ${r.to.label}` }));
  options.sort((a, b) => a.label.localeCompare(b.label));
  return [{ value: '', label: 'None' }, ...options];
}

function routeVariantOptionsFor(route) {
  return route ? route.variants.map((v) => ({ value: v.tone, label: v.label })) : [{ value: '', label: '—' }];
}

// A routed Transit's Arrives date/time are never authored — trip-model.js's
// resolveTransitRoute walks the selected route variant's own drive times
// forward from Departs (folding in any real in-transit Activity along the
// way), and that walked result is what every reader of the Transit's
// arrival actually sees, live, not whatever's typed here. So the raw
// Arrives fields only matter — and only show — once no route is picked
// (routeId blank): a mode with no route to walk (a flight, a ferry, a drive
// with nowhere named) still needs a real authored arrival, since nothing
// else could ever produce one. Toggled live by the routeId change listener
// in renderEditForm, same "hide what a route now makes moot" move as that
// listener's own route-variant repopulation.
function transitFields(transit, { routes = [] } = {}) {
  const selectedRoute = routes.find((r) => r._id === transit.routeId) ?? null;
  const hasRoute = !!transit.routeId;
  return `
    <div class="edit-field-row">
      ${field('From', 'fromLabel', transit.from.label)}
      ${field('To', 'toLabel', transit.to.label)}
    </div>
    ${dateTimeFieldRow('departs', 'Departs date', 'Departs time', transit.departsAt)}
    <div class="arrives-field-row"${hasRoute ? ' hidden' : ''}>
      ${dateTimeFieldRow('arrives', 'Arrives date', 'Arrives time', transit.arrivesAt)}
    </div>
    <p class="edit-computed-hint md-typescale-body-small"${hasRoute ? '' : ' hidden'}>Arrival is computed from the selected route's own drive times, updated live as it's picked.</p>
    ${select('Route', 'routeId', transit.routeId, routeSelectOptions(routes))}
    ${select('Route variant', 'routeVariant', transit.routeVariant, routeVariantOptionsFor(selectedRoute))}
    ${bookingFields(transit.booking)}`;
}

// Which "start" date field auto-shifts which "end" date field when picked
// (renderEditForm's date-picker-field wiring below) — every start/end
// dateTimeFieldRow pair this form ever builds, keyed by the start field's
// own `name`. Picking the end date directly is never affected the other way
// — only moving the start carries the end along with it.
const PAIRED_END_DATE_FIELD = {
  startsDate: 'endsDate',
  checkInDate: 'checkOutDate',
  departsDate: 'arrivesDate',
};

function daysBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

// Moving the start date carries the end date along with it, rather than
// leaving a stale (or missing) end date behind: with no end date set yet,
// the end just follows the start to the same day; with one already set, the
// gap that already existed between the old start and old end is preserved
// by re-applying it to the new start — so dragging a multi-night Stay's
// check-in earlier or later keeps its length, instead of only moving one
// end of it. A previously-blank start (oldStart null) has no real gap to
// preserve, so the end field just follows the new start in that case too.
function shiftPairedEndDate(formNode, endFieldName, oldStart, newStart) {
  const endField = formNode.querySelector(`[name="${endFieldName}"]`);
  if (!endField) return;
  const oldEnd = endField.dataset.value || null;
  const newEnd = oldEnd && oldStart ? addDaysStr(newStart, daysBetween(oldStart, oldEnd)) : newStart;
  setPickerFieldValue(endField, newEnd, formatDateLabel(newEnd));
}

export const EDIT_ENTITY_LABEL = { activity: 'Edit activity', stay: 'Edit stay', transit: 'Edit transit', route: 'Edit route' };

// `context` always carries openDatePicker/openTimePicker (app.js's dialog
// controllers — see dateTimeFieldRow's own note above for why these live as
// two pseudo-fields rather than a native input) for kinds: 'activity' |
// 'stay' | 'transit'; also { tripTravelers: Trip.travelers, stays: data.stays }
// for 'activity' (stays feeds mealOptionRowNode's own Included-in select),
// or { routes: routes.json } for 'transit' (see app.js's callers). Route
// builds its own form directly (see renderRouteEditForm below) rather than
// going through this shared string-template path, and needs neither.
export function renderEditForm(kind, entity, context) {
  if (kind === 'route') return renderRouteEditForm(entity);
  const html = kind === 'activity' ? activityFields(entity, context) : kind === 'stay' ? stayFields(entity) : transitFields(entity, context);
  const formNode = toNode(`<div class="edit-form" data-kind="${kind}">${html}</div>`);

  formNode.querySelectorAll('.date-picker-field').forEach((fieldEl) => {
    const open = () =>
      context.openDatePicker(fieldEl.dataset.value || null, fieldEl.dataset.label, (date) => {
        const oldStart = fieldEl.dataset.value || null;
        setPickerFieldValue(fieldEl, date, formatDateLabel(date));
        const endFieldName = PAIRED_END_DATE_FIELD[fieldEl.getAttribute('name')];
        if (endFieldName) shiftPairedEndDate(formNode, endFieldName, oldStart, date);
      });
    fieldEl.addEventListener('click', open);
    fieldEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
    });
  });

  // The trailing clear button is a sibling of the time field's own click
  // target (same "never nested inside the row's own interactive element"
  // move render-shared.js's renderEditButton already makes), so clicking it
  // stops the click from also bubbling into the time-field-open listener
  // below — otherwise clearing the field would immediately reopen the picker
  // that just cleared it.
  formNode.querySelectorAll('.time-picker-field').forEach((fieldEl) => {
    const clearButton = fieldEl.querySelector('.clear-time-field');
    const open = () =>
      context.openTimePicker(fieldEl.dataset.value || null, fieldEl.dataset.label, (hhmm) => {
        setPickerFieldValue(fieldEl, hhmm, formatClockTime(hhmm));
        clearButton.hidden = !hhmm;
      });
    fieldEl.addEventListener('click', open);
    fieldEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
    });
    clearButton.addEventListener('click', (event) => {
      event.stopPropagation();
      setPickerFieldValue(fieldEl, '', '');
      clearButton.hidden = true;
    });
  });

  const routeSelect = formNode.querySelector('[name="routeId"]');
  const variantSelect = formNode.querySelector('[name="routeVariant"]');
  if (routeSelect && variantSelect) {
    const arrivesRow = formNode.querySelector('.arrives-field-row');
    const computedHint = formNode.querySelector('.edit-computed-hint');
    routeSelect.addEventListener('change', () => {
      const route = (context?.routes ?? []).find((r) => r._id === routeSelect.value) ?? null;
      setSelectOptions(variantSelect, routeVariantOptionsFor(route), route?.variants[0]?.tone ?? '');
      const hasRoute = !!route;
      if (arrivesRow) arrivesRow.hidden = hasRoute;
      if (computedHint) computedHint.hidden = !hasRoute;
    });
  }

  // Populates this Activity's existing options[] as candidate rows and wires
  // "Add candidate" — the same append-a-fresh-row move as Route's own
  // add-place/add-variant buttons — before the whole-form wirePlacePicker
  // pass below, so each pre-existing row's own place-picker is already
  // self-wired (mealOptionRowNode) and skipped by that pass's dataset.wired
  // guard rather than double-wired.
  if (kind === 'activity') {
    const optionList = formNode.querySelector('.edit-meal-option-list');
    const stays = context.stays ?? [];
    (entity.options ?? []).forEach((option) => optionList.appendChild(mealOptionRowNode(option, stays)));
    formNode.querySelector('.add-meal-option').addEventListener('click', () => {
      optionList.appendChild(mealOptionRowNode(undefined, stays));
      updateMealOptionsToggle(formNode);
    });
    updateMealOptionsToggle(formNode);
  }
  wirePlacePicker(formNode);
  return formNode;
}

function readField(formEl, name) {
  return formEl.querySelector(`[name="${name}"]`)?.value.trim() ?? '';
}

// Reads a dateTimeFieldRow's pair back into one 'YYYY-MM-DDTHH:MM' timestamp
// — null when either half is still blank, since a lone date or a lone time
// isn't a real timestamp. Activity's Starts is the one place a lone date
// still means something (its own fuzzy-time case below), so it reads
// startsDate separately rather than going through this helper.
function readDateTimePair(formEl, prefix) {
  const date = readDateField(formEl, `${prefix}Date`);
  const time = readTimeField(formEl, `${prefix}Time`);
  return date && time ? `${date}T${time}` : null;
}

// Every Activity must resolve to both a real sort position and a real date
// — startAt, endAt, or a Starts date paired with a fuzzy timeLabel (see
// trip-model.js's validateActivityTiming/Activity.date). An exact
// Starts/Ends always wins over the fuzzy time select when both are given;
// the fuzzy date+timeLabel pair only actually gets saved when neither exact
// timestamp is present.
function applyActivityEdit(activity, formEl) {
  const text = readField(formEl, 'text');
  if (!text) return 'Needs a description.';
  const startsDate = readDateField(formEl, 'startsDate');
  const startAt = readDateTimePair(formEl, 'starts');
  const endAt = readDateTimePair(formEl, 'ends');
  const timeLabel = readField(formEl, 'timeLabel') || null;
  activity.text = text;
  activity.status = readField(formEl, 'status') || activity.status;
  activity.priority = readField(formEl, 'priority') || null;
  if (startAt || endAt) {
    activity.startAt = startAt;
    activity.endAt = endAt;
    activity.timeLabel = null;
    activity.date = null;
  } else if (startsDate && timeLabel) {
    activity.startAt = null;
    activity.endAt = null;
    activity.date = startsDate;
    activity.timeLabel = timeLabel;
  } else {
    return 'Needs a start/end time, or a Starts date with a fuzzy time.';
  }
  activity.mealType = readField(formEl, 'mealType') || null;
  // A non-empty candidate list always wins: options and the Activity's own
  // place/diningFormat/includedIn are mutually exclusive (see this file's
  // top-of-file note on MealOption), so any candidates present here mean
  // this meal is still genuinely undecided, and the decided single-answer
  // fields — whatever .decided-meal-fields' own inputs hold, now hidden and
  // moot — get cleared back to null rather than saved alongside options.
  const optionRows = [...formEl.querySelectorAll('.edit-meal-option-row')];
  if (optionRows.length) {
    activity.options = optionRows.map(readMealOptionRow);
    activity.place = null;
    activity.diningFormat = null;
    activity.includedIn = null;
  } else {
    activity.options = null;
    activity.place = readPlaceEdit(formEl, activity.place);
    activity.diningFormat = readField(formEl, 'diningFormat') || null;
  }
  activity.travelers = readTravelersEdit(formEl);
  activity.booking = readBookingEdit(formEl, activity.booking);
  return null;
}

function applyStayEdit(stay, formEl) {
  const checkInAt = readDateTimePair(formEl, 'checkIn');
  const checkOutAt = readDateTimePair(formEl, 'checkOut');
  if (!checkInAt || !checkOutAt) return 'Needs both check-in and check-out times.';
  stay.checkInAt = checkInAt;
  stay.checkOutAt = checkOutAt;
  if (stay.lodging) stay.lodging.name = readField(formEl, 'lodgingName') || stay.lodging.name;
  stay.booking = readBookingEdit(formEl, stay.booking);
  return null;
}

// A routed Transit's Arrives is never authored (see transitFields' own
// note) — it's walked live from Departs plus the selected route variant's
// own drive times, so the field simply stays null in the data rather than
// carrying a guess nothing ever reads. Only a Transit with no route picked
// still needs a real one, since nothing else could produce an arrival for it.
function applyTransitEdit(transit, formEl) {
  const departsAt = readDateTimePair(formEl, 'departs');
  const routeId = readField(formEl, 'routeId') || null;
  const arrivesAt = routeId ? null : readDateTimePair(formEl, 'arrives');
  if (!departsAt || (!routeId && !arrivesAt)) return 'Needs both a departure and arrival time.';
  transit.departsAt = departsAt;
  transit.arrivesAt = arrivesAt;
  transit.from.label = readField(formEl, 'fromLabel') || transit.from.label;
  transit.to.label = readField(formEl, 'toLabel') || transit.to.label;
  transit.routeId = routeId;
  transit.routeVariant = routeId ? readField(formEl, 'routeVariant') || null : null;
  transit.booking = readBookingEdit(formEl, transit.booking);
  return null;
}

// ---------- Route editing — routes.json is reference data (see the file-top
// scope note), not one of this file's three line-item kinds, so it gets its
// own DOM-building path instead of the string-template + toNode() pattern
// above: a route's variants[] and each variant's places[] are both open-ended
// arrays a user can add to or remove from, which a static HTML string can't
// express — each block below is built and wired (including its own remove
// button) as a live element instead, the same "attach a listener that closes
// over its own node" move renderEditForm's clear-date-field buttons already
// use, just applied to whole rows instead of one button. ----------

const ROUTE_TONE_OPTIONS = [
  { value: 'direct', label: 'Direct' },
  { value: 'scenic', label: 'Scenic' },
];

// A route is an ordered sequence of places (variant.places[]); each entry's
// kind is never optional and never a third value — see data-model.html's
// Route section: 'waypoint' is a real, individually-resolvable stop worth
// calling out; 'via' exists purely to steer Google's Directions API off its
// default path (a fork, a cutoff) without stopping there, and still resolves
// to one real geo-point, never the whole highway a plain named-highway entry
// used to (mis)point at.
const PLACE_KIND_OPTIONS = [
  { value: 'waypoint', label: 'Waypoint — a real stop worth calling out' },
  { value: 'via', label: 'Via — steers Directions onto the right road, no stop' },
];

// The Place ID a new/re-picked place entry should measure drive time *from* —
// places[].durationMinutes is defined (data-model.html) as the drive time
// from whichever place, or the route's own Depart/From, came immediately
// before it. Since place rows are append-only with no reorder (see this
// function's own note below), "immediately before" is always exactly the
// previous `.edit-place-row` sibling in the same variant's place list — or,
// for a variant's first entry, the route form's own From place id. Returns
// null (silently skipping the lookup — see placeRowNode) when that anchor
// point has no id of its own, e.g. a From that's still just a whole-city
// label with no pinned Place.
function previousStopPlaceId(row) {
  const prevRow = row.previousElementSibling;
  if (prevRow?.classList.contains('edit-place-row')) return readField(prevRow, 'placeId') || null;
  return row.closest('.edit-form')?.querySelector('[name="fromId"]')?.value || null;
}

// variant.finalLegMinutes is the one duration a route's place chain never
// covers on its own — the drive time from whichever stop comes last (the
// variant's last place, or the route's own From when it has none) to the
// route's actual To (data-model.html: "completes the chain places[] leaves
// open" — without it, trip-model.js's stageTimesForVariant has no way to
// walk all the way to a real arrival). Re-run after anything that could move
// "whichever stop comes last" — a place entry picked, added, or removed, or
// the route's own From/To repicked — same silent-skip-on-no-anchor,
// silent-leave-on-failure behavior previousStopPlaceId's own callers already
// lean on.
async function refreshFinalLeg(variantEl) {
  const formEl = variantEl.closest('.edit-form');
  const toId = formEl?.querySelector('[name="toId"]')?.value || null;
  if (!toId) return;
  const lastStop = variantEl.querySelector('.edit-place-list')?.lastElementChild;
  const originId = lastStop ? readField(lastStop, 'placeId') || null : formEl?.querySelector('[name="fromId"]')?.value || null;
  if (!originId) return;
  try {
    const minutes = await lookupDriveMinutes(originId, toId);
    const field = variantEl.querySelector('[name="finalLegMinutes"]');
    if (minutes != null && field) field.value = minutes;
  } catch {
    // leave the field alone — still hand-editable, same fallback as everywhere else.
  }
}

// One place entry (a waypoint or a via). places[] order is the authoritative
// stage sequence — trip-model.js's stageTimesForVariant walks it start to
// end summing durationMinutes to place each stage in time — so this is
// deliberately an append-only list with a per-row delete button (matching
// the rest of this file's "no reorder UI, no confirmation" editing style)
// rather than a reorderable one; fixing a mis-ordered entry today means
// deleting and re-adding it in the right spot, the same "just redo it" cost
// a mis-ordered row anywhere else in this editor already has.
function placeRowNode(entry = { kind: 'waypoint', place: {}, durationMinutes: 0 }) {
  const row = toNode(`
    <div class="edit-place-row">
      ${select('Kind', 'placeKind', entry.kind, PLACE_KIND_OPTIONS)}
      ${placePickerHtml('place', entry.place)}
      <div class="edit-field-row">
        ${field('Minutes from previous stop', 'placeDuration', entry.durationMinutes, 'number')}
        ${field('Note (optional)', 'placeNote', entry.note)}
      </div>
      <md-icon-button class="remove-place-row" aria-label="Remove this stage"><md-icon>delete</md-icon></md-icon-button>
    </div>`);
  row.querySelector('.remove-place-row').addEventListener('click', () => {
    const variantEl = row.closest('.edit-variant');
    row.remove();
    if (variantEl) refreshFinalLeg(variantEl);
  });
  // Picking a place is exactly the moment a real destination id exists to
  // measure toward, so the lookup runs from here rather than off a manually
  // typed Place ID — a hand-typed id already means the user is bypassing
  // search on purpose, not necessarily pointing at a place worth trusting an
  // API round-trip to. Failure (API not enabled, no drivable route, offline)
  // just leaves the duration field exactly as it was — still hand-editable,
  // the same fallback the place picker itself already leans on. Picking this
  // row's place can also make it the variant's new *last* stop (if it's the
  // last place row), so the variant's own finalLegMinutes gets re-measured too.
  wirePlacePicker(row, {
    onPicked: async (result) => {
      const originId = previousStopPlaceId(row);
      if (originId) {
        try {
          const minutes = await lookupDriveMinutes(originId, result.id);
          if (minutes != null) row.querySelector('[name="placeDuration"]').value = minutes;
        } catch {
          // leave the duration field alone — see the comment above.
        }
      }
      const variantEl = row.closest('.edit-variant');
      if (variantEl) refreshFinalLeg(variantEl);
    },
  });
  return row;
}

function readPlaceRow(rowEl) {
  const durationMinutes = Number(readField(rowEl, 'placeDuration'));
  const note = readField(rowEl, 'placeNote');
  return {
    kind: readField(rowEl, 'placeKind') || 'waypoint',
    place: { id: readField(rowEl, 'placeId') || null, label: readField(rowEl, 'placeLabel') },
    durationMinutes: Number.isFinite(durationMinutes) ? durationMinutes : -1,
    ...(note ? { note } : {}),
  };
}

// One route variant (a "direct"/"scenic" alternative) — its own tone/label
// fields, its own ordered sequence of places, and its own finalLegMinutes
// (the drive time places[] alone never covers: from the last entry — a
// waypoint or a via — or the route's own From when there are none — to the
// route's actual To; see data-model.html and refreshFinalLeg above). A
// route with zero variants is rejected at Save (see applyRouteEdit) since a
// Transit pointing at this route always needs a real variant to select.
//
// Unlike placeRowNode's places[] (still append-only — see that function's
// own note), variants[] order is user-reorderable via the move-up/move-down
// buttons below: it's not just cosmetic, since day-render.js's
// renderRouteVariantTabs and trip-model.js's dayFullRouteStops both read
// route.variants in its own array order to decide which tab renders first
// (and, before this, which tab a reader lands on by default).
function variantNode(variant = { tone: 'direct', label: '', places: [], finalLegMinutes: 0 }) {
  const node = toNode(`
    <div class="edit-variant">
      <div class="edit-variant-header">
        <div class="edit-field-row">
          ${select('Tone', 'variantTone', variant.tone, ROUTE_TONE_OPTIONS)}
          ${field('Label', 'variantLabel', variant.label)}
        </div>
        <div class="edit-variant-reorder">
          <md-icon-button class="move-variant-up" type="button" aria-label="Move this variant earlier"><md-icon>arrow_upward</md-icon></md-icon-button>
          <md-icon-button class="move-variant-down" type="button" aria-label="Move this variant later"><md-icon>arrow_downward</md-icon></md-icon-button>
        </div>
      </div>
      <div class="edit-section-label md-typescale-label-large">Places</div>
      <div class="edit-place-list"></div>
      <div class="edit-variant-actions">
        <md-text-button class="add-route-place" type="button">Add place</md-text-button>
        <md-text-button class="remove-variant" type="button">Remove this variant</md-text-button>
      </div>
      ${field('Final leg — minutes from the last stop to the route’s To', 'finalLegMinutes', variant.finalLegMinutes, 'number')}
    </div>`);
  const placeList = node.querySelector('.edit-place-list');
  (variant.places ?? []).forEach((p) => placeList.appendChild(placeRowNode(p)));
  node.querySelector('.add-route-place').addEventListener('click', () => placeList.appendChild(placeRowNode()));
  node.querySelector('.remove-variant').addEventListener('click', () => node.remove());
  // Swap this whole variant card with whichever sibling it's moving past —
  // a no-op at either end of the list, since previousElementSibling/
  // nextElementSibling is simply null there.
  node.querySelector('.move-variant-up').addEventListener('click', () => {
    const prev = node.previousElementSibling;
    if (prev) node.parentElement.insertBefore(node, prev);
  });
  node.querySelector('.move-variant-down').addEventListener('click', () => {
    const next = node.nextElementSibling;
    if (next) node.parentElement.insertBefore(next, node);
  });
  return node;
}

// From/To get the same search-or-type place picker Activity's own place and
// each route place entry use — a plain label-only pair before this could
// never carry a Place ID at all, which meant a route's first place entry
// could never look its own duration up (see previousStopPlaceId above):
// there was no resolvable anchor point to measure from. The id stays
// optional, same as the read-only data today (data-model.html: from/to are
// "often a whole city/region" with no pinned Place), so leaving it blank is
// still valid — it just means the first place entry's duration has to be
// hand-typed, the same fallback every place picker already has.
function renderRouteEditForm(route) {
  const formNode = toNode(`
    <div class="edit-form" data-kind="route">
      <div class="route-endpoints">
        <div class="edit-section-label md-typescale-label-large">From</div>
        ${placePickerHtml('from', route.from)}
        <div class="edit-section-label md-typescale-label-large">To</div>
        ${placePickerHtml('to', route.to)}
      </div>
      <div class="edit-section-label md-typescale-label-large">Variants</div>
      <div class="edit-variant-list"></div>
      <md-text-button id="add-route-variant" type="button">Add variant</md-text-button>
    </div>`);
  const variantList = formNode.querySelector('.edit-variant-list');
  (route.variants ?? []).forEach((v) => variantList.appendChild(variantNode(v)));
  formNode.querySelector('#add-route-variant').addEventListener('click', () => variantList.appendChild(variantNode()));
  // Scoped to .route-endpoints, not the whole formNode — every place row's
  // own place picker (placeRowNode) is already wired individually as each
  // row is built, with its own onPicked duration lookup; wiring the whole
  // form here too would attach a second, duration-blind set of listeners to
  // those same rows and double every search request. Repicking either From
  // or To can change every variant's finalLegMinutes anchor (From when a
  // variant has no places of its own, To always), so all of them get
  // refreshed here.
  wirePlacePicker(formNode.querySelector('.route-endpoints'), {
    onPicked: () => formNode.querySelectorAll('.edit-variant').forEach(refreshFinalLeg),
  });
  return formNode;
}

// Mirrors trip-model.js's own validateRoutes so a bad route fails here, in
// the form, rather than silently at the next buildTripView (which throws
// rather than degrading, by design — see validateRoutes's own comment).
function applyRouteEdit(route, formEl) {
  const fromLabel = readField(formEl, 'fromLabel');
  const toLabel = readField(formEl, 'toLabel');
  if (!fromLabel || !toLabel) return 'Needs both a From and To label.';
  const variantEls = [...formEl.querySelectorAll('.edit-variant')];
  if (!variantEls.length) return 'Needs at least one variant.';
  const variants = variantEls.map((variantEl) => {
    const finalLegMinutes = Number(readField(variantEl, 'finalLegMinutes'));
    return {
      tone: readField(variantEl, 'variantTone') || 'direct',
      label: readField(variantEl, 'variantLabel'),
      places: [...variantEl.querySelectorAll('.edit-place-row')].map(readPlaceRow),
      finalLegMinutes: Number.isFinite(finalLegMinutes) ? finalLegMinutes : -1,
    };
  });
  for (const variant of variants) {
    if (!variant.label) return 'Every variant needs a label.';
    for (const place of variant.places) {
      if (!place.place.label) return 'Every place entry needs a place name.';
      if (!place.place.id) return 'Every place entry needs a Google Place ID.';
      if (place.durationMinutes < 0) return 'Every place entry needs a duration of zero or more minutes.';
    }
    if (variant.finalLegMinutes < 0) return 'Every variant needs a final-leg duration of zero or more minutes.';
  }
  route.from = { id: readField(formEl, 'fromId') || null, label: fromLabel };
  route.to = { id: readField(formEl, 'toId') || null, label: toLabel };
  route.variants = variants;
  return null;
}

// Mutates `entity` in place and returns null on success, or a message to
// show inline (see the per-kind functions above) without closing the form.
export function applyEdit(kind, entity, formEl) {
  if (kind === 'activity') return applyActivityEdit(entity, formEl);
  if (kind === 'stay') return applyStayEdit(entity, formEl);
  if (kind === 'route') return applyRouteEdit(entity, formEl);
  return applyTransitEdit(entity, formEl);
}
