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
// cost/address/booking-link until the itinerary data actually carries them.
export function renderActivityDetailBody(day, variant, item) {
  const context = variant.label ? `${day.dateLabel} · ${day.location} · ${variant.label}` : `${day.dateLabel} · ${day.location}`;

  return toFragment(`
    <p class="activity-context md-typescale-label-large">${context}</p>
    <h3 class="md-typescale-headline-small">${item.time}</h3>
    <p class="md-typescale-body-large">${item.text}</p>
  `);
}
