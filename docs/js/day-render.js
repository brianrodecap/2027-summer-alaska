// Renders the computed Day/Leg/Activity views (docs/js/trip-model.js) into
// Material-only DOM: the sticky day list, Leg card/dialog, and the activity
// side-sheet body. Nothing here is content — the itinerary lives entirely in
// docs/data/2027-summer-alaska/*.json.

import { formatTime, formatMoney, activityTimeLabel, stayRelation } from './trip-model.js';

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

// ---------- Leg card (Overview) + Leg dialog ----------

export function renderLegCard(summary) {
  const { leg, days } = summary;
  const range = days.length ? `${days[0].dateLabel} – ${days[days.length - 1].dateLabel}` : '';
  return toNode(`
    <button type="button" class="day-surface leg-surface" data-leg-id="${leg._id}">
      <md-elevation></md-elevation>
      <span class="day-surface-date md-typescale-label-medium">${range} · ${days.length} days</span>
      <h3 class="day-surface-title md-typescale-title-medium">${leg.name}</h3>
      ${leg.booking ? renderBookingChip(leg.booking) : `<p class="md-typescale-body-medium">Booked piece by piece — no single reservation.</p>`}
    </button>
  `);
}

function renderLegBooking(booking) {
  const rows = [renderBookingChip(booking)];
  if (booking.depositPaidAt) rows.push(`<p class="md-typescale-body-small">Deposit paid ${booking.depositPaidAt}</p>`);
  if (booking.finalPaymentDueAt) rows.push(`<p class="md-typescale-body-small">Final payment due ${booking.finalPaymentDueAt}</p>`);
  if (booking.passengers?.length) {
    rows.push(
      `<ul class="passenger-list md-typescale-body-small">${booking.passengers
        .map((p) => `<li>${p.name}: ${formatMoney(p.fare)}</li>`)
        .join('')}</ul>`
    );
  }
  return `<div class="leg-booking">${rows.join('')}</div>`;
}

// Days are grouped by contiguous same-location runs so a multi-day Stay
// (e.g. all 7 cruise days sharing one lodging name) collapses into one
// disclosure instead of repeating that name as every row's headline — the
// row headline uses the day's own summary (first activity, or "Staying at
// X") so days within a run still read as distinct from one another.
function groupDaysByLocation(days) {
  const groups = [];
  for (const day of days) {
    const last = groups[groups.length - 1];
    if (last && last.location === day.location) last.days.push(day);
    else groups.push({ location: day.location, days: [day] });
  }
  return groups;
}

function renderDayRow(d) {
  return `
    <md-list-item type="button" data-day-id="${d.date}">
      <div slot="overline">${d.dateLabel}</div>
      <div slot="headline">${d.summary}</div>
      <md-icon slot="end">chevron_right</md-icon>
    </md-list-item>`;
}

function renderDayGroup(group) {
  const range = `${group.days[0].dateLabel} – ${group.days[group.days.length - 1].dateLabel}`;
  const rows = group.days.map(renderDayRow).join('');
  return `
    <details class="day-group">
      <summary class="day-group-summary">
        <div>
          <p class="md-typescale-title-small">${group.location}</p>
          <p class="day-group-meta md-typescale-label-medium">${range} · ${group.days.length} days</p>
        </div>
        <md-icon class="day-group-chevron">expand_more</md-icon>
      </summary>
      <md-list>${rows}</md-list>
    </details>`;
}

// Consecutive single-day groups share one plain md-list; a run of 2+ days at
// the same location becomes its own collapsible <details> block.
function renderLegDayList(days) {
  const blocks = [];
  let pendingRows = [];
  const flushPending = () => {
    if (pendingRows.length) blocks.push(`<md-list>${pendingRows.join('')}</md-list>`);
    pendingRows = [];
  };
  for (const group of groupDaysByLocation(days)) {
    if (group.days.length === 1) {
      pendingRows.push(renderDayRow(group.days[0]));
    } else {
      flushPending();
      blocks.push(renderDayGroup(group));
    }
  }
  flushPending();
  return blocks.join('');
}

