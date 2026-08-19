// Tiny DOM-construction helpers with no domain knowledge — turn an HTML
// string into a single detached element or a detached DocumentFragment.

export function toNode(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

export function toFragment(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content;
}
