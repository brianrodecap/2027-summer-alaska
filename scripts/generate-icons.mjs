// Regenerates public/apple-touch-icon.png from public/favicon.svg. Run via `npm run icons`
// after editing the favicon. iOS "Add to Home Screen" ignores SVG icons and needs a PNG.
//
// The home-screen icon has to be a full-bleed square: iOS applies its own rounded corners,
// and it fills any transparent pixels with black. So this drops the favicon's own rounded
// corners (`rx`) before rasterizing, leaving an opaque square.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const SOURCE = new URL('../public/favicon.svg', import.meta.url);
const OUTPUT = new URL('../public/apple-touch-icon.png', import.meta.url);
const SIZE = 180; // iOS's current home-screen icon size (@3x of 60pt)

const svg = await readFile(SOURCE, 'utf8');

// Square the background <rect>, the only element with rounded corners (`[^>]*?` can't reach
// the mask's <rect> in another tag). With `rx` gone it covers the whole canvas, so nothing is transparent.
const squared = svg.replace(/(<rect\b[^>]*?)\s+rx="[^"]*"/, '$1');
if (squared === svg) {
  throw new Error(
    'favicon.svg no longer has a <rect> with an rx — update scripts/generate-icons.mjs to match.',
  );
}

// A high render density keeps the thin dotted ring crisp when downscaled to SIZE.
await sharp(Buffer.from(squared), { density: 720 })
  .resize(SIZE, SIZE)
  .removeAlpha()
  .png()
  .toFile(fileURLToPath(OUTPUT));

console.log(`Wrote public/apple-touch-icon.png (${SIZE}×${SIZE})`);
