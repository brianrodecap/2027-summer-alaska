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

// ---------- images: every entity carries images: Image[] — { uri, credit,
// caption } (see docs/data/data-model.html) — a list rather than one field so
// a hand-sourced reference photo and later personal trip photos can coexist.
// Rendering only ever draws the first entry; nothing here picks among many yet.

export function firstImage(entity) {
  return entity?.images?.[0] ?? null;
}

function renderImg(image, className) {
  if (!image) return '';
  return `<img class="${className}" src="${image.uri}" alt="${image.caption ?? ''}" title="${image.credit ?? ''}" loading="lazy">`;
}

// ---------- Leg card (Overview) + Leg dialog ----------

export function renderLegCard(summary) {
  const { leg, days } = summary;
  const range = days.length ? `${days[0].dateLabel} – ${days[days.length - 1].dateLabel}` : '';
  return toNode(`
    <button type="button" class="day-surface leg-surface" data-leg-id="${leg._id}">
      <md-elevation></md-elevation>
      ${renderImg(firstImage(leg), 'leg-surface-image')}
      <div class="leg-surface-body">
        <span class="day-surface-date md-typescale-label-medium">${range} · ${days.length} days</span>
        <h3 class="day-surface-title md-typescale-title-medium">${leg.name}</h3>
        ${leg.booking ? renderBookingChip(leg.booking) : `<p class="md-typescale-body-medium">Booked piece by piece — no single reservation.</p>`}
      </div>
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
    ${renderImg(firstImage(leg), 'leg-dialog-image')}
    <p class="md-typescale-body-medium">${leg.startDate} – ${leg.endDate} · ${days.length} days · <span class="status-label">${leg.status}</span></p>
    ${bookingBlock}
    ${renderNotes(notes)}
    <md-divider></md-divider>
    ${renderLegDayList(days)}
  `);
}

// ---------- Day detail (rendered inline into each day-block) ----------

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

// Leading slot shared by Stay and Transit blocks — a photo when the entity
// has one, else its type icon — always in the same .row-icon-slot column
// activity rows and meal rows use, so every row in the day list lines its
// headline text up at the same x regardless of which kind of row it is.
function renderRowIconSlot(entity, fallbackIcon) {
  const image = firstImage(entity);
  const content = image
    ? `<img class="activity-row-image" src="${image.uri}" alt="" loading="lazy">`
    : `<md-icon>${fallbackIcon}</md-icon>`;
  return `<div class="row-icon-slot">${content}</div>`;
}

function renderStay(stay, date) {
  const name = stay.lodging?.name ?? 'Lodging still open';
  const detailBits = [stay.lodging?.roomType, stay.lodging?.roomNumber && `Room/cabin ${stay.lodging.roomNumber}`, stay.lodging?.campsite, stay.lodging?.bedConfiguration].filter(Boolean);
  return `
    <div class="stay-block">
      ${renderRowIconSlot(stay, 'hotel')}
      <div class="stay-block-content">
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
      ${renderRowIconSlot(transit, transit.mode === 'flight' ? 'flight' : 'directions_car')}
      <div class="stay-block-content">
        <p class="md-typescale-title-small">${transit.from.label} → ${transit.to.label}</p>
        <p class="md-typescale-body-small">${formatTime(transit.departsAt)} – ${formatTime(transit.arrivesAt)}</p>
        ${renderBookingChip(transit.booking)}
      </div>
    </div>`;
}

// Every activity row needs *something* in the leading slot — a missing one
// collapses md-list-item's reserved leading column, so rows without a photo
// render with their headline flush against the edge instead of lined up with
// the rows that do have one (see DEFAULT_PLACE_ICON/DINING_FORMAT_ICON,
// defined below — this only ever runs after the module has finished
// evaluating, so referencing them ahead of their declaration here is fine).
// Activities don't carry an explicit category field (data-model.html) — a
// committed meal's diningFormat is the only synchronous signal richer than
// "does this activity name a place at all."
function activityRowIcon(activity) {
  if (activity.diningFormat) return DINING_FORMAT_ICON[activity.diningFormat];
  if (activity.place) return DEFAULT_PLACE_ICON;
  return 'event';
}

