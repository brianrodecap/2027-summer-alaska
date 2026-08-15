// Shared rendering for a single day's data (see docs/days/*.js) into the three
// Material-only presentations (list item, carousel/card surface, side-sheet body).
// Nothing here is day-specific — the content lives in docs/days/*.js.

function toNode(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

function toFragment(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content;
}

// Footnote markers (<sup><a>) are only meaningful in the full side-sheet body —
// stripped from the list/card blurbs so a link never ends up nested inside the
// button-type md-list-item / <button> that carries the row's own click handler.
function stripFootnotes(html) {
  return html.replace(/<sup>.*?<\/sup>/gs, '');
}

export function renderListItem(day) {
  return toNode(`
    <md-list-item type="button" data-day-id="${day.id}">
      <div slot="overline">${day.dateLabel}</div>
      <div slot="headline">${day.location}</div>
      <div slot="supporting-text">${stripFootnotes(day.summary)}</div>
      <md-icon slot="end">chevron_right</md-icon>
    </md-list-item>
  `);
}

// Used for both the carousel and the cards views — same surface, different
// container layout (scroll-snap row vs. grid) applied in styles.css.
export function renderSurfaceItem(day) {
  return toNode(`
    <button type="button" class="day-surface" data-day-id="${day.id}">
      <md-elevation></md-elevation>
      <span class="day-surface-date md-typescale-label-medium">${day.dateLabel}</span>
      <h3 class="day-surface-title md-typescale-title-medium">${day.location}</h3>
      <p class="md-typescale-body-medium">${stripFootnotes(day.summary)}</p>
    </button>
  `);
}

// Activity rows are clickable (type="button", data-activity + indices) so app.js
// can identify which day/variant/item was tapped and drill into the activity
// side sheet, via event delegation on the day dialog's content.
function renderVariant(variant, variantIndex) {
  const items = variant.items
    .map(
      (item, itemIndex) => `
        <md-list-item type="button" data-activity data-variant-index="${variantIndex}" data-item-index="${itemIndex}">
          <div slot="overline">${item.time}</div>
          <div slot="headline">${item.text}</div>
          <md-icon slot="end">chevron_right</md-icon>
        </md-list-item>`
    )
    .join('');

  const chip = variant.label
    ? `
      <md-chip-set class="variant-chip">
        <md-assist-chip class="tone-${variant.tone}" label="${variant.label}">
          <md-icon slot="icon">${variant.icon}</md-icon>
        </md-assist-chip>
      </md-chip-set>`
    : '';

  return `
    <md-divider></md-divider>
    ${chip}
    <md-list>${items}</md-list>
    ${variant.footer ?? ''}
  `;
}

export function renderDetailBody(day) {
  const notes = (day.notes ?? [])
    .map(
      (note) => `
        <p class="detail-note md-typescale-body-medium">
          <md-icon>${note.icon}</md-icon> ${note.html}
        </p>`
    )
    .join('');

  const body = day.variants.length
    ? day.variants.map((variant, i) => renderVariant(variant, i)).join('')
    : `<p class="md-typescale-body-large">${day.summary}</p>`;

  return toFragment(`
    <md-list>
      <md-list-item>
        <md-icon slot="start">hotel</md-icon>
        <div slot="headline">Hotel</div>
        <div slot="supporting-text">${day.hotel}</div>
      </md-list-item>
      <md-list-item>
        <md-icon slot="start">restaurant</md-icon>
        <div slot="headline">Restaurant</div>
        <div slot="supporting-text">${day.restaurant}</div>
      </md-list-item>
    </md-list>
    ${notes}
    ${body}
  `);
}

// The innermost drill-down level: a single activity, opened from the day
// dialog into the side sheet. Only draws on fields the data model already has
// (time/text + which day and variant it's under) — no speculative fields like
// cost/booking-link until the itinerary data actually carries them.
//
// When an item names a real-world place (item.place = { id, label }, a
// Google Place ID pinned once — see docs/js/places.js — rather than a
// free-text query re-searched on every visit), a loading placeholder is left
// in the markup; app.js hands it to places.js after the side sheet opens,
// which fetches live hours/website/map link and fills it in (or falls back
// gracefully) — kept async and out of this function so rendering the
// activity body itself stays synchronous and pure.
export function renderActivityDetailBody(day, variant, item) {
  const context = variant.label ? `${day.dateLabel} · ${day.location} · ${variant.label}` : `${day.dateLabel} · ${day.location}`;

  const placePanel = item.place
    ? `<div class="place-panel"><md-circular-progress indeterminate></md-circular-progress></div>`
    : '';

  return toFragment(`
    <p class="activity-context md-typescale-label-large">${context}</p>
    <h3 class="md-typescale-headline-small">${item.time}</h3>
    <p class="md-typescale-body-large">${item.text}</p>
    ${placePanel}
  `);
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
