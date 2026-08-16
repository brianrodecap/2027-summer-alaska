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
      <aside class="panel" role="dialog" aria-modal="true" aria-labelledby="side-sheet-title" tabindex="-1">
        <md-elevation></md-elevation>
        <div class="panel-header">
          <md-icon-button class="back-button" aria-label="Back" hidden>
            <md-icon>arrow_back</md-icon>
          </md-icon-button>
          <span id="side-sheet-title" class="md-typescale-title-large"></span>
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
    this.bodyEl = this.querySelector('.panel-body');
    this.backButtonEl = this.querySelector('.back-button');
    this.isOpen = false;
    this.onBack = null;

    this.backButtonEl.addEventListener('click', () => this.onBack?.());
    this.querySelector('.close-button').addEventListener('click', () => this.close());
    this.scrimEl.addEventListener('click', () => this.close());
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.isOpen) this.close();
    });
  }

  // onBack, when passed, shows a back button that returns to whatever opened
  // this sheet (e.g. the Day dialog an activity was drilled into from) —
  // without it, closing the sheet is the only way back and that context is
  // lost rather than navigated to.
  open(title, bodyFragment, onBack = null) {
    this.titleEl.textContent = title;
    this.bodyEl.replaceChildren(bodyFragment);
    this.onBack = onBack;
    this.backButtonEl.hidden = !onBack;
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
