// Renders the day list (main Trip page): one sticky-headered <section> per
// computed Day (docs/js/trip-model.js's buildTripView), with the day's full
// Stay/Transit/Activity detail — plus scenario/route-variant tab wiring —
// rendered inline underneath. Nothing here is content — the itinerary lives
// entirely in docs/data/2027-summer-alaska/*.json.

import { formatTime, stayRelation, filterTagsFor, splitOutStayBoundaries } from './trip-model.js';
import { toNode, toFragment } from './render-dom.js';
import { firstImage, renderNotes, renderBookingChip, renderEditButton } from './render-shared.js';
import { renderActivityRow } from './activity-row-render.js';

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

function renderStay(stay, date, leg) {
  const name = stay.lodging?.name ?? 'Lodging still open';
  const detailBits = [stay.lodging?.roomType, stay.lodging?.roomNumber && `Room/cabin ${stay.lodging.roomNumber}`, stay.lodging?.campsite, stay.lodging?.bedConfiguration].filter(Boolean);
  return `
    <div class="stay-block" data-filter-tags="${filterTagsFor(stay, leg).join(' ')}">
      ${renderRowIconSlot(stay, 'hotel')}
      <div class="stay-block-content">
        <p class="md-typescale-label-medium stay-detail">${stayRelation(stay, date)}</p>
        <p class="md-typescale-title-small">${name}</p>
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
  const chips = info.variants
    .map(
      (v) => `
      <md-filter-chip label="${v.label}"${v.tone === info.selectedTone ? ' selected' : ''} data-tone="${v.tone}">
        <md-icon slot="icon">${ROUTE_TONE_ICON[v.tone] ?? 'route'}</md-icon>
      </md-filter-chip>`
    )
    .join('');
  return `<md-chip-set class="route-tabs" data-transit-id="${transit._id}">${chips}</md-chip-set>`;
}

// A Transit renders as separate "Depart"/"Arrive" boundary rows (their own
// items in day.sequence's real chronological order — trip-model.js's
// transitSequenceItems), so an Activity reached partway through a long drive
// (a lunch stop) still sorts into its own real place between them, instead of
// being hidden inside one opaque Transit block. Each row leads with its time,
// matching every other timed row in the day list (activity-row-render.js's
// own overline/headline pattern), rather than the title-first layout Stay
// rows use. A Route's variant picker (renderRouteVariantTabs, above) renders
// on the Depart row when there's a real choice to make — its own stages
// render separately, spread between Depart and Arrive (renderTransitStage,
// below).
// data-transit-id/data-phase mark this row so app.js's live recompute
// (recomputeRoutedTransits, triggered whenever a route-variant or
// meal-option tab changes anywhere in this day block — see that function's
// own note) can find and patch the Arrive row's own time back in — a routed
// drive's arrival isn't a fixed fact (see arrivesAtOverlineText below), so it
// has to move with whichever route variant and in-transit meal durations are
// currently selected, not just whatever the model computed once at load.
function transitBoundaryOverlineText(time, isDepart) {
  return `${formatTime(time)} · ${isDepart ? 'Depart' : 'Arrive'}`;
}

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
        <p class="md-typescale-label-medium stay-detail transit-boundary-time" data-transit-id="${transit._id}" data-phase="${phase}">${transitBoundaryOverlineText(time, isDepart)}</p>
        <p class="md-typescale-title-small">${place}</p>
        ${isDepart ? renderBookingChip(transit.booking) : ''}
        ${isDepart ? renderRouteVariantTabs(transit) : ''}
      </div>
      ${isDepart ? renderEditButton('transit', transit._id) : ''}
    </div>`;
}

// A stage's kind (data-model.html: 'waypoint' — a real, callable-out stop —
// or 'via' — a point that exists only to steer Directions onto the
// intended road, no stop) picks its overline word, same as Depart/Arrive
// above.
const STAGE_KIND_LABEL = { waypoint: 'Waypoint', via: 'Via' };