function renderActivityRow(activity, day) {
  if (activity.options?.length) return renderMealRow(activity, day);
  const image = firstImage(activity) ?? firstImage(activity.place);
  const startSlot = image
    ? `<div slot="start" class="row-icon-slot"><img class="activity-row-image" src="${image.uri}" alt="" loading="lazy"></div>`
    : `<div slot="start" class="row-icon-slot"><md-icon>${activityRowIcon(activity)}</md-icon></div>`;
  return `
    <md-list-item type="button" data-activity-id="${activity._id}">
      ${startSlot}
      <div slot="overline">${activityTimeLabel(activity)}</div>
      <div slot="headline">${activity.text}</div>
      <md-icon slot="end">chevron_right</md-icon>
    </md-list-item>`;
}

function renderSection(section, day) {
  const items = section.activities.map((activity) => renderActivityRow(activity, day)).join('');
  return `<md-divider></md-divider><md-list>${items}</md-list>`;
}

function renderSequenceItem(item, day) {
  if (item.type === 'stay') return renderStay(item.stay, day.date);
  if (item.type === 'transit') return renderTransit(item.transit);
  return renderSection(item, day);
}

// A branching day's scenarios each become one md-primary-tab; the tab bar
// picks which branch's own timeline shows below by toggling that scenario's
// panel — the tabs *are* the "which branch" indicator MD3's chip-per-section
// used to be, so a track's own panel carries no chip of its own. Each
// scenario's notes (Note.concerns entity:scenario — see trip-model.js) render
// once at the top of that scenario's panel, not repeated per activity.
function renderScenarioTabs(day) {
  const tracks = day.scenarioTracks;
  if (!tracks.length) return '';
  const tabs = tracks
    .map(
      (track, i) => `
      <md-primary-tab class="tone-${track.scenario.tone}" inline-icon${i === 0 ? ' active' : ''}>
        <md-icon slot="icon">${track.scenario.icon}</md-icon>
        ${track.scenario.label}
      </md-primary-tab>`
    )
    .join('');
  const panels = tracks
    .map(
      (track, i) => `
      <div class="scenario-panel"${i === 0 ? '' : ' hidden'}>
        ${renderNotes(track.notes)}
        ${track.sequence.map((item) => renderSequenceItem(item, day)).join('')}
      </div>`
    )
    .join('');
  return `<md-tabs class="scenario-tabs">${tabs}</md-tabs><div class="scenario-panels">${panels}</div>`;
}

// Clicking a tab only needs to show its own panel and hide the rest — no
// re-render, since every branch's/option's content is already in the DOM.
// Shared by the scenario tabs above and the meal-option tabs below.
function wireTabs(root, tabsSelector, panelSelector) {
  const tabsEl = root.querySelector(tabsSelector);
  if (!tabsEl) return;
  const panels = root.querySelectorAll(panelSelector);
  tabsEl.addEventListener('change', () => {
    panels.forEach((panel, i) => { panel.hidden = i !== tabsEl.activeTabIndex; });
  });
}

// A Stay's check-in/check-out events are keyed to their own clock time (see
// trip-model.js's stayEventKey) so they sort into day.sequence wherever that
// falls — but a branching day's own activities render separately, as the tab
// group below, regardless of their times. Rather than let an 11am formal
// checkout land after a 6:30am departure, or a mid-afternoon check-in land
// ahead of an 8am breakfast, checkout is always shown first and check-in
// always last: each reads as "leaving here"/"staying here tonight" context
// for the day rather than a scheduled event competing with the timeline
// between them.
function splitOutStayBoundaries(sequence) {
  const checkOuts = sequence.filter((item) => item.type === 'stay' && item.relation === 'Check out');
  const checkIns = sequence.filter((item) => item.type === 'stay' && item.relation === 'Check in');
  const rest = sequence.filter((item) => !checkOuts.includes(item) && !checkIns.includes(item));
  return { checkOuts, rest, checkIns };
}

// day.sequence (built in trip-model.js) is already the real chronological
// order for everything that doesn't branch — Stay check-in/check-out events,
// plus any non-branching Transit/Activity — merged by their own timestamp,
// but today's checkout/check-in events are pulled out to the front/back of
// the rendered order — see splitOutStayBoundaries above. Branching material
// (day.scenarioTracks) renders after the rest, as the tab group.
export function renderDayDetailBody(day) {
  const { checkOuts, rest, checkIns } = splitOutStayBoundaries(day.sequence);
  const checkOutHtml = checkOuts.map((item) => renderSequenceItem(item, day)).join('');
  const itemsHtml = rest.map((item) => renderSequenceItem(item, day)).join('');
  const tabsHtml = renderScenarioTabs(day);
  const checkInHtml = checkIns.map((item) => renderSequenceItem(item, day)).join('');
  const emptyHtml = checkOutHtml || itemsHtml || tabsHtml || checkInHtml ? '' : `<p class="md-typescale-body-medium">Nothing scheduled yet.</p>`;

  const body = toFragment(`
    ${renderNotes(day.notes)}
    ${checkOutHtml}
    ${itemsHtml}
    ${tabsHtml}
    ${checkInHtml}
    ${emptyHtml}
  `);
  wireTabs(body, '.scenario-tabs', '.scenario-panel');
  return body;
}