export function renderLegDialogBody(summary) {
  const { leg, days, notes } = summary;
  const bookingBlock = leg.booking
    ? renderLegBooking(leg.booking)
    : `<p class="md-typescale-body-medium">No single reservation for this leg — booked piece by piece as its Stays/Transits/Activities.</p>`;

  return toFragment(`
    <p class="md-typescale-body-medium">${leg.startDate} – ${leg.endDate} · ${days.length} days · <span class="status-label">${leg.status}</span></p>
    ${bookingBlock}
    ${renderNotes(notes)}
    <md-divider></md-divider>
    ${renderLegDayList(days)}
  `);
}

// ---------- Day dialog ----------

const NOTE_ICON = { warning: 'warning', info: 'info', footnote: 'notes' };

function renderNote(note) {
  return `
    <p class="detail-note note-${note.kind} md-typescale-body-medium">
      <md-icon>${NOTE_ICON[note.kind] ?? 'info'}</md-icon> <span>${note.text}</span>
    </p>`;
}

function renderNotes(notes) {
  return (notes ?? []).map(renderNote).join('');
}

// Booking is optional on Leg/Stay/Transit/Activity — present only when an
// actual reservation applies (see docs/data/data-model.html, principle 4).
function renderBookingChip(booking) {
  if (!booking) return '';
  const bits = [];
  if (booking.cost) bits.push(formatMoney(booking.cost));
  if (booking.confirmationNumber) bits.push(`Conf# ${booking.confirmationNumber}`);
  return `
    <div class="booking-row booking-${booking.status} md-typescale-label-medium">
      <md-icon>confirmation_number</md-icon>
      <span>${booking.status[0].toUpperCase()}${booking.status.slice(1)}${bits.length ? ` · ${bits.join(' · ')}` : ''}</span>
    </div>`;
}

function renderStay(stay, date) {
  const name = stay.lodging?.name ?? 'Lodging still open';
  const detailBits = [stay.lodging?.roomType, stay.lodging?.roomNumber && `Room/cabin ${stay.lodging.roomNumber}`, stay.lodging?.campsite, stay.lodging?.bedConfiguration].filter(Boolean);
  return `
    <div class="stay-block">
      <md-icon>hotel</md-icon>
      <div>
        <p class="md-typescale-title-small">${stayRelation(stay, date)} — ${name}</p>
        <p class="md-typescale-body-small">${formatTime(stay.checkInAt)} in · ${formatTime(stay.checkOutAt)} out</p>
        ${detailBits.length ? `<p class="md-typescale-body-small stay-detail">${detailBits.join(' · ')}</p>` : ''}
        ${stay.lodging?.checkInInstructions ? `<p class="md-typescale-body-small stay-detail">${stay.lodging.checkInInstructions}</p>` : ''}
        ${renderBookingChip(stay.booking)}
      </div>
    </div>`;
}

function renderTransit(transit) {
  return `
    <div class="stay-block">
      <md-icon>${transit.mode === 'flight' ? 'flight' : 'directions_car'}</md-icon>
      <div>
        <p class="md-typescale-title-small">${transit.from.label} → ${transit.to.label}</p>
        <p class="md-typescale-body-small">${formatTime(transit.departsAt)} – ${formatTime(transit.arrivesAt)}</p>
        ${renderBookingChip(transit.booking)}
      </div>
    </div>`;
}

function renderActivityRow(activity) {
  return `
    <md-list-item type="button" data-activity-id="${activity._id}">
      <div slot="overline">${activityTimeLabel(activity)}</div>
      <div slot="headline">${activity.text}</div>
      <md-icon slot="end">chevron_right</md-icon>
    </md-list-item>`;
}

function renderSection(section) {
  const chip = section.scenario
    ? `
      <md-chip-set class="variant-chip">
        <md-assist-chip class="tone-${section.scenario.tone}" label="${section.scenario.label}">
          <md-icon slot="icon">${section.scenario.icon}</md-icon>
        </md-assist-chip>
      </md-chip-set>`
    : '';
  const items = section.activities.map(renderActivityRow).join('');
  return `<md-divider></md-divider>${chip}<md-list>${items}</md-list>${renderNotes(section.notes)}`;
}

function renderSequenceItem(item, date) {
  if (item.type === 'stay') return renderStay(item.stay, date);
  if (item.type === 'transit') return renderTransit(item.transit);
  return renderSection(item);
}

