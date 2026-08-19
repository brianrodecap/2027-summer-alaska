import '@material/web/all.js';
import { styles as typescaleStyles } from '@material/web/typography/md-typescale-styles.js';
import './side-sheet.js';
import { loadTripsIndex, loadTripData, buildTripView, formatTripDateChip, tripDayCount } from './trip-model.js';
import { renderLegCard, renderDayBlock, renderLegDialogBody, renderActivityDetailBody, renderDayMapSheetBody, activityDetailTitle, placeTypeIcon, syncMealRow, activeMealOptions, firstImage, wireScenarioFollowers, renderBudgetStrip, renderBudgetSummary, renderBudgetBreakdowns, wireTabs } from './day-render.js';
import { hydratePlaceDetails } from './places.js';
import { renderDatePicker } from './date-picker.js';
import { buildFilterGroups, renderFilterMenuItems, applyFilters } from './filters.js';
import { renderEditForm, applyEdit, EDIT_ENTITY_LABEL } from './edit.js';

function toNode(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

document.adoptedStyleSheets.push(typescaleStyles.styleSheet);

// ---------- routing: '#/' is the trips list; '#/<slug>' opens a trip into
// one shared page shell — one hero, and three swappable views underneath it
// (Overview, the day-by-day list at '#/<slug>/days', Budget at
// '#/<slug>/budget') — see showPage. Elements and listeners below are wired
// once at module scope and read `view`/`currentSlug` at click time, so the
// same wiring keeps working across trip switches. ----------

const tripsHome = document.querySelector('#trips-home');
const tripsListEl = document.querySelector('#trips-list');
const tripPage = document.querySelector('#trip-page');
const overviewEl = document.querySelector('#overview');
const daysViewEl = document.querySelector('#days-view');
const budgetViewEl = document.querySelector('#budget-view');
const budgetSummaryEl = document.querySelector('#budget-summary');
const budgetBreakdownsEl = document.querySelector('#budget-breakdowns');

let view = null;
let data = null;
let currentSlug = null;

// ---------- drill-down: Overview's Leg cards → Leg dialog → a day's inline
// block (on the day-list view) → Activity side sheet. Opening a dialog/sheet
// closes whichever one opened it — md-dialog renders in the browser's native
// top layer, which would otherwise always paint above our hand-positioned
// side sheet regardless of z-index, so a dialog and the side sheet never
// stack. The filter menu (below) is hand-positioned the same way the side
// sheet is, so it's closed alongside it for the same reason. ----------

const sideSheet = document.querySelector('detail-side-sheet');
const dayListEl = document.querySelector('#day-list');
const legDialog = document.querySelector('#leg-dialog');
const legDialogTitle = document.querySelector('#leg-dialog-title');
const legDialogBody = document.querySelector('#leg-dialog-body');
const budgetStripMount = document.querySelector('#budget-strip-mount');
const filterMenu = document.querySelector('#filter-menu');
const datePickerDialog = document.querySelector('#date-picker-dialog');
const datePickerBody = document.querySelector('#date-picker-body');
const editDialog = document.querySelector('#edit-dialog');
const editDialogTitle = document.querySelector('#edit-dialog-title');
const editDialogBody = document.querySelector('#edit-dialog-body');
const editDialogError = document.querySelector('#edit-dialog-error');
const exportEditsButton = document.querySelector('#export-edits');
const appBarEl = document.querySelector('#app-bar');

// M3's top app bar is flat while it's the page's own leading edge and only
// gains elevation once content has scrolled in underneath it — .app-bar's
// `position: sticky` alone can't express that (it can't tell "positioned at
// top: 0 because nothing's scrolled yet" from "positioned at top: 0 because
// it's pinned there"), so this reads the one signal that does distinguish
// them: the sticky element's own bounding rect stays below zero until it's
// actually pinned.
function updateAppBarElevation() {
  if (daysViewEl.hidden) return;
  appBarEl.classList.toggle('is-elevated', appBarEl.getBoundingClientRect().top <= 0);
}
window.addEventListener('scroll', updateAppBarElevation, { passive: true });

function closeAllPanels() {
  legDialog.close();
  datePickerDialog.close();
  editDialog.close();
  sideSheet.close();
  filterMenu.open = false;
}

// Every day's full detail is already rendered inline on the day-list view
// (see renderDayBlock in day-render.js), so "jumping" to a day from
// elsewhere (the Leg dialog's own day list) is just navigating to that view
// and scrolling its block into place — cross-page when called from the
// Overview/Budget view, same-page (skip the redundant hash write) when
// already there.
function scrollToDay(date) {
  closeAllPanels();
  const targetHash = `#/${currentSlug}/days/${date}`;
  if (location.hash === targetHash) {
    document.getElementById(`day-${date}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    location.hash = targetHash;
  }
}

function openLegDialog(legId) {
  const summary = view.legSummaries.find((s) => s.leg._id === legId);
  if (!summary) return;
  closeAllPanels();
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

// The map button's embedded map and full-route link (trip-model.js's
// dayMapEmbedUrl/dayFullRouteUrl) should reflect whichever variant each of
// this day's own live tab groups — a route picker, the scenario branch, any
// meal-option row — is currently showing, not each one's own model default
// (routeInfo.selectedTone, the planned scenario track, a meal's first
// candidate). Reads every one of them back off the day-block's DOM in one
// pass, the same "ask the DOM, not the model" move selectedMealOption above
// makes for a single meal row's own side sheet, and returns the `{
// routeTones, scenarioTone, mealPlaces }` shape dayFullRouteStops/
// dayMapStops (trip-model.js) both take.
function readDaySelections(dayBlockEl, day) {
  const routeTones = new Map();
  dayBlockEl.querySelectorAll('.route-tabs').forEach((tabsEl) => {
    const tabEls = [...tabsEl.querySelectorAll('md-primary-tab')];
    const active = tabEls[tabsEl.activeTabIndex] ?? tabEls[0];
    if (active) routeTones.set(tabsEl.dataset.transitId, active.dataset.tone);
  });

  // day.scenarioTracks and the scenario tab bar's own md-primary-tabs are
  // built from the same array in the same order (see day-render.js's
  // renderScenarioTabs), so the active tab's index doubles as the index into
  // scenarioTracks — same positional match wireRouteVariantTabs relies on
  // for stage rows, just by index here instead of a data attribute.
  const scenarioTabsEl = dayBlockEl.querySelector(`.scenario-tabs[data-scenario-date="${day.date}"]`);
  const scenarioTabCount = scenarioTabsEl?.querySelectorAll('md-primary-tab').length ?? 0;
  const activeScenarioIndex = scenarioTabCount ? (scenarioTabsEl.activeTabIndex ?? 0) : -1;
  const scenarioTone = activeScenarioIndex >= 0 ? day.scenarioTracks[activeScenarioIndex]?.scenario.tone : undefined;

  const mealPlaces = new Map();
  dayBlockEl.querySelectorAll('.meal-row-tabs').forEach((tabsEl) => {
    const activityId = tabsEl.closest('.meal-row').querySelector('[data-activity-id]').dataset.activityId;
    const activity = view.activitiesById.get(activityId);
    const option = activeMealOptions(activity, day)[tabsEl.activeTabIndex];
    mealPlaces.set(activityId, option?.place ?? null);
  });

  return { routeTones, scenarioTone, mealPlaces };
}

async function openActivity(activity, selectedOption = null) {
  const place = selectedOption ? selectedOption.place : activity.place;
  // Editing in place is only offered for a plain activity — a meal row's
  // selected MealOption isn't itself one of the three edit.js kinds (see
  // edit.js's own scope note), so the sheet's edit button just stays hidden
  // when a selectedOption is passed in.
  sideSheet.open(activityDetailTitle(activity, selectedOption), renderActivityDetailBody(activity, selectedOption), {
    onEdit: selectedOption ? null : () => enterActivityEditMode(activity),
  });
  if (!place?.id) return;
  const details = await hydratePlaceDetails(sideSheet.querySelector('.place-panel'), place);
  // Meal options already show their dining-format icon (known synchronously,
  // and more meaningful than the venue's raw category) — only a plain place
  // starts on the generic default icon that needs swapping in once hydrated.
  if (details && !selectedOption) {
    const iconEl = sideSheet.querySelector('.detail-title-icon');
    if (iconEl) iconEl.textContent = placeTypeIcon(details);
  }
}

// ---------- editing day-list line items (edit.js) — two chrome shells
// around the same renderEditForm/applyEdit pair: the side sheet's own edit
// button (Activities only — see openActivity above) swaps its body in place
// for enterActivityEditMode; every row's pencil button (Activity, Stay, and
// Transit — see day-render.js's renderEditButton) opens the lighter-weight
// #edit-dialog popup instead, the only edit entry point Stay/Transit have
// since neither opens a side sheet at all. Neither surface writes back to
// the *.json files this data loaded from — there's no backend to write to
// (see CLAUDE.md) — so a save only mutates the in-memory `data` this trip's
// `view` was built from; exportDirtyCollections (below) is how an edit
// becomes durable, by downloading the touched file(s) back out. ----------

const COLLECTION_FOR_KIND = { activity: 'activities', stay: 'stays', transit: 'transits' };
const dirtyCollections = new Set();

function findEntity(kind, id) {
  return data[COLLECTION_FOR_KIND[kind]].find((e) => e._id === id);
}

function markDirty(kind) {
  dirtyCollections.add(COLLECTION_FOR_KIND[kind]);
  exportEditsButton.hidden = false;
  exportEditsButton.title = `Download edited ${[...dirtyCollections].join(', ')}`;
}

function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

exportEditsButton.addEventListener('click', () => {
  for (const collection of dirtyCollections) downloadJson(`${collection}.json`, data[collection]);
});

// Rebuilds `view` from the just-mutated `data` and re-renders the trip page
// from it — the same full rebuild openTrip does on first load. This does
// mean any other day's live tab selections (a route variant, a scenario
// branch, a meal-option tab) reset to their model defaults on every save,
// since those only ever lived in DOM state, not in `view` — an accepted
// trade-off for how rarely a save happens versus how much simpler a full
// rebuild is than surgically patching just the edited row back into an
// already-rendered day-block.
function refreshAfterEdit(kind, id) {
  view = buildTripView(data);
  renderTripBody();
  const entity = findEntity(kind, id);
  const freshDate = kind === 'activity' ? view.activitiesById.get(id)?.date : (kind === 'stay' ? entity.checkInAt : entity.departsAt)?.slice(0, 10);
  if (freshDate) document.getElementById(`day-${freshDate}`)?.scrollIntoView({ block: 'start' });
}

// The side sheet's own in-place edit mode (Activities only) — swaps the
// sheet body for the form plus its own Save/Cancel row (the sheet has no
// dialog-style actions slot of its own to borrow), leaving the header's edit
// button hidden (openActivity only passes onEdit for the read view) since
// there's nothing more to switch into while already editing.
function enterActivityEditMode(activity) {
  const formNode = renderEditForm('activity', activity, { tripTravelers: view.trip.travelers });
  const errorEl = toNode(`<p class="edit-dialog-error md-typescale-body-medium" hidden></p>`);
  const cancelBtn = toNode(`<md-text-button type="button">Cancel</md-text-button>`);
  const saveBtn = toNode(`<md-filled-button type="button">Save</md-filled-button>`);
  const actions = toNode(`<div class="edit-form-actions"></div>`);
  actions.append(cancelBtn, saveBtn);

  cancelBtn.addEventListener('click', () => openActivity(activity));
  saveBtn.addEventListener('click', () => {
    const error = applyEdit('activity', activity, formNode);
    if (error) {
      errorEl.textContent = error;
      errorEl.hidden = false;
      return;
    }
    markDirty('activity');
    refreshAfterEdit('activity', activity._id);
    openActivity(view.activitiesById.get(activity._id));
  });

  const wrap = document.createDocumentFragment();
  wrap.append(errorEl, formNode, actions);
  sideSheet.open(activityDetailTitle(activity), wrap);
}

// The standalone popup — the only edit entry point for Stay/Transit, and a
// quicker alternative to the sheet for a plain Activity too (see
// day-render.js's renderEditButton on every row).
let editTarget = null;

function openEditPopup(kind, id) {
  const entity = findEntity(kind, id);
  if (!entity) return;
  closeAllPanels();
  editTarget = { kind, id };
  editDialogTitle.textContent = EDIT_ENTITY_LABEL[kind];
  editDialogError.hidden = true;
  const context = kind === 'activity' ? { tripTravelers: view.trip.travelers } : undefined;
  editDialogBody.replaceChildren(renderEditForm(kind, entity, context));
  editDialog.show();
}

document.querySelector('#edit-dialog-save').addEventListener('click', () => {
  if (!editTarget) return;
  const { kind, id } = editTarget;
  const entity = findEntity(kind, id);
  const formEl = editDialogBody.querySelector('.edit-form');
  const error = applyEdit(kind, entity, formEl);
  if (error) {
    editDialogError.textContent = error;
    editDialogError.hidden = false;
    return;
  }
  markDirty(kind);
  editTarget = null;
  editDialog.close();
  refreshAfterEdit(kind, id);
});

document.querySelector('#edit-dialog-cancel').addEventListener('click', () => {
  editTarget = null;
  editDialog.close();
});

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
  const dayBlock = mapButton.closest('.day-block');
  const selections = dayBlock ? readDaySelections(dayBlock, day) : {};
  sideSheet.open(`Map — ${day.dateLabel}`, renderDayMapSheetBody(day, selections));
});

// Every row's pencil button (day-render.js's renderEditButton) is a sibling
// of whatever interactive element the row itself has (its md-list-item, its
// .stay-block), never nested inside one — so this never conflicts with the
// activity-open listener above; clicking a pencil doesn't also open the row
// it's on.
dayListEl.addEventListener('click', (event) => {
  const editButton = event.target.closest('.row-edit-button');
  if (!editButton) return;
  const { editActivityId, editStayId, editTransitId } = editButton.dataset;
  if (editActivityId) openEditPopup('activity', editActivityId);
  else if (editStayId) openEditPopup('stay', editStayId);
  else if (editTransitId) openEditPopup('transit', editTransitId);
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
document.querySelector('#trip-budget-chip').addEventListener('click', () => { location.hash = `#/${currentSlug}/budget`; });
document.querySelector('#trip-date-chip').addEventListener('click', () => { location.hash = `#/${currentSlug}/days`; });

// One hero, shared by all three views (Overview/Days/Budget) — its back
// button always steps up exactly one level: off a sub-view to the trip's
// Overview, or off the Overview itself to the trips list.
document.querySelector('#hero-back').addEventListener('click', () => {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  location.hash = parts.length > 1 ? `#/${parts[0]}` : '#/';
});

// The Overview stat strip (day-render.js's renderBudgetStrip) is itself a
// button — a teaser for the same numbers the dedicated Budget page shows in
// full, same "click the summary to drill in" convention as a Leg card.
budgetStripMount.addEventListener('click', (event) => {
  if (event.target.closest('.budget-strip-button')) location.hash = `#/${currentSlug}/budget`;
});

// ---------- Overview's Leg cards and the day list — rebuilt from the
// current trip's `view` on each visit ----------

const legsGrid = document.querySelector('#legs-grid');

// ---------- filter nav: an md-menu anchored to a small icon button (see
// filters.js) — landed on after comparing it live against a chip bar and a
// leading-edge navigation rail, both tried and dropped — see styles.css's
// app-bar comment. ----------

let filterGroups = [];
const activeFilterTokens = new Set();

const filterMenuOpen = document.querySelector('#filter-menu-open');
const dayListEmpty = document.querySelector('#day-list-empty');

function refreshFilterNav() {
  filterMenu.replaceChildren(renderFilterMenuItems(filterGroups, activeFilterTokens));
  applyFilters(dayListEl, activeFilterTokens, dayListEmpty);
}

function toggleFilterToken(token) {
  if (!token) return;
  if (activeFilterTokens.has(token)) activeFilterTokens.delete(token);
  else activeFilterTokens.add(token);
  refreshFilterNav();
}

function clearFilterTokens() {
  activeFilterTokens.clear();
  refreshFilterNav();
}

filterMenuOpen.addEventListener('click', () => {
  closeAllPanels();
  filterMenu.open = true;
});
// The menu is fully re-rendered on every toggle (see refreshFilterNav), so
// this is a delegated listener on the stable #filter-menu element rather
// than per-item listeners that would need rewiring after every render.
filterMenu.addEventListener('click', (event) => {
  if (event.target.closest('.filter-clear-item')) { clearFilterTokens(); return; }
  const row = event.target.closest('[data-token]');
  if (row) toggleFilterToken(row.dataset.token);
});

// ---------- date picker — "Jump to a day", its own top-level icon button in
// the filter nav (see index.html), separate from the filter menu since it
// isn't a filter. Month-at-a-time state (pickerYear/pickerMonth) lives here,
// not in date-picker.js, since renderDatePicker is a pure render function
// like everything in day-render.js — only the caller knows which month is
// currently showing. ----------

let pickerYear = null;
let pickerMonth = null;

function renderPicker() {
  datePickerBody.replaceChildren(renderDatePicker(view.days, view.trip.startDate, view.trip.endDate, pickerYear, pickerMonth));
}

function openDatePicker() {
  closeAllPanels();
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
document.querySelector('#date-picker-close').addEventListener('click', () => datePickerDialog.close());

// ---------- loading a trip into the (single, reused) trip page ----------

// Shared by openTrip's first load and refreshAfterEdit's post-save rebuild —
// everything that's read straight off `view` rather than off the trip's own
// hero fields (name/summary/dates), which only ever change on a real trip
// switch. Preserves whatever filters are currently active (refreshFilterNav
// re-applies activeFilterTokens rather than clearing them) — only openTrip's
// own caller clears those, since switching *trips* should reset filters but
// saving an edit shouldn't.
function renderTripBody() {
  budgetStripMount.replaceChildren(renderBudgetStrip(view.budget));

  legsGrid.replaceChildren(...view.legSummaries.map((summary) => {
    const card = renderLegCard(summary);
    card.addEventListener('click', () => openLegDialog(summary.leg._id));
    return card;
  }));

  dayListEl.replaceChildren(...view.days.map(renderDayBlock));
  wireScenarioFollowers(dayListEl);

  filterGroups = buildFilterGroups(view);
  refreshFilterNav();
}

async function openTrip(slug, sub, extra) {
  currentSlug = slug;
  data = await loadTripData(slug);
  view = buildTripView(data);
  dirtyCollections.clear();
  exportEditsButton.hidden = true;

  document.querySelector('#trip-title').textContent = view.trip.name;
  document.querySelector('#trip-summary').textContent = view.trip.summary ?? '';
  document.querySelector('#trip-date-chip').label = formatTripDateChip(view.trip, view.days.length);

  const heroImage = firstImage(view.trip);
  const heroImageEl = document.querySelector('#trip-hero-image');
  heroImageEl.hidden = !heroImage;
  heroImageEl.style.backgroundImage = heroImage ? `url("${heroImage.uri}")` : '';
  heroImageEl.title = heroImage?.credit ?? '';
  document.querySelector('#trip-hero').classList.toggle('has-hero-image', !!heroImage);

  activeFilterTokens.clear();
  renderTripBody();

  showPage(sub, extra);
}

// Switches which of the three views (Overview/Days/Budget) shows beneath the
// one shared hero — all read the same already-loaded `view`, so switching
// between them never re-fetches. `sub` is the router's second hash segment;
// anything other than 'days'/'budget' falls back to the Overview, same
// "unknown sub-route degrades to the parent" convention scrollToDay already
// relies on for a bad date. `extra` is the optional third segment — a date
// to scroll to on the Days view, e.g. arriving from the Leg dialog's own day
// list (see scrollToDay).
function showPage(sub, extra) {
  tripsHome.hidden = true;
  tripPage.hidden = false;
  overviewEl.hidden = !!sub;
  daysViewEl.hidden = sub !== 'days';
  budgetViewEl.hidden = sub !== 'budget';
  updateAppBarElevation();

  if (sub === 'budget') {
    document.title = `Budget — ${view.trip.name}`;
    budgetSummaryEl.replaceChildren(renderBudgetSummary(view.budget));
    budgetBreakdownsEl.replaceChildren(renderBudgetBreakdowns(view.budget));
    wireTabs(budgetBreakdownsEl, '.budget-tabs', '.budget-panel');
  } else if (sub === 'days') {
    document.title = `Day by day — ${view.trip.name}`;
    // The day-list view was just unhidden this same tick — scrollIntoView
    // needs layout to have happened first, hence the extra frame.
    if (extra) requestAnimationFrame(() => document.getElementById(`day-${extra}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  } else {
    document.title = view.trip.name;
  }
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

  const [slug, sub, extra] = parts;
  if (slug === currentSlug) {
    showPage(sub, extra);
    return;
  }
  await openTrip(slug, sub, extra);
}

window.addEventListener('hashchange', route);
route();
