import '@material/web/all.js';
import { styles as typescaleStyles } from '@material/web/typography/md-typescale-styles.js';
import './side-sheet.js';
import { loadTripsIndex, loadTripData, buildTripView, deriveRouteStops, formatTripDateChip, tripDayCount } from './trip-model.js';
import { renderLegCard, renderDayBlock, renderLegDialogBody, renderActivityDetailBody, renderDayMapSheetBody, activityDetailTitle, placeTypeIcon, syncMealRow, activeMealOptions, firstImage, wireScenarioFollowers } from './day-render.js';
import { hydratePlaceDetails } from './places.js';
import { renderDatePicker } from './date-picker.js';

document.adoptedStyleSheets.push(typescaleStyles.styleSheet);

// ---------- routing: '#/' is the trips list; '#/<slug>' opens a trip's main
// page (hero + the sticky day list). Elements and listeners below are wired
// once at module scope and read `view`/`currentSlug` at click time, so the
// same wiring keeps working across trip switches. ----------

const tripsHome = document.querySelector('#trips-home');
const tripsListEl = document.querySelector('#trips-list');
const tripPage = document.querySelector('#trip-page');

let view = null;
let currentSlug = null;

// ---------- drill-down: Overview's Leg cards → Leg dialog → a day's inline
// block (also reached directly from the date picker) → Activity side sheet.
// Opening a dialog/sheet closes whichever one opened it — md-dialog renders
// in the browser's native top layer, which would otherwise always paint
// above our hand-positioned side sheet regardless of z-index, so a dialog
// and the side sheet never stack. ----------

const sideSheet = document.querySelector('detail-side-sheet');
const dayListEl = document.querySelector('#day-list');
const legDialog = document.querySelector('#leg-dialog');
const legDialogTitle = document.querySelector('#leg-dialog-title');
const legDialogBody = document.querySelector('#leg-dialog-body');
const datePickerDialog = document.querySelector('#date-picker-dialog');
const datePickerBody = document.querySelector('#date-picker-body');