// day.sequence (built in trip-model.js) is already the real chronological
// order — Stay check-in/check-out events, Transits, and Activities merged by
// their own timestamp — so rendering it is just a straight map, no bucketing.
export function renderDayDetailBody(day) {
  const itemsHtml = day.sequence.map((item) => renderSequenceItem(item, day.date)).join('') || `<p class="md-typescale-body-medium">Nothing scheduled yet.</p>`;

  return toFragment(`
    ${renderNotes(day.notes)}
    ${itemsHtml}
  `);
}

// ---------- day list (main Trip page) ----------
//
// One <section> per Day with a sticky header (date + location) and its full
// detail — the same Stay/Transit/Activity content that used to live only
// behind the Day dialog — rendered inline underneath. Because each header is
// position: sticky within its own day-block, it stays pinned to the top of
// the viewport while that day's content scrolls past, then hands off to the
// next day's header the moment this one's block scrolls out of view — no JS
// scroll tracking required, just the CSS sticky-per-group pattern.
export function renderDayBlock(day) {
  const section = toNode(`
    <section class="day-block" id="day-${day.date}">
      <div class="day-block-header">
        <span class="day-block-date md-typescale-label-large">${day.dateLabel}</span>
        <h3 class="day-block-title md-typescale-title-medium">${day.location}</h3>
      </div>
      <div class="day-block-body"></div>
    </section>
  `);
  section.querySelector('.day-block-body').append(renderDayDetailBody(day));
  return section;
}

// ---------- Activity side sheet ----------

const DINING_FORMAT_ICON = {
  included: 'redeem',
  'sit-down': 'restaurant',
  'grab-and-go': 'takeout_dining',
  drivethru: 'directions_car',
  'self-catered': 'kitchen',
};

const DINING_FORMAT_LABEL = {
  included: 'Included with the stay',
  'sit-down': 'Sit-down',
  'grab-and-go': 'Grab-and-go',
  drivethru: 'Drive-thru',
  'self-catered': 'Self-catered',
};

// activity.options (MealOption[]) is only ever set while a meal is genuinely
// undecided among named candidates — see data-model.html's Activity entity.
function renderMealOption(option) {
  const headline = option.place ? option.place.label : DINING_FORMAT_LABEL[option.diningFormat];
  const secondary = option.place ? DINING_FORMAT_LABEL[option.diningFormat] : null;
  return `
    <div class="place-row">
      <md-icon>${DINING_FORMAT_ICON[option.diningFormat]}</md-icon>
      <div>
        <p class="md-typescale-body-medium">${headline}</p>
        ${secondary ? `<p class="md-typescale-body-small">${secondary}</p>` : ''}
        ${option.note ? `<p class="md-typescale-body-small">${option.note}</p>` : ''}
      </div>
    </div>`;
}

function renderMealOptions(options) {
  if (!options || !options.length) return '';
  const rows = options.map(renderMealOption).join('');
  return `
    <div class="place-panel">
      <p class="md-typescale-label-large">Still deciding</p>
      ${rows}
    </div>`;
}

// Only draws on fields the data model already has. When an activity names a
// real-world place (activity.place = { id, label }, a pinned Google Place ID
// — see docs/js/places.js), a loading placeholder is left in the markup;
// app.js hands it to places.js after the side sheet opens, which fetches live
// hours/website/map link and fills it in (or falls back gracefully).
export function renderActivityDetailBody(day, scenario, activity) {
  const context = scenario ? `${day.dateLabel} · ${day.location} · ${scenario.label}` : `${day.dateLabel} · ${day.location}`;
  const placePanel = activity.place ? `<div class="place-panel"><md-circular-progress indeterminate></md-circular-progress></div>` : '';

  return toFragment(`
    <p class="activity-context md-typescale-label-large">${context}</p>
    <h3 class="md-typescale-headline-small">${activityTimeLabel(activity)}</h3>
    <p class="md-typescale-body-large">${activity.text}</p>
    ${renderBookingChip(activity.booking)}
    ${renderNotes(activity.notes)}
    ${renderMealOptions(activity.options)}
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
