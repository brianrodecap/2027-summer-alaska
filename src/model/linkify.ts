// Note.text and Activity.text are plain strings (see CLAUDE.md's editor
// notes) — no markdown syntax to type. A note like "Book ahead at
// reservedenali.com; arrive 20 minutes early." should still render that URL
// as a clickable link, so the display layer (not the editor) detects bare
// URLs in the text and splits it into plain/link segments.
export type LinkifySegment = { text: string; href: string | null };

// A small, deliberately non-exhaustive TLD allowlist — this only needs to
// catch bare domains in trip-itinerary prose (tour operators, hotels, parks
// services), not be a general-purpose URL parser.
const BARE_TLDS = ['com', 'org', 'net', 'gov', 'edu', 'io'];

const URL_RE = new RegExp(
  `https?://\\S+|www\\.\\S+|\\b[a-zA-Z0-9][a-zA-Z0-9-]*\\.(?:${BARE_TLDS.join('|')})(?:/\\S*)?`,
  'gi',
);

// Trailing sentence punctuation/closing brackets a URL match's trailing \S+
// can accidentally swallow — stripped back onto the plain-text segment that
// follows instead of becoming part of the href.
const TRAILING_PUNCTUATION_RE = /[.,;:!?)\]}'"]+$/;

export function linkifySegments(text: string): LinkifySegment[] {
  const segments: LinkifySegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = URL_RE.exec(text))) {
    const raw = match[0];
    const trimmed = raw.replace(TRAILING_PUNCTUATION_RE, '');
    if (!trimmed) continue;

    const start = match.index;
    const end = start + trimmed.length;
    if (start > lastIndex) segments.push({ text: text.slice(lastIndex, start), href: null });

    const href = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    segments.push({ text: trimmed, href });

    lastIndex = end;
    URL_RE.lastIndex = end;
  }

  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex), href: null });

  return segments.length ? segments : [{ text, href: null }];
}
