// Docked date picker for Overview's "Jump to a day" control. @material/web has
// no date-picker component — a fourth gap alongside Card/Carousel/Side Sheet
// (see CLAUDE.md's "three components @material/web doesn't have") — so this
// is a calendar-grid month view built from md-icon-button (month nav) plus
// plain <button> day cells, laid out with the structural CSS in styles.css's
// .date-picker-* rules. Only dates that fall on an actual trip Day are
// selectable; everything else (padding from the adjacent month, or any date
// outside the trip's own start/end) renders dimmed and disabled.

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function pad(n) {
  return String(n).padStart(2, '0');
}

function isoDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m, d));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

// Sunday-first 6x7 grid covering `month` (0-indexed) of `year`, padded with
// the trailing days of the surrounding months so every row is full.
function monthGrid(year, month) {
  const startOffset = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const dayOffset = i - startOffset + 1;
    const dt = new Date(Date.UTC(year, month, dayOffset));
    cells.push({
      date: isoDate(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()),
      day: dt.getUTCDate(),
      inMonth: dt.getUTCMonth() === month,
      dow: dt.getUTCDay(),
    });
  }
  return cells;
}

// ---------- TODO(you): the continuous range-highlight band ----------
//
// The reference design (a trip-dates picker from another app) shows the
// trip's full date range as one continuous rounded band across the grid,
// not 30 separate circles — rounded caps only at the true trip start/end
// and wherever a week row itself wraps, square everywhere in between so
// the band reads as continuous.
//
// styles.css already defines the CSS for three cell states this function
// should return (as an array of zero or more of these class names):
//   'in-range'    — this date falls within [tripStart, tripEnd]; paints the
//                    band background at all (omit entirely for out-of-range)
//   'range-start' — round this cell's *left* edge (true trip start, or a
//                    Sunday that falls inside the range)
//   'range-end'   — round this cell's *right* edge (true trip end, or a
//                    Saturday that falls inside the range)
//
// A single-day row (range-start and range-end both true) should return both
// classes — styles.css handles that combination as a full pill.
//
// date:      this cell's 'YYYY-MM-DD'
// tripStart: view.trip.startDate, 'YYYY-MM-DD'
// tripEnd:   view.trip.endDate, 'YYYY-MM-DD'
// dow:       this cell's weekday, 0=Sunday .. 6=Saturday
function rangeClasses(date, tripStart, tripEnd, dow) {
  return [];
}

export function renderDatePicker(days, tripStart, tripEnd, year, month) {
  const validDates = new Set(days.map((d) => d.date));

  const frag = document.createDocumentFragment();

  const header = document.createElement('div');
  header.className = 'date-picker-header';
  header.innerHTML = `
    <md-icon-button class="date-picker-prev" aria-label="Previous month">
      <md-icon>chevron_left</md-icon>
    </md-icon-button>
    <span class="md-typescale-title-medium">${MONTH_LABELS[month]} ${year}</span>
    <md-icon-button class="date-picker-next" aria-label="Next month">
      <md-icon>chevron_right</md-icon>
    </md-icon-button>
  `;
  frag.append(header);

  const weekdays = document.createElement('div');
  weekdays.className = 'date-picker-weekdays';
  weekdays.innerHTML = WEEKDAY_INITIALS.map((w) => `<span>${w}</span>`).join('');
  frag.append(weekdays);

  const grid = document.createElement('div');
  grid.className = 'date-picker-grid';
  for (const cell of monthGrid(year, month)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    const classes = ['date-picker-cell', ...rangeClasses(cell.date, tripStart, tripEnd, cell.dow)];
    if (!cell.inMonth) classes.push('outside-month');
    btn.className = classes.join(' ');
    btn.textContent = String(cell.day);
    btn.dataset.date = cell.date;
    if (!validDates.has(cell.date)) btn.disabled = true;
    grid.append(btn);
  }
  frag.append(grid);

  return frag;
}
