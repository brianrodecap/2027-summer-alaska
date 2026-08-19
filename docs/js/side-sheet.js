// <detail-side-sheet> — a modal side sheet per the M3 spec
// (https://m3.material.io/components/side-sheets/overview): anchored to the
// screen's trailing edge, full height, a scrim behind it, dismissed via the
// scrim, Escape, or the close button. @material/web has no side-sheet
// component, so this wraps real md-* pieces (md-elevation, md-icon-button,
// md-divider, md-list from the caller) in the minimum structural CSS needed
// to anchor/position/animate the panel — see styles.css.
class DetailSideSheet extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <div class="scrim"></div>
      <aside class="panel" role="dialog" aria-modal="true" aria-label="Activity details" tabindex="-1">
        <md-elevation></md-elevation>
        <div class="panel-header">
          <span id="side-sheet-title" class="md-typescale-title-large"></span>
          <md-icon-button class="edit-button" aria-label="Edit">
            <md-icon>edit</md-icon>
          </md-icon-button>
          <md-icon-button class="close-button" aria-label="Close">
            <md-icon>close</md-icon>
          </md-icon-button>
        </div>
        <md-divider></md-divider>
        <div class="panel-body"></div>
      </aside>
    `;

    this.scrimEl = this.querySelector('.scrim');
    this.panelEl = this.querySelector('.panel');
    this.titleEl = this.querySelector('#side-sheet-title');
    this.editEl = this.querySelector('.edit-button');
    this.bodyEl = this.querySelector('.panel-body');
    this.isOpen = false;
    this.onEdit = null;

    this.querySelector('.close-button').addEventListener('click', () => this.close());
    this.editEl.addEventListener('click', () => this.onEdit?.());
    this.scrimEl.addEventListener('click', () => this.close());
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.isOpen) this.close();
    });
  }

  // `onEdit`, when given, is called when the header's edit button is
  // clicked — omit it (e.g. the day-map sheet, a meal option's side sheet)
  // and the button just stays hidden, since not everything opened in this
  // sheet is an editable entity.
  open(title, bodyFragment, { onEdit } = {}) {
    this.titleEl.innerHTML = title ?? '';
    this.bodyEl.replaceChildren(bodyFragment);
    this.onEdit = onEdit ?? null;
    this.editEl.hidden = !this.onEdit;
    this.classList.add('open');
    this.isOpen = true;
    this.panelEl.focus();
  }

  close() {
    this.classList.remove('open');
    this.isOpen = false;
  }
}

customElements.define('detail-side-sheet', DetailSideSheet);
