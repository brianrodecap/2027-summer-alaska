// Renders the Budget page: the Overview stat strip (a teaser, links to the
// dedicated Budget page) plus that page's own summary and By Leg/By Day/By
// Traveler breakdown tabs (see trip-model.js's buildBudgetView for the
// bucket definitions: spent/pending/estimated/unplanned).

import { formatMoney } from './trip-model.js';
import { toNode, toFragment } from './render-dom.js';

const BUDGET_BUCKET_LABEL = { spent: 'Spent', pending: 'Pending', estimated: 'Estimated', unplanned: 'Unplanned' };
const BUDGET_BUCKET_ICON = { spent: 'paid', pending: 'schedule', estimated: 'request_quote', unplanned: 'help_outline' };

// 'unplanned' has no dollar amount at all (that's the point of the bucket —
// see bookingBucket) so it renders as a count instead of formatMoney.
function formatBudgetBucketAmount(totals, bucket) {
  if (bucket === 'unplanned') return totals.unplannedCount ? `${totals.unplannedCount} not yet costed` : null;
  if (!totals[bucket]) return null;
  return formatMoney({ amount: totals[bucket], currency: totals.currency ?? 'USD' });
}

function renderBudgetTotalsRow(totals) {
  const chips = Object.keys(BUDGET_BUCKET_LABEL)
    .map((bucket) => {
      const value = formatBudgetBucketAmount(totals, bucket);
      if (!value) return '';
      return `
        <span class="budget-chip budget-chip-${bucket}">
          <md-icon>${BUDGET_BUCKET_ICON[bucket]}</md-icon>${value}
        </span>`;
    })
    .join('');
  return `<div class="budget-totals-row">${chips}</div>`;
}

// Shared by the Overview teaser and the Budget page's own summary — same
// four buckets as renderBudgetTotalsRow, just laid out as wider stat cards
// instead of compact chips, and always the trip-wide totals rather than one
// group's.
function budgetStatsHtml(totals) {
  return Object.keys(BUDGET_BUCKET_LABEL)
    .map((bucket) => {
      const value = formatBudgetBucketAmount(totals, bucket);
      if (!value) return '';
      return `
        <div class="budget-stat budget-stat-${bucket}">
          <md-icon>${BUDGET_BUCKET_ICON[bucket]}</md-icon>
          <div>
            <p class="budget-stat-value md-typescale-title-medium">${value}</p>
            <p class="budget-stat-label md-typescale-label-medium">${BUDGET_BUCKET_LABEL[bucket]}</p>
          </div>
        </div>`;
    })
    .join('');
}

// The Overview section's always-visible teaser — a real <button> (matching
// leg-render.js's Leg cards' own day-surface pattern) rather than a plain
// div, since clicking it navigates to the dedicated Budget page (see app.js).
export function renderBudgetStrip(budget) {
  return toNode(`
    <button type="button" class="budget-strip-button" aria-label="View full budget">
      <div class="budget-strip">${budgetStatsHtml(budget.totals)}</div>
    </button>`);
}

function renderBudgetRow(row) {
  const amount = row.bucket === 'unplanned' ? 'Not yet costed' : formatMoney(row.booking.cost);
  return `
    <md-list-item>
      <md-icon slot="start">${BUDGET_BUCKET_ICON[row.bucket]}</md-icon>
      <div slot="headline">${row.label}</div>
      <div slot="supporting-text">${BUDGET_BUCKET_LABEL[row.bucket]}</div>
      <div slot="trailing-supporting-text">${amount}</div>
    </md-list-item>`;
}

function renderBudgetGroup(headline, meta, totals, rows) {
  return `
    <div class="budget-group">
      <div class="budget-group-header">
        <p class="md-typescale-title-small">${headline}</p>
        ${meta ? `<p class="budget-group-meta md-typescale-label-medium">${meta}</p>` : ''}
      </div>
      ${renderBudgetTotalsRow(totals)}
      ${rows.length ? `<md-list>${rows.map(renderBudgetRow).join('')}</md-list>` : ''}
    </div>`;
}

function renderBudgetByLeg(byLeg) {
  if (!byLeg.length) return `<p class="md-typescale-body-medium">Nothing booked or estimated yet.</p>`;
  return byLeg.map((g) => renderBudgetGroup(g.leg.name, null, g.totals, g.rows)).join('');
}

function renderBudgetByDay(byDay) {
  if (!byDay.length) return `<p class="md-typescale-body-medium">Nothing dated has a cost yet.</p>`;
  const note = `<p class="md-typescale-body-small budget-note">Leg-level bundles (like the cruise fare) aren't tied to one day — see the By Leg tab.</p>`;
  return note + byDay.map((g) => renderBudgetGroup(g.day.dateLabel, g.day.title, g.totals, g.rows)).join('');
}

function renderBudgetByTraveler(byTraveler) {
  const note = `<p class="md-typescale-body-small budget-note">A cost with no per-passenger fare split is divided evenly across every traveler — an inferred share, not an authored one.</p>`;
  return note + byTraveler.map((g) => renderBudgetGroup(g.name, null, g.totals, [])).join('');
}

// The Budget page's own top section — the same big stat cards the Overview
// teaser links from, plus the one-time explainer of what each bucket means
// (not worth repeating per breakdown group, so it lives here instead of on
// renderBudgetTotalsRow's compact chips).
export function renderBudgetSummary(budget) {
  return toFragment(`
    <p class="md-typescale-body-large">
      Spent and pending are what's actually booked; estimated and unplanned are still just the plan.
      ${budget.today ? `Pending balances are whatever's still due as of ${budget.today}.` : ''}
    </p>
    <div class="budget-strip">${budgetStatsHtml(budget.totals)}</div>
  `);
}

// The Budget page's By Leg/By Day/By Traveler tabs — a separate section from
// renderBudgetSummary above so app.js can mount "summary on top, breakdowns
// below" as two independent page sections rather than one combined blob.
export function renderBudgetBreakdowns(budget) {
  return toFragment(`
    <md-tabs class="budget-tabs">
      <md-primary-tab inline-icon active><md-icon slot="icon">route</md-icon>By Leg</md-primary-tab>
      <md-primary-tab inline-icon><md-icon slot="icon">calendar_month</md-icon>By Day</md-primary-tab>
      <md-primary-tab inline-icon><md-icon slot="icon">group</md-icon>By Traveler</md-primary-tab>
    </md-tabs>
    <div class="budget-panels">
      <div class="budget-panel">${renderBudgetByLeg(budget.byLeg)}</div>
      <div class="budget-panel" hidden>${renderBudgetByDay(budget.byDay)}</div>
      <div class="budget-panel" hidden>${renderBudgetByTraveler(budget.byTraveler)}</div>
    </div>
  `);
}
