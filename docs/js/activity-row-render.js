// Renders one row of the day list's activity section — a plain, single-
// candidate Activity. A meal Activity with several still-open MealOption
// candidates is delegated to meal-row-render.js's renderMealRow instead. See
// docs/js/day-render.js's renderSection, which maps this over a
// scenario/day's activities.

import { filterTagsFor } from './trip-model.js';
import { firstImage, renderBookingChip, renderTravelerChips, renderTransitOverlapWarning, timeAndMealTypeLabel, DEFAULT_PLACE_ICON, DINING_FORMAT_ICON } from './render-shared.js';
import { renderMealRow } from './meal-row-render.js';

// Every activity row needs *something* in the leading slot — a missing one
// collapses md-list-item's reserved leading column, so rows without a photo
// render with their headline flush against the edge instead of lined up with
// the rows that do have one. Activities don't carry an explicit category
// field (data-model.html) — a committed meal's diningFormat is the only
// synchronous signal richer than "does this activity name a place at all".
function activityRowIcon(activity) {
  if (activity.diningFormat) return DINING_FORMAT_ICON[activity.diningFormat];
  if (activity.place) return DEFAULT_PLACE_ICON;
  return 'event';
}

export function renderActivityRow(activity, day) {
  if (activity.options?.length) return renderMealRow(activity, day);
  const image = firstImage(activity) ?? firstImage(activity.place);
  const startSlot = image
    ? `<div slot="start" class="row-icon-slot"><img class="activity-row-image" src="${image.uri}" alt="" loading="lazy"></div>`
    : `<div slot="start" class="row-icon-slot"><md-icon>${activityRowIcon(activity)}</md-icon></div>`;
  const supportingBits = [renderTravelerChips(activity.travelers), renderBookingChip(activity.booking), renderTransitOverlapWarning(activity)]
    .filter(Boolean)
    .join('');
  const supportingSlot = supportingBits ? `<div slot="supporting-text">${supportingBits}</div>` : '';
  const filterTags = filterTagsFor(activity, day.leg).join(' ');
  return `
    <md-list-item type="button" data-activity-id="${activity._id}" data-filter-tags="${filterTags}">
      ${startSlot}
      <div slot="overline">${timeAndMealTypeLabel(activity)}</div>
      <div slot="headline">${activity.text}</div>
      ${supportingSlot}
      <md-icon slot="end">chevron_right</md-icon>
    </md-list-item>`;
}
