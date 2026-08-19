// Renders the computed Day/Leg/Activity views (docs/js/trip-model.js) into
// Material-only DOM: the sticky day list, Leg card/dialog, and the activity
// side-sheet body. Nothing here is content — the itinerary lives entirely in
// docs/data/2027-summer-alaska/*.json.

import { formatTime, formatMoney, activityTimeLabel, stayRelation, dayMapEmbedUrl, dayFullRouteUrl, splitOutStayBoundaries, filterTagsFor } from './trip-model.js';

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

// ---------- Budget — the Overview stat strip (a teaser, links to the
// dedicated Budget page) plus that page's own summary and By Leg/By Day/By
// Traveler breakdown tabs (see trip-model.js's buildBudgetView for the
// bucket definitions: spent/pending/estimated/unplanned). ----------

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
// the Leg cards' own day-surface pattern) rather than a plain div, since
// clicking it navigates to the dedicated Budget page (see app.js).
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

// The pencil trailing every Stay/Transit-depart/plain-Activity row, opening
// the standalone #edit-dialog popup (app.js) for that entity — a sibling of
// the row's own interactive element rather than nested inside it, same move
// renderMealRow already makes for its tabs vs. its header button, so a
// pencil click can't double-fire the row's own "open" handler and there's no
// real `<button>`-in-`<button>` nesting to worry about.
function renderEditButton(kind, id) {
  return `<md-icon-button class="row-edit-button" data-edit-${kind}-id="${id}" aria-label="Edit">
    <md-icon>edit</md-icon>
  </md-icon-button>`;
}

function renderStay(stay, date, leg) {
  const name = stay.lodging?.name ?? 'Lodging still open';
  const detailBits = [stay.lodging?.roomType, stay.lodging?.roomNumber && `Room/cabin ${stay.lodging.roomNumber}`, stay.lodging?.campsite, stay.lodging?.bedConfiguration].filter(Boolean);
  return `
    <div class="stay-block" data-filter-tags="${filterTagsFor(stay, leg).join(' ')}">
      ${renderRowIconSlot(stay, 'hotel')}
      <div class="stay-block-content">
        <p class="md-typescale-title-small">${stayRelation(stay, date)} — ${name}</p>
        <p class="md-typescale-body-small">${formatTime(stay.checkInAt)} in · ${formatTime(stay.checkOutAt)} out</p>
        ${detailBits.length ? `<p class="md-typescale-body-small stay-detail">${detailBits.join(' · ')}</p>` : ''}
        ${stay.lodging?.checkInInstructions ? `<p class="md-typescale-body-small stay-detail">${stay.lodging.checkInInstructions}</p>` : ''}
        ${renderBookingChip(stay.booking)}
      </div>
      ${renderEditButton('stay', stay._id)}
    </div>`;
}

// Route.variants[].tone has its own vocabulary (data-model.html) —
// deliberately not Scenario's ideal/alternate, since a route choice isn't a
// go/no-go safety branch — so route tabs carry a tone-appropriate icon
// instead of the ideal/alternate tone-coloring scenario tabs use.
const ROUTE_TONE_ICON = { direct: 'trending_flat', scenic: 'landscape' };

// A Route with 2+ variants (e.g. the New vs. Old Glenn Highway) is a
// genuinely undecided choice — but its stages (trip-model.js's
// routeStageItems) are now scattered through the day's real chronological
// order rather than sitting together right after Depart (see
// renderTransitBoundary below), so the picker itself can't live alongside
// them the way the day's own scenario tabs sit right above their one
// contiguous panel. It's anchored to the Depart row instead — the one place
// in the timeline that's unambiguously "the start of this route" — and
// wireRouteVariantTabs (below) toggles the scattered stage rows by matching
// data-transit-id/data-route-tone rather than by sibling position.
function renderRouteVariantTabs(transit) {
  const info = transit.routeInfo;
  if (!info || info.variants.length < 2) return '';
  const tabs = info.variants
    .map(
      (v) => `
      <md-primary-tab inline-icon${v.tone === info.selectedTone ? ' active' : ''} data-tone="${v.tone}">
        <md-icon slot="icon">${ROUTE_TONE_ICON[v.tone] ?? 'route'}</md-icon>
        ${v.label}
      </md-primary-tab>`
    )
    .join('');
  return `<md-tabs class="route-tabs" data-transit-id="${transit._id}">${tabs}</md-tabs>`;
}

