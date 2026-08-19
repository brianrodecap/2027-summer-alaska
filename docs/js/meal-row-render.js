// Renders a meal Activity that still has several open MealOption candidates
// as its own "meal row" — image + time/selected-candidate line, plus an
// md-tabs bar for switching candidates inline. activity-row-render.js's
// renderActivityRow delegates to renderMealRow here whenever activity.options
// is set (see docs/data/data-model.html's Activity entity).

import { stayRelation, filterTagsFor } from './trip-model.js';
import { toNode } from './render-dom.js';
import { firstImage, renderTravelerChips, renderTravelerChipsHtml, renderTransitOverlapWarning, timeAndMealTypeLabel, DINING_FORMAT_ICON, DINING_FORMAT_LABEL } from './render-shared.js';

// Which Stay a MealOption's includedIn ref is actually about — a plain
// { entity: 'stay' } ref for 'included', or a { entity: 'package' } ref for
// 'package', which requires looking inside each day.stays' own packages[] to
// find the one that owns that package id (see data-model.html's Stay entity).
function stayForIncludedIn(day, includedIn) {
  if (!includedIn) return null;
  if (includedIn.entity === 'stay') return day.stays.find((s) => s._id === includedIn.id) ?? null;
  if (includedIn.entity === 'package') {
    return day.stays.find((s) => s.packages?.some((p) => p._id === includedIn.id)) ?? null;
  }
  return null;
}

// An 'included' or 'package' candidate only actually reads as covered once its
// stay is underway — this same day, before check-in has happened, there's no
// room to have gotten breakfast bundled (or package-covered) into yet (see the
// Stay entity's checkInAt/checkOutAt and trip-model.js's stayRelation). Any
// other diningFormat has no such precondition.
function isIncludedOptionActive(day, option) {
  if (option.diningFormat !== 'included' && option.diningFormat !== 'package') return true;
  const stay = stayForIncludedIn(day, option.includedIn);
  return !!stay && stayRelation(stay, day.date) !== 'Check in';
}

// activity.options (MealOption[]) is only ever set while a meal is genuinely
// undecided among named candidates — see data-model.html's Activity entity.
// Exported so app.js can find the same still-open candidates the row's own
// tabs were built from, to know which one is currently selected.
export function activeMealOptions(activity, day) {
  return activity.options.filter((option) => isIncludedOptionActive(day, option));
}

// Exported for activity-detail-render.js's renderSelectedMealOption, which
// needs the same "what do we call this candidate" logic the row/tabs use.
export function mealOptionLabel(option) {
  return option.place ? option.place.label : DINING_FORMAT_LABEL[option.diningFormat];
}

function renderMealRowImage(option) {
  if (!option) return '';
  const image = firstImage(option.place);
  return image
    ? `<img class="activity-row-image" src="${image.uri}" alt="" loading="lazy">`
    : `<md-icon>${DINING_FORMAT_ICON[option.diningFormat]}</md-icon>`;
}

// A meal Activity with several still-open MealOption candidates renders as
// its own row, shaped like every other activity row (image left, time +
// title right) but with the "title" being whichever candidate is currently
// selected, plus an md-tabs bar underneath for switching candidates — the
// same tabbed pattern as the day's own ideal/alternate scenario tabs
// (day-render.js's renderScenarioTabs), just for "which breakfast" instead of
// "which weather". The header (image + time + selected line) is its own
// <button data-activity-id>, a sibling of the tabs rather than a wrapper
// around them, so a tab click can't bubble into the row's "open the side
// sheet" handler (see app.js's dayListEl listener) — switching candidates is
// a separate action from opening the activity.
export function renderMealRow(activity, day) {
  const options = activeMealOptions(activity, day);
  const selected = options[0] ?? null;
  const tabsHtml = options.length > 1
    ? `
      <md-tabs class="meal-row-tabs">
        ${options
          .map(
            (option, i) => `
            <md-primary-tab inline-icon${i === 0 ? ' active' : ''}>
              <md-icon slot="icon">${DINING_FORMAT_ICON[option.diningFormat]}</md-icon>
              ${DINING_FORMAT_LABEL[option.diningFormat]}
            </md-primary-tab>`
          )
          .join('')}
      </md-tabs>`
    : '';
  return `
    <div class="meal-row" data-filter-tags="${filterTagsFor(activity, day.leg).join(' ')}">
      <div class="row-icon-slot">${renderMealRowImage(selected)}</div>
      <div class="meal-row-body">
        <button type="button" class="meal-row-header" data-activity-id="${activity._id}">
          <span class="meal-row-header-text">
            <span class="meal-row-time md-typescale-label-medium">${timeAndMealTypeLabel(activity)}</span>
            <span class="meal-row-selected md-typescale-body-large">${selected ? mealOptionLabel(selected) : activity.text}</span>
            ${renderTravelerChips(selected?.travelers)}
            ${renderTransitOverlapWarning(activity)}
          </span>
          <md-icon>chevron_right</md-icon>
        </button>
        ${tabsHtml}
      </div>
    </div>`;
}

// Called from app.js's delegated 'change' listener on dayListEl whenever a
// .meal-row-tabs' active tab changes — swaps that row's own image and
// selected-candidate line to match, entirely separate from the side sheet
// (which a meal row only opens via its header button, same as any other
// activity row).
export function syncMealRow(activity, day, tabsEl) {
  const options = activeMealOptions(activity, day);
  const option = options[tabsEl.activeTabIndex];
  if (!option) return;
  const row = tabsEl.closest('.meal-row');
  row.querySelector('.row-icon-slot').innerHTML = renderMealRowImage(option);
  row.querySelector('.meal-row-selected').textContent = mealOptionLabel(option);
  const headerText = row.querySelector('.meal-row-header-text');
  let chipsEl = headerText.querySelector('.traveler-chips');
  if (option.travelers?.length) {
    if (!chipsEl) {
      chipsEl = toNode('<div class="traveler-chips"></div>');
      headerText.append(chipsEl);
    }
    chipsEl.innerHTML = renderTravelerChipsHtml(option.travelers);
  } else if (chipsEl) {
    chipsEl.remove();
  }
}
