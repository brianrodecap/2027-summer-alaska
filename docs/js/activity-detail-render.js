// Renders the activity side sheet's body — an Activity's (or a meal's
// selected MealOption's) own detail, plus the live Google Places lookup
// panel for whichever real-world place it names. Opened from an
// activity/meal row (activity-row-render.js / meal-row-render.js) via
// app.js's openActivity; places.js hydrates the live-lookup panel this
// module leaves a placeholder for.

import { toFragment } from './render-dom.js';
import { firstImage, renderImg, renderBookingChip, renderNotes, DEFAULT_PLACE_ICON, DINING_FORMAT_ICON, DINING_FORMAT_LABEL } from './render-shared.js';
import { mealOptionLabel } from './meal-row-render.js';

// Maps a live Place's primaryType (Places API (New) — see places.js's FIELD_MASK)
// to a Material Symbol for the side-sheet header icon. Meal options skip this
// entirely and use DINING_FORMAT_ICON instead (known synchronously, and "how
// you're eating" reads better there than the venue's raw category) — this map
// only covers non-meal, place-bearing activities, whose icon isn't known until
// hydratePlaceDetails resolves (see app.js's openActivity).
const PLACE_TYPE_ICON = {
  museum: 'museum',
  art_gallery: 'palette',
  tourist_attraction: 'attractions',
  visitor_center: 'info',
  park: 'park',
  national_park: 'park',
  hiking_area: 'hiking',
  campground: 'cabin',
  rv_park: 'rv_hookup',
  lodging: 'hotel',
  hotel: 'hotel',
  restaurant: 'restaurant',
  cafe: 'local_cafe',
  bakery: 'bakery_dining',
  bar: 'local_bar',
  brewery: 'sports_bar',
  grocery_store: 'local_grocery_store',
  supermarket: 'local_grocery_store',
  gas_station: 'local_gas_station',
  airport: 'flight',
  zoo: 'pets',
  aquarium: 'water',
  natural_feature: 'terrain',
  store: 'storefront',
};

// The icon to show before a live type is known (activityDetailTitle, below)
// and what places.js's hydration callback swaps it for once resolved.
export function placeTypeIcon(details) {
  return PLACE_TYPE_ICON[details?.primaryType] ?? DEFAULT_PLACE_ICON;
}

// A meal Activity's own place is never on activity.place (only options are —
// see data-model.html) — the side sheet needs whichever candidate is
// currently selected in the row instead, passed in as selectedOption (see
// app.js's openActivity, which reads it off the row's own tab state right
// before opening).
function renderSelectedMealOption(option) {
  if (!option) return '';
  // option.place's own label is already shown as the side-sheet's header
  // title (see app.js's openActivity) — only repeat it here when there's no
  // place, i.e. the label being shown is the dining format itself.
  const nameLine = option.place ? '' : `<p class="md-typescale-title-medium">${mealOptionLabel(option)}</p>`;
  const secondary = option.place ? DINING_FORMAT_LABEL[option.diningFormat] : null;
  return `
    ${nameLine}
    ${secondary ? `<p class="md-typescale-body-medium">${secondary}</p>` : ''}
    ${option.note ? `<p class="md-typescale-body-medium">${option.note}</p>` : ''}
  `;
}

// The side sheet's own header title (see app.js's openActivity) — just the
// place's name, preceded by its dining-format icon when it's a meal option
// (the same icon as that option's row/tab in meal-row-render.js).
export function activityDetailTitle(activity, selectedOption) {
  const place = selectedOption ? selectedOption.place : activity.place;
  if (!place) return '';
  // A meal option's dining format is known synchronously; any other place's
  // category icon isn't known until hydratePlaceDetails resolves, so it starts
  // on the generic default and app.js swaps it via this class once loaded.
  const icon = selectedOption
    ? `<md-icon>${DINING_FORMAT_ICON[selectedOption.diningFormat]}</md-icon>`
    : `<md-icon class="detail-title-icon">${DEFAULT_PLACE_ICON}</md-icon>`;
  return `${icon}${place.label}`;
}

// Only draws on fields the data model already has. When an activity (or a
// meal's selected option) names a real-world place (place = { id, label }, a
// pinned Google Place ID — see docs/js/places.js), a loading placeholder is
// left in the markup; app.js hands it to places.js after the side sheet
// opens, which fetches live hours/website/map link and fills it in (or falls
// back gracefully).
export function renderActivityDetailBody(activity, selectedOption) {
  const place = selectedOption ? selectedOption.place : activity.place;
  // Only a Place with a real Google Place id gets the live-lookup panel — a
  // named-but-unresolved place (place.id: null, e.g. a shipboard restaurant
  // with no static geolocation to look up — see data-model.html's Place
  // entity) has nothing for places.js to fetch, so skip straight past it
  // rather than showing a loading spinner that can only ever resolve to
  // "unavailable".
  const placePanel = place?.id ? `<div class="place-panel"><md-circular-progress indeterminate></md-circular-progress></div>` : '';
  const image = firstImage(activity) ?? firstImage(place);

  const body = toFragment(`
    ${renderImg(image, 'activity-detail-image')}
    ${selectedOption ? renderSelectedMealOption(selectedOption) : `<p class="md-typescale-body-large">${activity.text}</p>`}
    ${renderBookingChip(activity.booking)}
    ${renderNotes(activity.notes)}
    ${placePanel}
  `);
  return body;
}

// Fields fetched are deliberately limited to Enterprise-tier (hours/website/map
// link) — see places.js for why photos/rating/reviews are left out for now.
export function renderPlaceDetails(place) {
  const hours = place.regularOpeningHours;
  const hoursHtml = hours
    ? `
      <div class="place-row">
        <md-icon>schedule</md-icon>
        <div>
          <p class="md-typescale-body-medium">${hours.openNow ? 'Open now' : 'Closed now'}</p>
          <ul class="place-hours">
            ${hours.weekdayDescriptions.map((line) => `<li class="md-typescale-body-small">${line}</li>`).join('')}
          </ul>
        </div>
      </div>`
    : '';

  const addressHtml = place.formattedAddress
    ? `
      <div class="place-row">
        <md-icon>place</md-icon>
        <p class="md-typescale-body-medium">${place.formattedAddress}</p>
      </div>`
    : '';

  return toFragment(`
    ${addressHtml}
    ${hoursHtml}
    <div class="place-links">
      ${place.websiteUri ? `<a class="place-link md-typescale-label-large" href="${place.websiteUri}" target="_blank" rel="noopener">Website</a>` : ''}
      ${place.googleMapsUri ? `<a class="place-link md-typescale-label-large" href="${place.googleMapsUri}" target="_blank" rel="noopener">View on Google Maps</a>` : ''}
    </div>
  `);
}

// Fallback shown when the API key isn't configured yet or a lookup fails —
// still gives a working outbound link so the feature degrades rather than
// dies. Uses query_place_id when we have the pinned id (an exact deep link
// to the right business), falling back to a plain text search otherwise.
export function renderPlaceUnavailable(place, message = 'Live details unavailable right now.') {
  const mapsUrl = place.id
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.label)}&query_place_id=${place.id}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.label)}`;

  return toFragment(`
    <p class="place-error md-typescale-body-medium">${message}</p>
    <div class="place-links">
      <a class="place-link md-typescale-label-large" href="${mapsUrl}" target="_blank" rel="noopener">Search Google Maps</a>
    </div>
  `);
}
