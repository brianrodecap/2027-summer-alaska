import '@material/web/all.js';
import { styles as typescaleStyles } from '@material/web/typography/md-typescale-styles.js';
import './side-sheet.js';
import { loadTripsIndex, loadTripData, buildTripView, formatTripDateChip, tripDayCount, resolveTransitRoute, formatTime } from './trip-model.js';
import { renderLegCard, renderLegDialogBody } from './leg-render.js';
import { renderDayBlock, wireScenarioFollowers, wireTabs, stageOverlineText } from './day-render.js';
import { renderDayMapSheetBody } from './day-map-render.js';
import { renderActivityDetailBody, activityDetailTitle, placeTypeIcon } from './activity-detail-render.js';
import { syncMealRow, activeMealOptions } from './meal-row-render.js';
import { firstImage } from './render-shared.js';
import { renderBudgetStrip, renderBudgetSummary, renderBudgetBreakdowns } from './budget-render.js';
import { hydratePlaceDetails } from './places.js';
import { renderDatePicker } from './date-picker.js';
import { renderTimePicker, readTimePicker } from './time-picker.js';
import { buildFilterGroups, renderFilterMenuItems, applyFilters } from './filters.js';
import { renderEditForm, applyEdit, EDIT_ENTITY_LABEL } from './edit.js';

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
const datePickerDialogTitle = document.querySelector('#date-picker-dialog-title');
const datePickerBody = document.querySelector('#date-picker-body');
const timePickerDialog = document.querySelector('#time-picker-dialog');
const timePickerDialogTitle = document.querySelector('#time-picker-dialog-title');
const timePickerBody = document.querySelector('#time-picker-body');
const editDialog = document.querySelector('#edit-dialog');
const editDialogTitle = document.querySelector('#edit-dialog-title');
const editDialogBody = document.querySelector('#edit-dialog-body');
const editDialogError = document.querySelector('#edit-dialog-error');
const editDialogDeleteButton = document.querySelector('#edit-dialog-delete');
const exportEditsButton = document.querySelector('#export-edits');
const appBarEl = document.querySelector('#app-bar');
const routesDialog = document.querySelector('#routes-dialog');
const routesDialogBody = document.querySelector('#routes-dialog-body');

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
  timePickerDialog.close();
  editDialog.close();
  routesDialog.close();
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
// currently have selected (see meal-row-render.js's renderMealRow/syncMealRow) —
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
    const tabEls = [...tabsEl.querySelectorAll('md-filter-chip')];
    const active = tabEls[tabsEl.activeTabIndex] ?? tabEls[0];
    if (active) routeTones.set(tabsEl.dataset.transitId, active.dataset.tone);
  });

  // day.scenarioTracks and the scenario tab bar's own md-filter-chips are
  // built from the same array in the same order (see day-render.js's
  // renderScenarioTabs), so the active chip's index doubles as the index into
  // scenarioTracks — same positional match wireRouteVariantTabs relies on
  // for stage rows, just by index here instead of a data attribute.
  const scenarioTabsEl = dayBlockEl.querySelector(`.scenario-tabs[data-scenario-date="${day.date}"]`);
  const scenarioTabCount = scenarioTabsEl?.querySelectorAll('md-filter-chip').length ?? 0;
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
  // The edit form always opens on the underlying Activity, never on a
  // selectedOption — a MealOption candidate isn't one of edit.js's kinds
  // (see its own scope note) — but the Activity's own fields (time, text,
  // status, booking, ...) stay editable regardless of which candidate tab
  // is active, since those live on the Activity itself, not per-candidate.
  sideSheet.open(activityDetailTitle(activity, selectedOption), renderActivityDetailBody(activity, selectedOption), {
    onEdit: () => openEditPopup('activity', activity._id),
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

// ---------- editing day-list line items (edit.js) — one shared
// renderEditForm/applyEdit pair hosted by the standalone #edit-dialog popup:
// the side sheet's own edit button (Activities only — see openActivity
// above) opens it via openEditPopup, and every Stay/Transit row's pencil
// button (render-shared.js's renderEditButton) opens it the same way, the
// only edit entry point Stay/Transit have since neither opens a side sheet
// at all. It doesn't write back to the *.json files this data loaded from —
// there's no backend to write to (see CLAUDE.md) — so a save only mutates
// the in-memory `data` this trip's `view` was built from; exportDirtyCollections
// (below) is how an edit becomes durable, by downloading the touched file(s)
// back out. ----------

const COLLECTION_FOR_KIND = { activity: 'activities', stay: 'stays', transit: 'transits', route: 'routes' };
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

// Removes the entity outright — no confirmation step, matching the rest of
// this editor's low-stakes framing (see the comment above editing day-list
// line items: nothing here writes back to the *.json files until an
// explicit export). The date to scroll back to has to be read off the
// entity *before* it's spliced out of `data`, since refreshAfterEdit's own
// post-rebuild findEntity lookup would come back empty for a deleted id.
function deleteEntity(kind, id) {
  const entity = findEntity(kind, id);
  if (!entity) return;
  const freshDate = kind === 'activity' ? view.activitiesById.get(id)?.date : (kind === 'stay' ? entity.checkInAt : entity.departsAt)?.slice(0, 10);
  const collection = COLLECTION_FOR_KIND[kind];
  data[collection] = data[collection].filter((e) => e._id !== id);
  markDirty(kind);
  view = buildTripView(data);
  renderTripBody();
  if (freshDate) document.getElementById(`day-${freshDate}`)?.scrollIntoView({ block: 'start' });
}

// The standalone popup — the only edit entry point for Stay/Transit, and for
// Activity too now that the side sheet's own edit button (openActivity,
// above) opens this same popup rather than an in-place form. Route reuses it
// too (see openRoutesDialog below); `isNew` marks a route created via "+ Add
// route" that's already been pushed into data.routes speculatively so
// findEntity/applyEdit can treat it like any other in-progress edit — Cancel
// (below) splices it back out again if the user never actually saves it.
let editTarget = null;

function openEditPopup(kind, id, { isNew = false } = {}) {
  const entity = findEntity(kind, id);
  if (!entity) return;
  closeAllPanels();
  editTarget = { kind, id, isNew };
  editDialogTitle.textContent = isNew ? 'Add route' : EDIT_ENTITY_LABEL[kind];
  editDialogDeleteButton.hidden = isNew;
  editDialogError.hidden = true;
  const context = {
    openDatePicker,
    openTimePicker,
    ...(kind === 'activity' ? { tripTravelers: view.trip.travelers, stays: data.stays ?? [] } : {}),
    ...(kind === 'transit' ? { routes: data.routes ?? [] } : {}),
  };
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
  if (editTarget?.isNew) {
    const collection = COLLECTION_FOR_KIND[editTarget.kind];
    data[collection] = data[collection].filter((e) => e._id !== editTarget.id);
  }
  editTarget = null;
  editDialog.close();
});

document.querySelector('#edit-dialog-delete').addEventListener('click', () => {
  if (!editTarget) return;
  const { kind, id } = editTarget;
  editTarget = null;
  editDialog.close();
  deleteEntity(kind, id);
});

// ---------- Routes list (routes.json) — a separate small dialog, not a
// day-list drill-down like the other three kinds, since a Route isn't
// scoped to any one date; a Transit merely points at one via its own
// routeId/routeVariant fields (see edit.js's transitFields). Rebuilt from
// data.routes on every open rather than kept in sync live, since opening it
// always closes whatever's already open (closeAllPanels) — the same "just
// redo it" simplicity edit.js's place-row editing leans on. ----------

function nextRouteId(routes) {
  let n = routes.length + 1;
  while (routes.some((r) => r._id === `route_new_${n}`)) n += 1;
  return `route_new_${n}`;
}

function routeLabel(route) {
  return `${route.from.label} → ${route.to.label}`;
}

function renderRoutesDialogBody(query = '') {
  const needle = query.trim().toLowerCase();
  const routes = (data.routes ?? [])
    .filter((route) => !needle || routeLabel(route).toLowerCase().includes(needle))
    .sort((a, b) => routeLabel(a).localeCompare(routeLabel(b)));
  routesDialogBody.replaceChildren(...routes.map((route) => {
    const item = document.createElement('div');
    item.className = 'routes-list-item';
    item.innerHTML = `
      <span class="md-typescale-body-large">${routeLabel(route)}</span>
      <md-icon-button data-edit-route-id="${route._id}" aria-label="Edit route"><md-icon>edit</md-icon></md-icon-button>`;
    return item;
  }));
}

const routesSearchField = document.querySelector('#routes-search');

function openRoutesDialog() {
  closeAllPanels();
  routesSearchField.value = '';
  renderRoutesDialogBody();
  routesDialog.show();
}

routesSearchField.addEventListener('input', () => renderRoutesDialogBody(routesSearchField.value));

function openNewRouteEditor() {
  const id = nextRouteId(data.routes);
  data.routes.push({ _id: id, from: { label: '' }, to: { label: '' }, variants: [] });
  openEditPopup('route', id, { isNew: true });
}

routesDialogBody.addEventListener('click', (event) => {
  const editButton = event.target.closest('[data-edit-route-id]');
  if (editButton) openEditPopup('route', editButton.dataset.editRouteId);
});

document.querySelector('#routes-add').addEventListener('click', openNewRouteEditor);
document.querySelector('#routes-manage-open').addEventListener('click', openRoutesDialog);
document.querySelector('#routes-dialog-close').addEventListener('click', () => routesDialog.close());

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

// A Stay/Transit-depart row's pencil button (render-shared.js's
// renderEditButton — the only day-list row that still has one; a plain
// Activity's own edit entry point is its side sheet's header button instead,
// see openActivity) is a sibling of its .stay-block, never nested inside it
// — so this never conflicts with the activity-open listener above.
dayListEl.addEventListener('click', (event) => {
  const editButton = event.target.closest('.row-edit-button');
  if (!editButton) return;
  const { editStayId, editTransitId } = editButton.dataset;
  if (editStayId) openEditPopup('stay', editStayId);
  else if (editTransitId) openEditPopup('transit', editTransitId);
});

// A routed Transit's own walked stage/Arrive times (trip-model.js's
// resolveTransitRoute) depend on two things a reader can change live, with
// no reload: which route-variant tab is active, and which MealOption a
// meal reached along the way is currently switched to (a sit-down lunch
// eats far more drive-window than a drive-thru). Both listeners below call
// this after their own more-local DOM update, re-walking every routed
// Transit that departs on this same day against whichever tabs are
// actually active right now — not the model's own authored defaults — and
// patching just the stage-row/Arrive-row time text back in, rather than
// re-rendering the whole day block and losing every other live selection
// on it (see refreshAfterEdit's own note on that trade-off, which doesn't
// apply here since nothing's being saved).
function recomputeRoutedTransits(dayBlockEl) {
  if (!dayBlockEl) return;
  const day = view.days.find((d) => d.date === dayBlockEl.id.replace('day-', ''));
  if (!day) return;

  const formatOverrides = new Map();
  dayBlockEl.querySelectorAll('.meal-row-tabs').forEach((tabsEl) => {
    const activityId = tabsEl.closest('.meal-row').querySelector('[data-activity-id]').dataset.activityId;
    const activity = view.activitiesById.get(activityId);
    const option = activeMealOptions(activity, day)[tabsEl.activeTabIndex];
    if (option) formatOverrides.set(activityId, option.diningFormat);
  });

  const activities = [...view.activitiesById.values()];
  for (const transit of day.transits) {
    if (!transit.routeId) continue;
    const routeTabsEl = dayBlockEl.querySelector(`.route-tabs[data-transit-id="${transit._id}"]`);
    let routeVariant;
    if (routeTabsEl) {
      const tabEls = [...routeTabsEl.querySelectorAll('md-filter-chip')];
      routeVariant = (tabEls[routeTabsEl.activeTabIndex] ?? tabEls[0])?.dataset.tone;
    }
    const routeInfo = resolveTransitRoute(transit, view.routesById, activities, { routeVariant, formatOverrides });
    if (!routeInfo) continue;

    // Every variant, hidden ones included, so a still-hidden tab's stages
    // are already correct for whenever it does get switched to.
    routeInfo.variants.forEach((variant) => {
      const stageRows = dayBlockEl.querySelectorAll(`.transit-stage-row[data-transit-id="${transit._id}"][data-route-tone="${variant.tone}"]`);
      stageRows.forEach((row, i) => {
        const stage = variant.stages[i];
        const overline = stage && row.querySelector('.stage-overline');
        if (overline) overline.textContent = stageOverlineText(stage.key, stage.kind);
      });
    });

    const arriveEl = dayBlockEl.querySelector(`.transit-boundary-time[data-transit-id="${transit._id}"][data-phase="arrive"]`);
    if (arriveEl) arriveEl.textContent = `${formatTime(routeInfo.resolvedArrivesAt)} · Arrive`;
  }
}

// A meal row's own filter-chip group (see meal-row-render.js's renderMealRow)
// switches which MealOption candidate that row displays — a separate concern
// from the click listener above, which only opens the side sheet via the
// row's header button.
dayListEl.addEventListener('change', (event) => {
  const tabsEl = event.target.closest('.meal-row-tabs');
  if (!tabsEl) return;
  const activityId = tabsEl.closest('.meal-row').querySelector('[data-activity-id]').dataset.activityId;
  const activity = view.activitiesById.get(activityId);
  const day = view.days.find((d) => d.date === activity.date);
  syncMealRow(activity, day, tabsEl);
  recomputeRoutedTransits(tabsEl.closest('.day-block'));
});

// The route-variant tab itself (day-render.js's renderRouteVariantTabs) —
// day-render.js's own wireRouteVariantTabs already toggles which stage rows
// are hidden on this same 'change' event; this is the separate concern of
// keeping their times (and the Arrive row's) live-correct.
dayListEl.addEventListener('change', (event) => {
  const tabsEl = event.target.closest('.route-tabs');
  if (!tabsEl) return;
  recomputeRoutedTransits(tabsEl.closest('.day-block'));
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

// The Overview stat strip (budget-render.js's renderBudgetStrip) is itself a
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

// ---------- date picker — shared by the trip page's top-level "Jump to a
// day" icon button (see index.html) and every date field an edit form opens
// (edit.js's context.openDatePicker, passed through app.js's openEditPopup
// below). Month-at-a-time state (pickerYear/pickerMonth) lives here, not in
// date-picker.js, since renderDatePicker is a pure render function like
// every render function in this codebase's render-*.js modules — only the
// caller knows which month is currently showing. Selectable dates are always
// `view.days` — every date some Leg actually covers — the same restriction
// "Jump to a day" already had, since an edit form's own date field is never
// meant to place something outside the trip either. ----------

let pickerYear = null;
let pickerMonth = null;
let pickerOnSelect = null;

function renderPicker() {
  datePickerBody.replaceChildren(renderDatePicker(view.days, view.trip.startDate, view.trip.endDate, pickerYear, pickerMonth));
}

// `initialDate` seeds which month the grid opens on (falling back to the
// trip's own start when nothing's picked yet); `onSelect(date)` fires once,
// right as the dialog closes itself on a cell click — this dialog commits
// immediately on pick rather than needing its own OK step, matching the M3
// docked date-picker variant's one-tap selection.
function openDatePicker(initialDate, title, onSelect) {
  datePickerDialogTitle.textContent = title;
  const [y, m] = (initialDate || view.trip.startDate).split('-').map(Number);
  pickerYear = y;
  pickerMonth = m - 1;
  pickerOnSelect = onSelect;
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
  if (cell && !cell.disabled) {
    datePickerDialog.close();
    pickerOnSelect?.(cell.dataset.date);
  }
});

document.querySelector('#date-picker-open').addEventListener('click', () => {
  closeAllPanels();
  openDatePicker(null, 'Jump to a day', scrollToDay);
});
document.querySelector('#date-picker-close').addEventListener('click', () => datePickerDialog.close());

// ---------- time picker — the M3 Input-variant dialog (time-picker.js), an
// edit form's own date fields' counterpart for the time half of a
// date+time pair (edit.js's context.openTimePicker). Unlike the date picker
// above this always needs an explicit OK, since two text fields plus an
// AM/PM toggle has no single "the pick is done" tap the way a calendar cell
// click does. ----------

let timePickerOnSelect = null;

// md-dialog exposes no elevation/shadow custom property (styles.css's
// #time-picker-dialog rule explains why one is needed here); this reaches
// its shadow root once, at module load, to give its surface a real M3
// elevation-3 shadow (the values dialogs use by spec) directly.
timePickerDialog.shadowRoot?.querySelector('.container')?.style.setProperty(
  'box-shadow', '0px 1px 3px 0px rgba(0,0,0,0.3), 0px 4px 8px 3px rgba(0,0,0,0.15)');

function openTimePicker(hhmm, title, onSelect) {
  timePickerDialogTitle.textContent = title;
  timePickerBody.replaceChildren(renderTimePicker(hhmm));
  timePickerOnSelect = onSelect;
  timePickerDialog.show();
}

document.querySelector('#time-picker-ok').addEventListener('click', () => {
  const value = readTimePicker(timePickerBody);
  timePickerDialog.close();
  timePickerOnSelect?.(value);
});
document.querySelector('#time-picker-cancel').addEventListener('click', () => timePickerDialog.close());

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
