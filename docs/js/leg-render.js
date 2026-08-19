// Renders the Overview screen's Leg cards and the Leg dialog they open —
// booking summary, notes, and the leg's own day list — from the computed Leg
// summary view (docs/js/trip-model.js's buildLegSummary). Nothing here is
// content — the itinerary lives entirely in docs/data/2027-summer-alaska/*.json.

import { formatMoney } from './trip-model.js';
import { toNode, toFragment } from './render-dom.js';
import { firstImage, renderImg, renderBookingChip, renderNotes } from './render-shared.js';

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
