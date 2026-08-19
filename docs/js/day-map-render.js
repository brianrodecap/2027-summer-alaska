// Renders the map sheet opened from a day-block header's map button
// (docs/js/day-render.js's renderDayBlock) — an embedded Google Maps iframe
// for whatever's resolvable to map on that day, plus a link to the full
// route.

import { toFragment } from './render-dom.js';
import { dayMapEmbedUrl, dayFullRouteUrl } from './trip-model.js';

// dayMapEmbedUrl (trip-model.js) is null when the day has nothing resolvable
// to map yet (e.g. a still-unplanned day with no places named anywhere) —
// same "degrade gracefully" convention as activity-detail-render.js's
// renderPlaceUnavailable.
export function renderDayMapSheetBody(day, selections = {}) {
  const url = dayMapEmbedUrl(day, selections);
  const fullRouteUrl = dayFullRouteUrl(day, selections);
  const fullRouteLink = fullRouteUrl
    ? `<div class="place-links"><a class="place-link md-typescale-label-large" href="${fullRouteUrl}" target="_blank" rel="noopener">Open full route in Google Maps</a></div>`
    : '';
  if (!url) return toFragment(`<p class="md-typescale-body-medium">Nothing resolvable to map yet for this day.</p>${fullRouteLink}`);
  return toFragment(`
    <iframe class="day-map-frame" src="${url}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Map for ${day.dateLabel}"></iframe>
    ${fullRouteLink}
  `);
}
