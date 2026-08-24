import Link from '@mui/material/Link';
import { Fragment } from 'react';

import { linkifySegments } from '../../model/linkify';

// Drop-in replacement for a plain `{text}` Typography child (NoteChip,
// ActivityRow, ActivityDetailPanel, MealRow) — renders any URL linkifySegments
// finds as a real clickable link, everything else as plain text.
export function LinkifiedText({ text }: { text: string }) {
  const segments = linkifySegments(text);
  return (
    <>
      {segments.map((segment, i) =>
        segment.href ? (
          <Link
            key={i}
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            sx={{ overflowWrap: 'anywhere' }}
          >
            {segment.text}
          </Link>
        ) : (
          <Fragment key={i}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}
