// M3 time picker — Input variant (https://m3.material.io/components/time-pickers/overview).
// @material/web has no time-picker component at all — a fifth gap alongside
// Card/Side sheet/Date picker/App bar (see CLAUDE.md's component-gap list) —
// and Input is the spec's own text-entry variant, buildable from real md-*
// primitives: two outlined text fields for hour/minute, plus md-tabs for the
// AM/PM toggle — this codebase's existing convention for "choose one of a
// few options" (see meal-row-render.js's renderMealRow, day-render.js's
// renderRouteVariantTabs) rather than the labs/segmentedbutton* components
// that would otherwise be the obvious M3 fit: esm.run/jsdelivr bundles each
// top-level @material/web import independently, and a labs/segmentedbutton
// import's own internal md-focus-ring registration collides with the one
// app.js's single `@material/web/all.js` import already bundled, throwing
// and aborting the whole module graph. md-tabs is already part of that same
// all.js bundle, so reusing it here carries none of that risk. The spec's
// other variant, Dial (a draggable clock face), would also mean inventing
// pointer-drag angle math and an hour/minute mode switch from scratch —
// Input covers the same value with far less bespoke surface either way.

import { toNode } from './render-dom.js';

function pad(n) {
  return String(n).padStart(2, '0');
}

// `hhmm` is 24-hour 'HH:MM', or null/blank to start from a sensible default
// (9:00 AM) rather than empty fields with nothing to build off of.
export function renderTimePicker(hhmm) {
  let hour24 = 9;
  let minute = 0;
  if (hhmm) [hour24, minute] = hhmm.split(':').map(Number);
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;

  return toNode(`
    <div class="time-picker">
      <md-outlined-text-field class="time-picker-hour" label="Hour" value="${pad(hour12)}" inputmode="numeric" maxlength="2"></md-outlined-text-field>
      <span class="time-picker-colon md-typescale-display-small">:</span>
      <md-outlined-text-field class="time-picker-minute" label="Minute" value="${pad(minute)}" inputmode="numeric" maxlength="2"></md-outlined-text-field>
      <md-tabs class="time-picker-period">
        <md-primary-tab${period === 'AM' ? ' active' : ''}>AM</md-primary-tab>
        <md-primary-tab${period === 'PM' ? ' active' : ''}>PM</md-primary-tab>
      </md-tabs>
    </div>`);
}

// Reads the picker's current fields back into 24-hour 'HH:MM' — clamps
// whatever was typed into a valid hour (1-12) / minute (0-59) rather than
// rejecting an out-of-range value outright, the same forgiving-on-save
// spirit the rest of this editor's fields already have. AM/PM comes off
// md-tabs's own activeTabIndex (index 1 = the PM tab), the same read
// day-render.js's wireScenarioFollowers already relies on for its tabs.
export function readTimePicker(pickerEl) {
  const hour12 = Math.min(12, Math.max(1, Math.round(Number(pickerEl.querySelector('.time-picker-hour').value)) || 12));
  const minute = Math.min(59, Math.max(0, Math.round(Number(pickerEl.querySelector('.time-picker-minute').value)) || 0));
  const period = pickerEl.querySelector('.time-picker-period').activeTabIndex === 1 ? 'PM' : 'AM';
  const hour24 = period === 'PM' ? (hour12 % 12) + 12 : hour12 % 12;
  return `${pad(hour24)}:${pad(minute)}`;
}
