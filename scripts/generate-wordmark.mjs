// Regenerates public/trippin-wordmark.svg. Run via `npm run wordmark` after changing the site
// font or the wordmark's text. The wordmark is loaded through an <img>, which can't use the
// page's web fonts, so its text has to be baked in as outlined paths rather than live <text>.
//
// Fonts are fetched from Google Fonts at run time (no font files are committed): with no
// browser User-Agent, the css2 API serves plain TTF URLs, which opentype.js can parse.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import opentype from 'opentype.js';

const OUTPUT = new URL('../public/trippin-wordmark.svg', import.meta.url);

const FAMILY = 'Lato';
const TITLE = { text: "Trippin'", weight: 700, color: '#e0a83a' };
const SUBTITLE = { text: 'TRAVEL PLANNER', weight: 400, color: '#ece2cf' };

// Layout in viewBox units, sized against the compass mark. Text is sized by cap height rather
// than font size so a font swap keeps the same visual size next to the mark.
const TEXT_LEFT = 87.3;
const TITLE_BASELINE = 50;
const TITLE_CAP_HEIGHT = 31.24;
const SUBTITLE_BASELINE = 69;
const SUBTITLE_CAP_HEIGHT = 6.6;
const VIEWBOX_LEFT = 3.1;
const VIEWBOX_TOP = -1.1;
const VIEWBOX_HEIGHT = 74.2;
const RIGHT_PADDING = 3;

// The compass mark, shared in shape with public/favicon.svg.
const MARK = `<defs>
    <mask id="cut" maskUnits="userSpaceOnUse" x="-20" y="-20" width="104" height="104">
      <rect x="-20" y="-20" width="104" height="104" fill="#fff"/>
      <path d="M32 -3 L38.5 13 L25.5 13Z" fill="#000" stroke="#000" stroke-width="2.2" stroke-linejoin="round"/>
    </mask>
  </defs>
  <g id="content">
    <g transform="rotate(-9 37 37) scale(1.15)">
      <g transform="translate(3.84 3.84) scale(0.88)">
      <g mask="url(#cut)">
        <circle cx="32" cy="32" r="29" fill="none" stroke="#e0a83a" stroke-width="2.6"/>
        <circle cx="32" cy="32" r="23" fill="none" stroke="#e0a83a" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="0.1 4.2"/>
        <path d="M28.4 55 L35.6 55 L32 61Z M55 28.4 L55 35.6 L61 32Z M9 28.4 L9 35.6 L3 32Z" fill="#e0a83a"/>
      </g>
      <path d="M17 23.4 L32 18.5 L47 23.4 M32 20 L32 46" fill="none" stroke="#e0a83a" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M32 -3 L38.5 13 L25.5 13Z" fill="#c96b48"/>
    </g>
    </g>`;

async function loadFont(weight) {
  const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(FAMILY)}:wght@${weight}`;
  const css = await (await fetch(cssUrl)).text();
  const ttfUrl = css.match(/url\((https:[^)]+\.ttf)\)/)?.[1];
  if (!ttfUrl) throw new Error(`No TTF for ${FAMILY} ${weight} in Google Fonts response`);
  return opentype.parse(await (await fetch(ttfUrl)).arrayBuffer());
}

function sizeForCapHeight(font, capHeight) {
  return capHeight / (font.tables.os2.sCapHeight / font.unitsPerEm);
}

// Places the title so its leftmost ink sits at TEXT_LEFT; returns the path and its right edge.
function titlePath(font) {
  const size = sizeForCapHeight(font, TITLE_CAP_HEIGHT);
  const box = font.getPath(TITLE.text, 0, 0, size).getBoundingBox();
  const shift = TEXT_LEFT - box.x1;
  return {
    d: font.getPath(TITLE.text, shift, TITLE_BASELINE, size).toPathData(2),
    right: box.x2 + shift,
  };
}

// Letter-spaces the subtitle so its ink runs exactly from TEXT_LEFT to the title's right edge.
function subtitlePath(font, right) {
  const size = sizeForCapHeight(font, SUBTITLE_CAP_HEIGHT);
  const chars = [...SUBTITLE.text];
  const glyphs = chars.map((c) => font.charToGlyph(c));
  const advances = glyphs.map((g) => (g.advanceWidth * size) / font.unitsPerEm);
  const firstInk = font.getPath(chars[0], 0, 0, size).getBoundingBox().x1;
  const lastInk = font.getPath(chars.at(-1), 0, 0, size).getBoundingBox().x2;
  const untrackedWidth = advances.slice(0, -1).reduce((a, b) => a + b, 0) + lastInk - firstInk;
  const tracking = (right - TEXT_LEFT - untrackedWidth) / (chars.length - 1);

  let x = TEXT_LEFT - firstInk;
  let d = '';
  glyphs.forEach((glyph, i) => {
    d += glyph.getPath(x, SUBTITLE_BASELINE, size).toPathData(2);
    x += advances[i] + tracking;
  });
  return d;
}

const [titleFont, subtitleFont] = await Promise.all([
  loadFont(TITLE.weight),
  loadFont(SUBTITLE.weight),
]);
const title = titlePath(titleFont);
const subtitle = subtitlePath(subtitleFont, title.right);
const width = (title.right + RIGHT_PADDING - VIEWBOX_LEFT).toFixed(1);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWBOX_LEFT} ${VIEWBOX_TOP} ${width} ${VIEWBOX_HEIGHT}">
  ${MARK}
    <path d="${title.d}" fill="${TITLE.color}"/>
    <path d="${subtitle}" fill="${SUBTITLE.color}"/>
  </g>
</svg>
`;

await writeFile(fileURLToPath(OUTPUT), svg);
console.log(`Wrote public/trippin-wordmark.svg (${FAMILY} ${TITLE.weight}/${SUBTITLE.weight})`);
