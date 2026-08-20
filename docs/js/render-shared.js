// Small render helpers and vocabulary reused across leg cards, the day list,
// activity rows, and the activity detail side sheet — nothing here is scoped
// to just one of those surfaces (see docs/data/2027-summer-alaska/*.json's
// schema in docs/data/data-model.html for the entity shapes these draw on).

import { formatMoney, activityTimeLabel } from './trip-model.js';

// ---------- images: every entity carries images: Image[] — { uri, credit,
// caption } (see docs/data/data-model.html) — a list rather than one field so
// a hand-sourced reference photo and later personal trip photos can coexist.
// Rendering only ever draws the first entry; nothing here picks among many yet.

export function firstImage(entity) {
  return entity?.images?.[0] ?? null;
}

export function renderImg(image, className) {
  if (!image) return '';
  return `<img class="${className}" src="${image.uri}" alt="${image.caption ?? ''}" title="${image.credit ?? ''}" loading="lazy">`;
}

// ---------- notes ----------

const NOTE_ICON = { warning: 'warning', info: 'info', footnote: 'notes' };

function renderNote(note) {
  return `
    <p class="detail-note note-${note.kind} md-typescale-body-medium">
      <md-icon>${NOTE_ICON[note.kind] ?? 'info'}</md-icon> <span>${note.text}</span>
    </p>`;
}

export function renderNotes(notes) {
  return (notes ?? []).map(renderNote).join('');
}

// ---------- booking chip ----------

// Booking is optional on Leg/Stay/Transit/Activity — present only when an
// actual reservation applies (see docs/data/data-model.html, principle 4).
export function renderBookingChip(booking) {
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

// ---------- transit-overlap warning ----------

// Set on an Activity (trip-model.js's transitOverlapFor) whenever its startAt
// falls inside some Transit's own departsAt–arrivesAt span — a real stop
// belongs on the Route as a waypoint instead, so this renders as a
// visible, error-toned flag on the row rather than passing silently.
export function renderTransitOverlapWarning(activity) {
  if (!activity.transitOverlapWarning) return '';
  return `
    <div class="transit-overlap-chip md-typescale-label-medium">
      <md-icon>warning</md-icon>
      <span>${activity.transitOverlapWarning}</span>
    </div>`;
}

// ---------- row edit button ----------

// The pencil trailing every Stay/Transit-depart row, opening the standalone
// #edit-dialog popup (app.js) for that entity — a sibling of the row's own
// interactive element rather than nested inside it, same move
// meal-row-render.js's renderMealRow already makes for its tabs vs. its
// header button, so a pencil click can't double-fire the row's own "open"
// handler and there's no real `<button>`-in-`<button>` nesting to worry about.
// A plain Activity row has no pencil of its own — its side sheet's header
// edit button (app.js's openActivity) opens this same popup instead.
export function renderEditButton(kind, id) {
  return `<md-icon-button class="row-edit-button" data-edit-${kind}-id="${id}" aria-label="Edit">
    <md-icon>edit</md-icon>
  </md-icon-button>`;
}

// ---------- traveler chips — who's actually part of a day-list row. Two
// different rules feed the same `.travelers` field a row reads (see
// trip-model.js's resolveMealTravelers/resolveExcursionTravelers): a meal
// row always carries one (every traveler, or a Package-restricted subset —
// a meal always has real attendees, so "everyone" is worth showing same as
// a restricted two), while a plain activity row only carries one when it's
// an excursion with an explicitly authored, partial roster — the ordinary
// case (no excursion roster authored) is null, rendering nothing, since
// there's nothing to flag. First names only: compact enough for a day-list
// row, still legible for a four-person family trip. Named "chip" rather
// than "pill" to match this codebase's existing terminology for the same
// small-capsule shape — see renderBookingChip above and .budget-chip
// (budget-render.js). ----------

export function renderTravelerChipsHtml(names) {
  return (names ?? []).map((n) => `<span class="traveler-chip">${n.split(' ')[0]}</span>`).join('');
}

export function renderTravelerChips(names) {
  if (!names?.length) return '';
  return `<div class="traveler-chips">${renderTravelerChipsHtml(names)}</div>`;
}

// ---------- dining-format / meal-slot vocabulary — shared by the plain
// activity row (activity-row-render.js), the meal row and its option tabs
// (meal-row-render.js), and the activity detail side sheet
// (activity-detail-render.js). ----------

export const DEFAULT_PLACE_ICON = 'place';

export const DINING_FORMAT_ICON = {
  included: 'redeem',
  package: 'local_offer',
  'sit-down': 'restaurant',
  'grab-and-go': 'takeout_dining',
  drivethru: 'directions_car',
  'self-catered': 'kitchen',
};

export const DINING_FORMAT_LABEL = {
  included: 'Included',
  package: 'Package',
  'sit-down': 'Sit-down',
  'grab-and-go': 'Grab-and-go',
  drivethru: 'Drive-thru',
  'self-catered': 'Self-catered',
};

// mealType is which meal slot this is (independent of diningFormat, which is
// how the food actually happens — see data-model.html) — the one axis every
// meal Activity carries regardless of whether it's a plain row or a
// multi-candidate meal row, so it's folded into the row's own time label
// (activityTimeLabel · mealType) the same way everywhere else in this
// codebase joins meta bits with " · " (leg dates, booking bits, stay in/out
// times).
const MEAL_TYPE_LABEL = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

// Every day-list row leads with "time · type" on its overline — mealType for
// a meal Activity, 'Activity' for a plain one — matching Depart/Via/Waypoint/
// Arrive's own time-plus-type overline (day-render.js's renderTransitBoundary
// / renderTransitStage) and Stay's relation-only one (renderStay).
export function timeAndMealTypeLabel(activity) {
  const time = activityTimeLabel(activity);
  return `${time} · ${activity.mealType ? MEAL_TYPE_LABEL[activity.mealType] : 'Activity'}`;
}
