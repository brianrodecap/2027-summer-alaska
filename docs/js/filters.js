// The trip page's filter navigation: lets a reader narrow the day list down
// to just what's Booked, still needs booking, tagged a highlight, flagged
// with a warning note, or belongs to one leg — see trip-model.js's
// filterTagsFor for the token vocabulary every row is rendered with. This
// module is pure render + the shared apply/match logic — app.js owns the
// live activeTokens state and all wiring.
//
// Landed on an md-menu anchored to a small icon button after comparing it
// live against two other presentations — a chip bar and a leading-edge
// navigation rail (both tried and dropped), and before that a leading-edge
// navigation drawer. "Jump to a day" (the calendar-grid date picker, see
// docs/js/date-picker.js) is a separate, top-level icon button right next to
// this one (see index.html/app.js), not a row inside this menu — it's not a
// filter, so it doesn't belong in the same list as the things that are.

function toFragment(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content;
}

const GROUP_DEFS = [
  {
    id: 'booking',
    label: 'Booking',
    options: [
      { token: 'booking:booked', label: 'Booked', icon: 'check_circle' },
      { token: 'booking:needs', label: 'Needs booking', icon: 'schedule' },
    ],
  },
  {
    id: 'attr',
    label: 'Attributes',
    options: [
      { token: 'attr:highlight', label: 'Highlights', icon: 'star' },
      { token: 'attr:attention', label: 'Needs attention', icon: 'warning' },
    ],
  },
];

// The Leg group is the only one built from live trip data rather than a
// fixed vocabulary — one option per Leg, in the trip's own leg order.
export function buildFilterGroups(view) {
  const legOptions = view.legSummaries.map((s) => ({ token: `leg:${s.leg._id}`, label: s.leg.name, icon: 'route' }));
  return [...GROUP_DEFS, { id: 'leg', label: 'Leg', options: legOptions }];
}

// A row matches when every *represented* group has at least one of its
// tokens active (AND across groups — booking vs. leg are independent
// questions), but any one of a group's own active tokens is enough (OR
// within a group — e.g. selecting both legs shouldn't require a row to
// somehow belong to both). A group nobody has touched yet imposes no
// constraint at all. No active filters at all always matches everything.
export function rowMatches(tagString, activeTokens) {
  if (!activeTokens.size) return true;
  const tags = new Set(tagString.split(' '));
  const activeByGroup = new Map();
  for (const token of activeTokens) {
    const group = token.split(':')[0];
    if (!activeByGroup.has(group)) activeByGroup.set(group, []);
    activeByGroup.get(group).push(token);
  }
  for (const groupTokens of activeByGroup.values()) {
    if (!groupTokens.some((t) => tags.has(t))) return false;
  }
  return true;
}

// Applied directly as a class (not the `hidden` attribute) since several of
// the tagged elements are Lit-based md-* custom elements whose own :host
// styles aren't guaranteed to yield to the browser's default `[hidden]`
// rule — see styles.css's .filtered-out for the !important override that
// actually guarantees it. A day-block with zero surviving rows hides too;
// emptyStateEl surfaces once every day-block has been filtered out.
export function applyFilters(dayListEl, activeTokens, emptyStateEl) {
  dayListEl.querySelectorAll('[data-filter-tags]').forEach((el) => {
    el.classList.toggle('filtered-out', !rowMatches(el.dataset.filterTags, activeTokens));
  });
  // An md-list whose every item just got filtered out still renders as an
  // empty (but visually present) surface otherwise — collapse it too.
  dayListEl.querySelectorAll('md-list').forEach((list) => {
    const items = [...list.querySelectorAll('md-list-item')];
    list.classList.toggle('filtered-out', items.length > 0 && items.every((i) => i.classList.contains('filtered-out')));
  });
  let anyDayVisible = false;
  dayListEl.querySelectorAll('.day-block').forEach((block) => {
    const rows = [...block.querySelectorAll('[data-filter-tags]')];
    const hasVisibleRow = rows.some((r) => !r.classList.contains('filtered-out'));
    block.classList.toggle('filtered-out', rows.length > 0 && !hasVisibleRow);
    if (!rows.length || hasVisibleRow) anyDayVisible = true;
  });
  if (emptyStateEl) emptyStateEl.hidden = anyDayVisible;
}

// ---------- the filter menu — md-menu anchored to a small icon button;
// every row is an md-menu-item with keep-open so picking one filter doesn't
// close the whole menu, so several can be toggled in one visit without
// reopening it each time. ----------

function menuRowHtml(option, active) {
  return `
    <md-menu-item type="button" keep-open data-token="${option.token}">
      <md-icon slot="start">${active ? 'check_box' : 'check_box_outline_blank'}</md-icon>
      <div slot="headline">${option.label}</div>
    </md-menu-item>`;
}

export function renderFilterMenuItems(groups, activeTokens) {
  const groupBlocks = groups
    .map((g, i) => `${i > 0 ? '<md-divider></md-divider>' : ''}${g.options.map((o) => menuRowHtml(o, activeTokens.has(o.token))).join('')}`)
    .join('');
  const clearItem = activeTokens.size
    ? `<md-divider></md-divider><md-menu-item type="button" class="filter-clear-item"><div slot="headline">Clear filters</div></md-menu-item>`
    : '';
  return toFragment(groupBlocks + clearItem);
}