// ---------- day list (main Trip page) ----------
//
// One <section> per Day with a sticky header (date + location) and its full
// Stay/Transit/Activity detail rendered inline underneath. Because each header is
// position: sticky within its own day-block, it stays pinned to the top of
// the viewport while that day's content scrolls past, then hands off to the
// next day's header the moment this one's block scrolls out of view — no JS
// scroll tracking required, just the CSS sticky-per-group pattern.
export function renderDayBlock(day) {
  const section = toNode(`
    <section class="day-block" id="day-${day.date}">
      <div class="day-block-header">
        <span class="day-block-date md-typescale-label-large">${day.dateLabel}</span>
        <h3 class="day-block-title md-typescale-title-medium">${day.title}</h3>
      </div>
      <div class="day-block-body"></div>
    </section>
  `);
  section.querySelector('.day-block-body').append(renderDayDetailBody(day));
  return section;
}

// ---------- Activity side sheet ----------

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
const DEFAULT_PLACE_ICON = 'place';

// The icon to show before a live type is known (activityDetailTitle, below)
// and what places.js's hydration callback swaps it for once resolved.
export function placeTypeIcon(details) {
  return PLACE_TYPE_ICON[details?.primaryType] ?? DEFAULT_PLACE_ICON;
}

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

// Short forms of DINING_FORMAT_LABEL for the compact meal-option tabs — "Included
// with the stay" fits a side-sheet line but not a tab label.
const DINING_FORMAT_PILL_LABEL = {
  included: 'Included',
  'sit-down': 'Sit-down',
  'grab-and-go': 'Grab-and-go',
  drivethru: 'Drive-thru',
  'self-catered': 'Self-catered',
};

// An 'included' candidate only actually reads as "included" once its stay is
// underway — this same day, before check-in has happened, there's no room to
// have gotten breakfast bundled into yet (see the Stay entity's checkInAt/
// checkOutAt and trip-model.js's stayRelation). Any other diningFormat has no
// such precondition.
function isIncludedOptionActive(day, option) {
  if (option.diningFormat !== 'included') return true;
  const stay = day.stays.find((s) => s._id === option.includedIn?.id);
  return !!stay && stayRelation(stay, day.date) !== 'Check in';
}

// activity.options (MealOption[]) is only ever set while a meal is genuinely
// undecided among named candidates — see data-model.html's Activity entity.
// Exported so app.js can find the same still-open candidates the row's own
// tabs were built from, to know which one is currently selected.
export function activeMealOptions(activity, day) {
  return activity.options.filter((option) => isIncludedOptionActive(day, option));
}

function mealOptionLabel(option) {
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
// same tabbed pattern as the day's own ideal/alternate scenario tabs, just
// for "which breakfast" instead of "which weather". The header (image + time
// + selected line) is its own <button data-activity-id>, a sibling of the
// tabs rather than a wrapper around them, so a tab click can't bubble into
// the row's "open the side sheet" handler (see app.js's dayListEl listener) —
// switching candidates is a separate action from opening the activity.
function renderMealRow(activity, day) {
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
              ${DINING_FORMAT_PILL_LABEL[option.diningFormat]}
            </md-primary-tab>`
          )
          .join('')}
      </md-tabs>`
    : '';
  return `
    <div class="meal-row">
      <div class="row-icon-slot">${renderMealRowImage(selected)}</div>
      <div class="meal-row-body">
        <button type="button" class="meal-row-header" data-activity-id="${activity._id}">
          <span class="meal-row-header-text">
            <span class="meal-row-time md-typescale-label-medium">${activityTimeLabel(activity)}</span>
            <span class="meal-row-selected md-typescale-body-large">${selected ? mealOptionLabel(selected) : activity.text}</span>
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
// (the same icon as that option's row/tab elsewhere in the day list).
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
  const placePanel = place ? `<div class="place-panel"><md-circular-progress indeterminate></md-circular-progress></div>` : '';
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