// A Transit renders as separate "Depart"/"Arrive" boundary rows (their own
// items in day.sequence's real chronological order — trip-model.js's
// transitSequenceItems), so an Activity reached partway through a long drive
// (a lunch stop) still sorts into its own real place between them, instead of
// being hidden inside one opaque Transit block. Each row leads with its time,
// matching every other timed row in the day list (activity rows' own
// overline/headline pattern), rather than the title-first layout Stay rows
// use. A Route's variant picker (renderRouteVariantTabs, above) renders on
// the Depart row when there's a real choice to make — its own stages render
// separately, spread between Depart and Arrive (renderTransitStage, below).
function renderTransitBoundary(item, leg) {
  const { transit, phase } = item;
  const isDepart = phase === 'depart';
  const place = isDepart ? transit.from.label : transit.to.label;
  const time = isDepart ? transit.departsAt : transit.arrivesAt;
  const modeIcon = transit.mode === 'flight' ? 'flight' : 'directions_car';
  // The Transit's own photo (if any) illustrates the journey as a whole, so
  // it only leads the Depart row — repeating the identical image on Arrive
  // as well would just be visual noise, not a second, distinct photo.
  const iconSlot = isDepart ? renderRowIconSlot(transit, modeIcon) : `<div class="row-icon-slot"><md-icon>${modeIcon}</md-icon></div>`;
  return `
    <div class="stay-block" data-filter-tags="${filterTagsFor(transit, leg).join(' ')}">
      ${iconSlot}
      <div class="stay-block-content">
        <p class="md-typescale-label-medium stay-detail">${formatTime(time)}</p>
        <p class="md-typescale-title-small">${isDepart ? 'Depart' : 'Arrive'} ${place}</p>
        ${isDepart ? renderBookingChip(transit.booking) : ''}
        ${isDepart ? renderRouteVariantTabs(transit) : ''}
      </div>
      ${isDepart ? renderEditButton('transit', transit._id) : ''}
    </div>`;
}

