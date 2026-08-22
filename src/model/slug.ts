// Turns a trip name into the slug it gets created at: the
// public/data/<slug>/ directory name and the #/<slug> route segment — this
// app's only stable identifier for a trip besides its display name, so it
// needs to come out URL-safe and stay unique across trips.json.

function toKebabCase(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function slugify(name: string, existingSlugs: string[]): string {
  const base = toKebabCase(name) || 'trip';
  return dedupeSlug(base, existingSlugs);
}

// The slug field is never shown to the user on Add trip (see TripEditDialog)
// — it's derived silently from the name — so a collision has to resolve
// itself here rather than surfacing as a Save-time error the user has no
// field left to fix. Appends -2, -3, ... until the slug is unique.
function dedupeSlug(base: string, existingSlugs: string[]): string {
  if (!existingSlugs.includes(base)) return base;
  let n = 2;
  while (existingSlugs.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