// Every day's full detail is already rendered inline on the page (see
// renderDayBlock in day-render.js), so "jumping" to a day is just scrolling
// its block to the top of the viewport, closing whatever dialog/sheet was
// used to get there.
function scrollToDay(date) {
  legDialog.close();
  datePickerDialog.close();
  sideSheet.close();
  document.getElementById(`day-${date}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openLegDialog(legId) {
  const summary = view.legSummaries.find((s) => s.leg._id === legId);
  if (!summary) return;
  sideSheet.close();
  legDialogTitle.textContent = summary.leg.name;
  legDialogBody.replaceChildren(renderLegDialogBody(summary));
  legDialog.show();
}

// A meal row's header can only open whichever candidate its own tabs
// currently have selected (see day-render.js's renderMealRow/syncMealRow) —
// read that same selection back off the row's DOM rather than always
// defaulting to the first option.
function selectedMealOption(activity, day, rowEl) {
  const options = activeMealOptions(activity, day);
  const tabsEl = rowEl.querySelector('.meal-row-tabs');
  return options[tabsEl ? tabsEl.activeTabIndex : 0] ?? null;
}

async function openActivity(activity, selectedOption = null) {
  const place = selectedOption ? selectedOption.place : activity.place;
  sideSheet.open(activityDetailTitle(activity, selectedOption), renderActivityDetailBody(activity, selectedOption));
  if (!place) return;
  const details = await hydratePlaceDetails(sideSheet.querySelector('.place-panel'), place);
  // Meal options already show their dining-format icon (known synchronously,
  // and more meaningful than the venue's raw category) — only a plain place
  // starts on the generic default icon that needs swapping in once hydrated.
  if (details && !selectedOption) {
    const iconEl = sideSheet.querySelector('.detail-title-icon');
    if (iconEl) iconEl.textContent = placeTypeIcon(details);
  }
}

dayListEl.addEventListener('click', (event) => {
  const el = event.target.closest('[data-activity-id]');
  if (!el) return;
  const activity = view.activitiesById.get(el.dataset.activityId);
  const mealRow = el.closest('.meal-row');
  const selectedOption = mealRow ? selectedMealOption(activity, view.days.find((d) => d.date === activity.date), mealRow) : null;
  openActivity(activity, selectedOption);
});

// The day-block-header's map button (day-render.js's renderDayBlock) opens
// the same side sheet an activity row does, just with a computed map instead
// of a place's details — a separate listener since it's a separate concern
// from the activity click handler above, not a variant of it.
dayListEl.addEventListener('click', (event) => {
  const mapButton = event.target.closest('[data-map-date]');
  if (!mapButton) return;
  const day = view.days.find((d) => d.date === mapButton.dataset.mapDate);
  if (!day) return;
  sideSheet.open(`Map — ${day.dateLabel}`, renderDayMapSheetBody(day));
});

// A meal row's own md-tabs (see day-render.js's renderMealRow) switches which
// MealOption candidate that row displays — a separate concern from the click
// listener above, which only opens the side sheet via the row's header button.
dayListEl.addEventListener('change', (event) => {
  const tabsEl = event.target.closest('.meal-row-tabs');
  if (!tabsEl) return;
  const activityId = tabsEl.closest('.meal-row').querySelector('[data-activity-id]').dataset.activityId;
  const activity = view.activitiesById.get(activityId);
  const day = view.days.find((d) => d.date === activity.date);
  syncMealRow(activity, day, tabsEl);
});

legDialogBody.addEventListener('click', (event) => {
  const el = event.target.closest('[data-day-id]');
  if (el) scrollToDay(el.dataset.dayId);
});

document.querySelector('#leg-dialog-close').addEventListener('click', () => legDialog.close());
document.querySelector('#back-to-trips').addEventListener('click', () => { location.hash = '#/'; });

// ---------- Overview's Leg cards, the day list, and the "Jump to a day"
// date picker — all rebuilt from the current trip's `view` on each visit ----------

const legsGrid = document.querySelector('#legs-grid');

// ---------- date picker: month-at-a-time state (pickerYear/pickerMonth) lives
// here, not in date-picker.js, since renderDatePicker is a pure render
// function like everything in day-render.js — only the caller knows which
// month is currently showing. ----------

let pickerYear = null;
let pickerMonth = null;

function renderPicker() {
  datePickerBody.replaceChildren(renderDatePicker(view.days, view.trip.startDate, view.trip.endDate, pickerYear, pickerMonth));
}

function openDatePicker() {
  sideSheet.close();
  const [y, m] = view.trip.startDate.split('-').map(Number);
  pickerYear = y;
  pickerMonth = m - 1;
  renderPicker();
  datePickerDialog.show();
}

datePickerBody.addEventListener('click', (event) => {
  if (event.target.closest('.date-picker-prev')) {
    pickerMonth -= 1;
    if (pickerMonth < 0) { pickerMonth = 11; pickerYear -= 1; }
    renderPicker();
    return;
  }
  if (event.target.closest('.date-picker-next')) {
    pickerMonth += 1;
    if (pickerMonth > 11) { pickerMonth = 0; pickerYear += 1; }
    renderPicker();
    return;
  }
  const cell = event.target.closest('.date-picker-cell');
  if (cell && !cell.disabled) scrollToDay(cell.dataset.date);
});

document.querySelector('#date-picker-open').addEventListener('click', openDatePicker);
document.querySelector('#trip-date-chip').addEventListener('click', openDatePicker);
document.querySelector('#date-picker-close').addEventListener('click', () => datePickerDialog.close());

// ---------- loading a trip into the (single, reused) trip page ----------

async function openTrip(slug) {
  currentSlug = slug;
  const data = await loadTripData(slug);
  view = buildTripView(data);
  document.title = view.trip.name;

  document.querySelector('#trip-title').textContent = view.trip.name;
  document.querySelector('#trip-summary').textContent = view.trip.summary ?? '';
  document.querySelector('#trip-date-chip').label = formatTripDateChip(view.trip, view.days.length);

  const heroImage = firstImage(view.trip);
  const heroImageEl = document.querySelector('#trip-hero-image');
  heroImageEl.hidden = !heroImage;
  heroImageEl.style.backgroundImage = heroImage ? `url("${heroImage.uri}")` : '';
  heroImageEl.title = heroImage?.credit ?? '';
  document.querySelector('#trip-hero').classList.toggle('has-hero-image', !!heroImage);

  const routeStops = deriveRouteStops(view.days);
  document.querySelector('.route').replaceChildren(
    ...routeStops.map((stop) => {
      const li = document.createElement('li');
      li.textContent = stop;
      return li;
    })
  );
  document.querySelector('#route-stop-count').textContent = ` · ${routeStops.length} stops`;

  document.querySelector('#travelers-row').innerHTML = view.trip.travelers
    .map((t) => `<md-suggestion-chip label="${t.name}${t.age ? ` · ${t.age}` : ''}"></md-suggestion-chip>`)
    .join('');

  legsGrid.replaceChildren(...view.legSummaries.map((summary) => {
    const card = renderLegCard(summary);
    card.addEventListener('click', () => openLegDialog(summary.leg._id));
    return card;
  }));

  dayListEl.replaceChildren(...view.days.map(renderDayBlock));
  wireScenarioFollowers(dayListEl);

  tripsHome.hidden = true;
  tripPage.hidden = false;
}

// ---------- trips list (the landing screen) ----------

let tripsIndexPromise = null;

async function showTripsHome() {
  tripPage.hidden = true;
  tripsHome.hidden = false;
  document.title = 'Trip Planner';

  if (!tripsIndexPromise) tripsIndexPromise = loadTripsIndex();
  const trips = await tripsIndexPromise;

  tripsListEl.replaceChildren(...trips.map(({ slug, trip }) => {
    const item = document.createElement('md-list-item');
    item.type = 'button';
    item.innerHTML = `
      <div slot="overline">${trip.status}</div>
      <div slot="headline">${trip.name}</div>
      <div slot="supporting-text">${formatTripDateChip(trip, tripDayCount(trip))}</div>
      <md-icon slot="end">chevron_right</md-icon>
    `;
    item.addEventListener('click', () => { location.hash = `#/${slug}`; });
    return item;
  }));
}

// ---------- router ----------

async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts.length === 0) {
    await showTripsHome();
    return;
  }

  const [slug] = parts;
  if (slug === currentSlug) {
    tripsHome.hidden = true;
    tripPage.hidden = false;
    return;
  }
  await openTrip(slug);
}

window.addEventListener('hashchange', route);
route();