// A stage's optional note (e.g. "this is where a Whittier drive splits off")
// surfaces as a title tooltip rather than its own line, so a normally-quiet
// routing detail stays out of the way until someone hovers/long-presses it.
// Every variant's stages are always in the DOM (trip-model.js's
// routeStageItems), each tagged with which Transit and which variant tone it
// belongs to; only the ones matching that Transit's selected/active tone
// start visible — wireRouteVariantTabs flips that per row, scattered
// non-adjacent siblings and all, when the Depart row's tabs change. The
// leading time is stage.key — trip-model.js's stageTimesForVariant walking
// via[]'s durationMinutes from Depart, nudged later by any real Activity
// (a lunch stop, say) actually reached along the way. It's a plan-quality
// estimate, not a live pace/traffic calculation, so treat it the same as any
// other still-being-planned time on this page.
function renderTransitStage(item, leg) {
  const { transit, variant, stage, hidden, key } = item;
  return `
    <div class="stay-block transit-stage-row" data-transit-id="${transit._id}" data-route-tone="${variant.tone}" data-filter-tags="${filterTagsFor(transit, leg).join(' ')}"${hidden ? ' hidden' : ''}>
      <div class="row-icon-slot"><md-icon>signpost</md-icon></div>
      <div class="stay-block-content">
        <p class="md-typescale-label-medium stay-detail">${formatTime(key)}</p>
        <p class="md-typescale-title-small"${stage.note ? ` title="${stage.note}"` : ''}>Via ${stage.label}</p>
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
  const supportingBits = [renderTravelerChips(activity.travelers), renderBookingChip(activity.booking)].filter(Boolean).join('');
  const supportingSlot = supportingBits ? `<div slot="supporting-text">${supportingBits}</div>` : '';
  const filterTags = filterTagsFor(activity, day.leg).join(' ');
  // filterTagsFor's tags are duplicated onto the wrapper as well as the
  // md-list-item itself — applyFilters (filters.js) toggles `.filtered-out`
  // on every [data-filter-tags] match, and the md-list-item copy is what its
  // own "collapse a fully-filtered md-list" pass reads — but only hiding the
  // *wrapper* actually takes the sibling edit button (day-render.js's
  // renderEditButton) down with the row when it's filtered out.
  return `
    <div class="activity-row-wrap" data-filter-tags="${filterTags}">
      <md-list-item type="button" data-activity-id="${activity._id}" data-filter-tags="${filterTags}">
        ${startSlot}
        <div slot="overline">${activityTimeLabel(activity)}</div>
        <div slot="headline">${activity.text}</div>
        ${supportingSlot}
        <md-icon slot="end">chevron_right</md-icon>
      </md-list-item>
      ${renderEditButton('activity', activity._id)}
    </div>`;
}

// ---------- Traveler chips — who's actually part of a day-list row. Two
// different rules feed the same `.travelers` field a row reads (see
// trip-model.js's resolveMealTravelers/resolveExcursionTravelers): a meal
// row always carries one (every traveler, or a Package-restricted subset —
// a meal always has real attendees, so "everyone" is worth showing same as
// a restricted two), while a plain activity row only carries one when it's
// an excursion with an explicitly authored, partial roster — the ordinary
// case (no excursion roster authored) is null, rendering nothing, since
// there's nothing to flag. First names only: compact enough for a day-list
// row, still legible for a four-person family trip. Named "chip" rather
// than "pill" to match this file's existing terminology for the same
// small-capsule shape — see the booking chip (renderBookingChip) and
// .budget-chip.
function renderTravelerChipsHtml(names) {
  return (names ?? []).map((n) => `<span class="traveler-chip">${n.split(' ')[0]}</span>`).join('');
}

function renderTravelerChips(names) {
  if (!names?.length) return '';
  return `<div class="traveler-chips">${renderTravelerChipsHtml(names)}</div>`;
}

function renderSection(section, day) {
  const items = section.activities.map((activity) => renderActivityRow(activity, day)).join('');
  return `<md-list>${items}</md-list>`;
}

function renderSequenceItem(item, day) {
  if (item.type === 'stay') return renderStay(item.stay, day.date, day.leg);
  if (item.type === 'transit-boundary') return renderTransitBoundary(item, day.leg);
  if (item.type === 'transit-stage') return renderTransitStage(item, day.leg);
  // The day's own top-level placeholder (buildSequence, trip-model.js) carries
  // no `tracks` of its own, so it falls back to day.scenarioTracks; a nested
  // one (buildScenarioTracks' own child placeholder) always carries its own.
  if (item.type === 'scenario-tabs') return renderScenarioTabs(day, item.tracks ?? day.scenarioTracks, !item.tracks);
  return renderSection(item, day);
}

// A branching day's scenarios each become one md-primary-tab; the tab bar
// picks which branch's own timeline shows below by toggling that scenario's
// panel — the tabs *are* the "which branch" indicator MD3's chip-per-section
// used to be, so a track's own panel carries no chip of its own. Each
// scenario's notes (Note.concerns entity:scenario — see trip-model.js) render
// once at the top of that scenario's panel, not repeated per activity.
//
// A scenario can declare `followsScenarioDate` (e.g. Jul 1's backup-day
// scenarios follow Jun 30's go/no-go) — data-scenario-date/data-follows-date
// on the rendered <md-tabs> are how wireScenarioFollowers (below) finds the
// pair after both days' blocks are in the DOM, without renderScenarioTabs
// itself needing to know about any other day. Only the top-level call carries
// data-scenario-date/data-follows-date — a nested child group (see
// buildScenarioTracks in trip-model.js) is reached only by whichever parent
// panel it lives inside, so it has no cross-day identity of its own to
// publish or follow.
//
// A followed scenario that isn't just "copy the tone" but genuinely changes
// which options even apply (e.g. Jul 7's tabs mean something different
// depending on whether Jul 6's flight already went) marks each such track's
// scenario with `requiresScenarioId` — an array of the specific upstream
// scenario _ids it applies to, not just a tone. That renders as
// data-requires-scenario on the tab itself; wireScenarioFollowers reads it to
// decide which of this day's tabs even get shown once the followed day's
// pick is known.
function renderScenarioTabs(day, tracks = day.scenarioTracks, topLevel = true) {
  if (!tracks.length) return '';
  const followsDate = topLevel ? tracks[0].scenario.followsScenarioDate ?? null : null;
  const tabs = tracks
    .map((track, i) => {
      const requires = track.scenario.requiresScenarioId
        ? ` data-requires-scenario="${track.scenario.requiresScenarioId.join(',')}"`
        : '';
      return `
      <md-primary-tab class="tone-${track.scenario.tone}" inline-icon${i === 0 ? ' active' : ''} data-scenario-id="${track.scenario._id}"${requires}>
        <md-icon slot="icon">${track.scenario.icon}</md-icon>
        ${track.scenario.label}
      </md-primary-tab>`;
    })
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
  const idAttrs = topLevel ? ` data-scenario-date="${day.date}"${followsDate ? ` data-follows-date="${followsDate}"` : ''}` : '';
  return `<md-tabs class="scenario-tabs"${idAttrs}>${tabs}</md-tabs><div class="scenario-panels">${panels}</div>`;
}

// Clicking a tab only needs to show its own panel and hide the rest — no
// re-render, since every branch's/option's content is already in the DOM.
// Shared by the scenario tabs above and the meal-option tabs below — both
// keep their panel(s) as an immediate sibling of the <md-tabs>. A day can
// hold more than one tab group of the same kind, so every match gets its own
// listener, each keyed to its own panels via nextElementSibling, not a
// single root-wide query. (The route-variant tabs below don't fit this
// pattern — their stage rows are scattered non-adjacent siblings, not one
// contiguous panel — see wireRouteVariantTabs.) `:scope >` keeps this to the
// panel group's own direct children — a nested scenario (e.g. Jul 1's own
// if-flew/if-grounded split inside its alt panel) plants another
// .scenario-panel two levels deeper, which an unscoped query would wrongly
// sweep into the outer group's own panel list.
export function wireTabs(root, tabsSelector, panelSelector) {
  root.querySelectorAll(tabsSelector).forEach((tabsEl) => {
    const panels = tabsEl.nextElementSibling.querySelectorAll(`:scope > ${panelSelector}`);
    tabsEl.addEventListener('change', () => {
      panels.forEach((panel, i) => { panel.hidden = i !== tabsEl.activeTabIndex; });
    });
  });
}

// A route-variant tab bar (renderRouteVariantTabs) lives on the Depart row,
// but the stage rows it controls (renderTransitStage) are spread through the
// rest of the day's timeline by their own interpolated times — not one
// contiguous panel wireTabs (above) could toggle by sibling position. Each
// stage row instead carries data-transit-id/data-route-tone, so switching
// tabs just re-filters every stage row matching this Transit by tone,
// wherever in the day it landed.
function wireRouteVariantTabs(root) {
  root.querySelectorAll('.route-tabs').forEach((tabsEl) => {
    const stageRows = root.querySelectorAll(`.transit-stage-row[data-transit-id="${tabsEl.dataset.transitId}"]`);
    const tabEls = [...tabsEl.querySelectorAll('md-primary-tab')];
    tabsEl.addEventListener('change', () => {
      const tone = tabEls[tabsEl.activeTabIndex].dataset.tone;
      stageRows.forEach((row) => { row.hidden = row.dataset.routeTone !== tone; });
    });
  });
}

// A scenario tab whose data-follows-date names another day's own scenario
// tabs (see renderScenarioTabs) defaults to and stays synced with whichever
// branch is active over there — e.g. Jul 1's backup-day tabs track Jun 30's
// go/no-go instead of asking the reader to remember it and pick again.
// Re-picking the followed day's tab snaps the follower back to match.
//
// Two shapes of "following" both live here:
//  - Plain tone-copy (every follower tab lacks data-requires-scenario, e.g.
//    Jun 30 -> Jul 1): both follower tabs stay visible and clickable, and a
//    followed-day change just re-defaults the follower to whichever of its
//    own tabs shares the followed day's tone.
//  - Gated (a follower tab carries data-requires-scenario — a
//    comma-separated list of specific upstream scenario _ids, not just a
//    tone, since which OPTIONS even apply can differ by upstream branch, not
//    just which is picked — e.g. Jul 7's "bonus flightseeing" pair only
//    applies if Jul 6's original flight already went): a tab whose own
//    requires-list doesn't include the followed day's active scenario id is
//    hidden outright, not just deselected, and the first surviving tab
//    becomes the default. If gating leaves exactly one tab standing (e.g.
//    Jul 8 collapsing to a single guaranteed "bonus day" once both Jul 6 and
//    Jul 7's flights already succeeded), that single tab just renders alone.
//
// A ladder more than one day deep (Jul 8 follows Jul 7 follows Jul 6)
// resolves correctly because every top-level scenario-tabs group — follower
// or not — is walked in date order on every change anywhere in the chain, so
// a later day always reads its own followed day's *just-updated* pick rather
// than a stale one. Called once, after every day block is in the DOM, since
// a follower's target may be a sibling day-block.
export function wireScenarioFollowers(root) {
  const groups = [...root.querySelectorAll('.scenario-tabs[data-scenario-date]')]
    .sort((a, b) => (a.dataset.scenarioDate < b.dataset.scenarioDate ? -1 : a.dataset.scenarioDate > b.dataset.scenarioDate ? 1 : 0));
  const toneOf = (tabEl) => tabEl.className.match(/tone-(\S+)/)[1];

  // Prefers the component's own resolved activeTabIndex (reliable once a
  // real 'change' has fired at least once); falls back to whichever tab we
  // ourselves marked `active` in the rendered markup, for the very first
  // pass before md-tabs (a Lit component) has resolved that property.
  function activeTabEl(tabsEl) {
    const tabEls = [...tabsEl.querySelectorAll(':scope > md-primary-tab')];
    const idx = tabsEl.activeTabIndex;
    if (Number.isInteger(idx) && tabEls[idx] && !tabEls[idx].hidden) return tabEls[idx];
    const visible = tabEls.filter((t) => !t.hidden);
    const pool = visible.length ? visible : tabEls;
    return pool.find((t) => t.hasAttribute('active')) ?? pool[0];
  }

  function applyFollow(tabsEl, followedActiveTab) {
    const tabEls = [...tabsEl.querySelectorAll(':scope > md-primary-tab')];
    const panels = tabsEl.nextElementSibling.querySelectorAll(':scope > .scenario-panel');
    const gated = tabEls.some((t) => t.dataset.requiresScenario);

    let visible = tabEls;
    if (gated && followedActiveTab) {
      const followedId = followedActiveTab.dataset.scenarioId;
      visible = tabEls.filter((t) => !t.dataset.requiresScenario || t.dataset.requiresScenario.split(',').includes(followedId));
    }
    tabEls.forEach((t) => { t.hidden = !visible.includes(t); });
    if (!visible.length) return;

    const targetEl = gated || !followedActiveTab
      ? visible[0] // gating already narrowed things down to the right set(s)
      : visible.find((t) => toneOf(t) === toneOf(followedActiveTab)) ?? visible[0];
    const targetIndex = tabEls.indexOf(targetEl);
    tabsEl.activeTabIndex = targetIndex;
    panels.forEach((p, i) => { p.hidden = i !== targetIndex; });
  }

  function resolveAll() {
    for (const tabsEl of groups) {
      const followsDate = tabsEl.dataset.followsDate;
      if (!followsDate) continue;
      const followedTabs = root.querySelector(`.scenario-tabs[data-scenario-date="${followsDate}"]`);
      if (!followedTabs) continue;
      applyFollow(tabsEl, activeTabEl(followedTabs));
    }
  }

  groups.forEach((tabsEl) => tabsEl.addEventListener('change', resolveAll));
  resolveAll();
}

// day.sequence (built in trip-model.js) is already the real chronological
// order for everything on the day, branching material included — a single
// { type: 'scenario-tabs' } placeholder sits wherever the branching content's
// own earliest real time actually falls (buildScenarioTracks' anchorKey),
// so the tab group renders inline at that point rather than always trailing
// every other event regardless of when it happens. Today's checkout/check-in
// events are still pulled out to the front/back of the rendered order — see
// splitOutStayBoundaries above.
export function renderDayDetailBody(day) {
  const { checkOuts, rest, checkIns } = splitOutStayBoundaries(day.sequence);
  const checkOutHtml = checkOuts.map((item) => renderSequenceItem(item, day)).join('');
  const itemsHtml = rest.map((item) => renderSequenceItem(item, day)).join('');
  const checkInHtml = checkIns.map((item) => renderSequenceItem(item, day)).join('');
  const emptyHtml = checkOutHtml || itemsHtml || checkInHtml ? '' : `<p class="md-typescale-body-medium">Nothing scheduled yet.</p>`;

  const body = toFragment(`
    ${renderNotes(day.notes)}
    ${checkOutHtml}
    ${itemsHtml}
    ${checkInHtml}
    ${emptyHtml}
  `);
  wireTabs(body, '.scenario-tabs', '.scenario-panel');
  wireRouteVariantTabs(body);
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
        <div class="day-block-header-text">
          <span class="day-block-date md-typescale-label-large">${day.dateLabel}</span>
          <h3 class="day-block-title md-typescale-title-medium">${day.title}</h3>
        </div>
        <md-icon-button data-map-date="${day.date}" aria-label="Map for ${day.dateLabel}">
          <md-icon>map</md-icon>
        </md-icon-button>
      </div>
      <div class="day-block-body"></div>
    </section>
  `);
  section.querySelector('.day-block-body').append(renderDayDetailBody(day));
  return section;
}