// Shared by the initial render below and app.js's live recompute
// (recomputeRoutedTransits) so both ever produce this line the same way —
// a stage's own kind never changes, only its walked time does.
export function stageOverlineText(key, kind) {
  return `${formatTime(key)} · ${STAGE_KIND_LABEL[kind] ?? 'Via'}`;
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
// places[]'s durationMinutes from Depart, nudged later by any real Activity
// (a lunch stop, say) actually reached along the way. It's a plan-quality
// estimate kept live: app.js's recomputeRoutedTransits re-walks it (and
// patches this same overline back in) whenever a route-variant tab or an
// in-transit meal's own option tab changes, rather than only computing it
// once at page load.
function renderTransitStage(item, leg) {
  const { transit, variant, stage, hidden, key } = item;
  return `
    <div class="stay-block transit-stage-row" data-transit-id="${transit._id}" data-route-tone="${variant.tone}" data-filter-tags="${filterTagsFor(transit, leg).join(' ')}"${hidden ? ' hidden' : ''}>
      <div class="row-icon-slot"><md-icon>signpost</md-icon></div>
      <div class="stay-block-content">
        <p class="md-typescale-label-medium stay-detail stage-overline">${stageOverlineText(key, stage.kind)}</p>
        <p class="md-typescale-title-small"${stage.note ? ` title="${stage.note}"` : ''}>${stage.label}</p>
      </div>
    </div>`;
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

// A branching day's scenarios each become one md-filter-chip; the chip group
// picks which branch's own timeline shows below by toggling that scenario's
// panel — the chips *are* the "which branch" indicator, so a track's own
// panel carries no separate chip-per-section of its own. Each
// scenario's notes (Note.concerns entity:scenario — see trip-model.js) render
// once at the top of that scenario's panel, not repeated per activity.
//
// A scenario can declare `followsScenarioDate` (e.g. Jul 1's backup-day
// scenarios follow Jun 30's go/no-go) — data-scenario-date/data-follows-date
// on the rendered <md-chip-set> are how wireScenarioFollowers (below) finds
// the pair after both days' blocks are in the DOM, without renderScenarioTabs
// itself needing to know about any other day. Only the top-level call carries
// data-scenario-date/data-follows-date — a nested child group (see
// buildScenarioTracks in trip-model.js) is reached only by whichever parent
// panel it lives inside, so it has no cross-day identity of its own to
// publish or follow.
//
// A followed scenario that isn't just "copy the tone" but genuinely changes
// which options even apply (e.g. Jul 7's chips mean something different
// depending on whether Jul 6's flight already went) marks each such track's
// scenario with `requiresScenarioId` — an array of the specific upstream
// scenario _ids it applies to, not just a tone. That renders as
// data-requires-scenario on the chip itself; wireScenarioFollowers reads it
// to decide which of this day's chips even get shown once the followed day's
// pick is known.
function renderScenarioTabs(day, tracks = day.scenarioTracks, topLevel = true) {
  if (!tracks.length) return '';
  const followsDate = topLevel ? tracks[0].scenario.followsScenarioDate ?? null : null;
  const chips = tracks
    .map((track, i) => {
      const requires = track.scenario.requiresScenarioId
        ? ` data-requires-scenario="${track.scenario.requiresScenarioId.join(',')}"`
        : '';
      return `
      <md-filter-chip class="tone-${track.scenario.tone}" label="${track.scenario.label}"${i === 0 ? ' selected' : ''} data-scenario-id="${track.scenario._id}"${requires}>
        <md-icon slot="icon">${track.scenario.icon}</md-icon>
      </md-filter-chip>`;
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
  return `<md-chip-set class="scenario-tabs"${idAttrs}>${chips}</md-chip-set><div class="scenario-panels">${panels}</div>`;
}

// Clicking a tab only needs to show its own panel and hide the rest — no
// re-render, since every branch's/option's content is already in the DOM.
// Shared by the scenario chips above and the budget view's own <md-tabs>
// (budget-render.js) — both keep their panel(s) as an immediate sibling of
// the tab/chip group element. A day can hold more than one group of the same
// kind, so every match gets
// its own listener, each keyed to its own panels via nextElementSibling, not
// a single root-wide query. (The route-variant tabs below don't fit this
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

// md-filter-chip has no built-in single-select behavior — clicking one
// doesn't even toggle its own `selected`, since chips are natively
// independent toggles (see M3's filter-chip spec) — so every "choose one of
// several options" group in the day list (a Scenario branch, a Route
// variant, a meal's open MealOption candidates) needs this to become a
// mutually-exclusive picker. It gives a <md-chip-set> of <md-filter-chip>s
// the same activeTabIndex/'change' surface md-tabs used to provide for free,
// since wireScenarioFollowers, wireRouteVariantTabs, and app.js's own
// selection-reading (readDaySelections, recomputeRoutedTransits,
// syncMealRow) all key off exactly those two things and otherwise don't need
// to know chips replaced tabs. activeTabIndex is a real accessor, not a
// plain property, so a direct assignment (wireScenarioFollowers snapping a
// follower to match its followed day) updates which chip shows `selected`
// too, not just the group's own bookkeeping — while only a real click
// dispatches the 'change' event, since programmatic follower updates already
// handle their own panel toggling and shouldn't re-trigger downstream
// recompute.
export function wireChipGroups(root, selector = '.scenario-tabs, .route-tabs, .meal-row-tabs') {
  root.querySelectorAll(selector).forEach((groupEl) => {
    const chips = () => [...groupEl.querySelectorAll(':scope > md-filter-chip')];
    let index = chips().findIndex((c) => c.selected);
    if (index < 0) index = 0;
    Object.defineProperty(groupEl, 'activeTabIndex', {
      get: () => index,
      set(newIndex) {
        index = newIndex;
        chips().forEach((c, i) => { c.selected = i === index; });
      },
    });
    groupEl.addEventListener('click', (event) => {
      const chip = event.target.closest('md-filter-chip');
      const clickedIndex = chip ? chips().indexOf(chip) : -1;
      if (clickedIndex < 0 || clickedIndex === groupEl.activeTabIndex) return;
      groupEl.activeTabIndex = clickedIndex;
      groupEl.dispatchEvent(new Event('change', { bubbles: true }));
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
    const tabEls = [...tabsEl.querySelectorAll('md-filter-chip')];
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

  // Prefers the group's own activeTabIndex (wireChipGroups seeds it from
  // whichever chip rendered `selected`); falls back to reading `selected`
  // straight off the markup in case this group hasn't been wired yet.
  function activeTabEl(tabsEl) {
    const tabEls = [...tabsEl.querySelectorAll(':scope > md-filter-chip')];
    const idx = tabsEl.activeTabIndex;
    if (Number.isInteger(idx) && tabEls[idx] && !tabEls[idx].hidden) return tabEls[idx];
    const visible = tabEls.filter((t) => !t.hidden);
    const pool = visible.length ? visible : tabEls;
    return pool.find((t) => t.hasAttribute('selected')) ?? pool[0];
  }

  function applyFollow(tabsEl, followedActiveTab) {
    const tabEls = [...tabsEl.querySelectorAll(':scope > md-filter-chip')];
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
  wireChipGroups(body);
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
