import '@material/web/all.js';
import { styles as typescaleStyles } from '@material/web/typography/md-typescale-styles.js';
import './side-sheet.js';
import { days } from '../days/index.js';
import { renderListItem, renderSurfaceItem, renderDetailBody, renderActivityDetailBody } from './day-render.js';

document.adoptedStyleSheets.push(typescaleStyles.styleSheet);

const sideSheet = document.querySelector('detail-side-sheet');
const dayDialog = document.querySelector('#day-dialog');
const dayDialogTitle = document.querySelector('#day-dialog-title');
const dayDialogBody = document.querySelector('#day-dialog-body');

// Drill-down: trip view → day dialog (detailed activities) → activity side sheet.
// Opening an activity closes the dialog first — @material/web's md-dialog renders
// in the browser's native top layer, which would otherwise always paint above our
// hand-positioned side sheet regardless of z-index, so the two never stack.
let dialogDay = null;

function openDayDialog(day) {
  dialogDay = day;
  dayDialogTitle.textContent = `${day.dateLabel} — ${day.location}`;
  dayDialogBody.replaceChildren(renderDetailBody(day));
  dayDialog.show();
}

function openActivity(variant, item) {
  const day = dialogDay;
  dayDialog.close();
  const title = variant.label ? `${item.time} — ${variant.label}` : item.time;
  sideSheet.open(title, renderActivityDetailBody(day, variant, item));
}

dayDialogBody.addEventListener('click', (event) => {
  const activityEl = event.target.closest('[data-activity]');
  if (!activityEl) return;
  const variant = dialogDay.variants[Number(activityEl.dataset.variantIndex)];
  const item = variant.items[Number(activityEl.dataset.itemIndex)];
  openActivity(variant, item);
});

document.querySelector('#day-dialog-close').addEventListener('click', () => dayDialog.close());

const listEl = document.querySelector('#view-list md-list');
const carouselTrack = document.querySelector('#view-carousel .carousel-track');
const cardsGrid = document.querySelector('#view-cards .cards-grid');
const dateMenu = document.querySelector('#date-menu');

for (const day of days) {
  const listItem = renderListItem(day);
  listItem.addEventListener('click', () => openDayDialog(day));
  listEl.append(listItem);

  const carouselItem = renderSurfaceItem(day);
  carouselItem.addEventListener('click', () => openDayDialog(day));
  carouselTrack.append(carouselItem);

  const cardItem = renderSurfaceItem(day);
  cardItem.addEventListener('click', () => openDayDialog(day));
  cardsGrid.append(cardItem);

  const menuItem = document.createElement('md-menu-item');
  menuItem.innerHTML = `
    <div slot="headline">${day.location}</div>
    <div slot="supporting-text">${day.dateLabel}</div>
  `;
  menuItem.addEventListener('click', () => openDayDialog(day));
  dateMenu.append(menuItem);
}

document.querySelector('#carousel-prev').addEventListener('click', () => {
  carouselTrack.scrollBy({ left: -304, behavior: 'smooth' });
});
document.querySelector('#carousel-next').addEventListener('click', () => {
  carouselTrack.scrollBy({ left: 304, behavior: 'smooth' });
});

const dateMenuAnchor = document.querySelector('#date-menu-anchor');
dateMenuAnchor.addEventListener('click', () => {
  dateMenu.open = true;
});

// Sticky nav tabs — scroll the matching section into view and keep the URL hash in sync.
const tabs = document.querySelector('md-tabs');
const sectionIds = ['overview', 'view-list', 'view-carousel', 'view-cards', 'footnotes'];

tabs.addEventListener('change', () => {
  const id = sectionIds[tabs.activeTabIndex];
  document.getElementById(id).scrollIntoView({ behavior: 'smooth', block: 'start' });
  history.replaceState(null, '', '#' + id);
});

const initialIndex = sectionIds.indexOf(location.hash.slice(1));
if (initialIndex > -1) tabs.activeTabIndex = initialIndex;