// ---------- day map sheet (opened via the day-block-header's map button) ----------

// dayMapEmbedUrl (trip-model.js) is null when the day has nothing resolvable
// to map yet (e.g. a still-unplanned day with no places named anywhere) —
// same "degrade gracefully" convention as renderPlaceUnavailable below.
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
  package: 'local_offer',
  'sit-down': 'restaurant',
  'grab-and-go': 'takeout_dining',
  drivethru: 'directions_car',
  'self-catered': 'kitchen',
};

const DINING_FORMAT_LABEL = {
  included: 'Included',
  package: 'Package',
  'sit-down': 'Sit-down',
  'grab-and-go': 'Grab-and-go',
  drivethru: 'Drive-thru',
  'self-catered': 'Self-catered',
};

// Which Stay a MealOption's includedIn ref is actually about — a plain
// { entity: 'stay' } ref for 'included', or a { entity: 'package' } ref for
// 'package', which requires looking inside each day.stays' own packages[] to
// find the one that owns that package id (see data-model.html's Stay entity).
function stayForIncludedIn(day, includedIn) {
  if (!includedIn) return null;
  if (includedIn.entity === 'stay') return day.stays.find((s) => s._id === includedIn.id) ?? null;
  if (includedIn.entity === 'package') {
    return day.stays.find((s) => s.packages?.some((p) => p._id === includedIn.id)) ?? null;
  }
  return null;
}

// An 'included' or 'package' candidate only actually reads as covered once its
// stay is underway — this same day, before check-in has happened, there's no
// room to have gotten breakfast bundled (or package-covered) into yet (see the
// Stay entity's checkInAt/checkOutAt and trip-model.js's stayRelation). Any
// other diningFormat has no such precondition.
function isIncludedOptionActive(day, option) {
  if (option.diningFormat !== 'included' && option.diningFormat !== 'package') return true;
  const stay = stayForIncludedIn(day, option.includedIn);
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
              ${DINING_FORMAT_LABEL[option.diningFormat]}
            </md-primary-tab>`
          )
          .join('')}
      </md-tabs>`
    : '';
  return `
    <div class="meal-row" data-filter-tags="${filterTagsFor(activity, day.leg).join(' ')}">
      <div class="row-icon-slot">${renderMealRowImage(selected)}</div>
      <div class="meal-row-body">
        <button type="button" class="meal-row-header" data-activity-id="${activity._id}">
          <span class="meal-row-header-text">
            <span class="meal-row-time md-typescale-label-medium">${activityTimeLabel(activity)}</span>
            <span class="meal-row-selected md-typescale-body-large">${selected ? mealOptionLabel(selected) : activity.text}</span>
            ${renderTravelerChips(selected?.travelers)}
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
  const headerText = row.querySelector('.meal-row-header-text');
  let chipsEl = headerText.querySelector('.traveler-chips');
  if (option.travelers?.length) {
    if (!chipsEl) {
      chipsEl = toNode('<div class="traveler-chips"></div>');
      headerText.append(chipsEl);
    }
    chipsEl.innerHTML = renderTravelerChipsHtml(option.travelers);
  } else if (chipsEl) {
    chipsEl.remove();
  }
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
