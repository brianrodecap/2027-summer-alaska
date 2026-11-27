import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import type { ReactNode, Ref } from 'react';

import type { Booking, Note } from '../../model/types';
import { useExpandedRow } from '../../state/useExpandedRow';
import { BookingChip } from '../shared/BookingChip';
import { splitNotes } from '../shared/noteKind';
import { NotesCluster } from '../shared/Notes';
import { CARD_PADDING_PX } from '../shared/rowLeadingTokens';

const MENU_WIDTH = 26;
const GAP = { xs: 0.75, sm: 1 } as const;

// The card's top. The conditions go beside the name where the card is wide enough
// for both, else under the photo: a phone's cards are narrow, and so are a nested
// plan's. On a closed card the booking chip fills the room beside the photo; an open
// card has more to say, which takes the full width.
const WIDE_CARD = '@container (min-width: 430px)';
const NARROW_COLUMNS = 'minmax(0, 1fr) auto auto';
const WIDE_COLUMNS = 'minmax(0, 1fr) auto auto auto';
const CLOSED_TOP_SX = {
  display: 'grid',
  alignItems: 'start',
  gridTemplateColumns: NARROW_COLUMNS,
  gridTemplateRows: 'auto 1fr auto',
  gridTemplateAreas: '"name photo menu" "rest photo menu" "rest conditions menu"',
  [WIDE_CARD]: {
    gridTemplateColumns: WIDE_COLUMNS,
    gridTemplateRows: 'auto 1fr',
    gridTemplateAreas: '"name conditions photo menu" "rest rest photo menu"',
  },
} as const;
const OPEN_TOP_SX = {
  display: 'grid',
  alignItems: 'start',
  gridTemplateColumns: NARROW_COLUMNS,
  gridTemplateAreas: '"name photo menu" "name conditions menu" "rest rest rest"',
  [WIDE_CARD]: {
    gridTemplateColumns: WIDE_COLUMNS,
    gridTemplateAreas: '"name conditions photo menu" "rest rest rest rest"',
  },
} as const;

// What a tap must reach on its own, above the card's own "open" button.
const ABOVE_OPEN_SX = {
  '& a, & button:not([data-card-open]), & [role="button"], & .MuiAlert-root': {
    position: 'relative',
    zIndex: 1,
  },
} as const;

// What a card adds when it opens: the entry's whole booking and notes (a closed card
// shows only what its own row owns), the row details, what belongs with the booking,
// and what Google says about its places. The three nodes mount only while open.
export interface CardDetails {
  booking: Booking | null;
  notes: Note[];
  lines: ReactNode;
  extras: ReactNode;
  google: ReactNode;
}

// An open card's added content takes its own taps, so reading or using it never
// closes the card.
function OpenPart({ children }: { children: ReactNode }) {
  return <Box sx={{ position: 'relative', zIndex: 1, cursor: 'auto' }}>{children}</Box>;
}

// One day-list row, beside its dot on the timeline: the alerts among its notes, then
// the time and name, the place's conditions and the small photo, the booking chip,
// and then what else the reader acts on (`children`: warnings,
// choices). Its menu
// sits in the top corner, after the photo; a card without one keeps that space, so
// every photo lines up.
//
// A card with `details` opens in place. What it adds goes between the lines already
// there, which keep their order: row details under the name; travelers, booking
// details and info notes under the chip; footnotes and Google at the end. The button
// that opens it lies behind the content, so nothing interactive is nested inside it.
export function RowCard({
  notes,
  booking,
  name,
  overline,
  title,
  conditions,
  photo,
  menu,
  cardId,
  details,
  selected,
  cardRef,
  children,
}: {
  notes?: Note[];
  booking?: Booking | null;
  // The row's name as plain text, for the open button's label.
  name?: string;
  overline: ReactNode;
  title: ReactNode;
  conditions?: ReactNode;
  photo: ReactNode;
  menu?: ReactNode;
  cardId?: string; // expandedRows.ts's cardId
  details?: CardDetails;
  selected?: boolean;
  cardRef?: Ref<HTMLDivElement>;
  children?: ReactNode;
}) {
  const { expanded, toggle } = useExpandedRow(details ? cardId : undefined);
  const open = expanded ? details : undefined;
  const { above, mid, below } = splitNotes(open?.notes ?? notes ?? []);
  const chip = open ? open.booking : booking;
  return (
    <Box
      ref={cardRef}
      data-card={cardId}
      sx={{
        position: 'relative',
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        containerType: 'inline-size',
        bgcolor: selected ? 'primary.container' : 'background.paper',
        p: `${CARD_PADDING_PX}px`,
        cursor: details ? 'pointer' : 'default',
        ...ABOVE_OPEN_SX,
      }}
    >
      {details && (
        <ButtonBase
          data-card-open
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Hide' : 'Show'} details for ${name}`}
          onClick={toggle}
          sx={{
            position: 'absolute',
            inset: 0,
            borderRadius: 'inherit',
            '&.Mui-focusVisible': {
              outline: '2px solid',
              outlineColor: 'primary.main',
            },
          }}
        />
      )}
      <NotesCluster notes={above} expanded={expanded} />
      <Box sx={open ? OPEN_TOP_SX : CLOSED_TOP_SX}>
        <Box sx={{ gridArea: 'name', minWidth: 0 }}>
          {/* flush with the top of the number and photo, without a line's leading */}
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ lineHeight: 1.2, display: 'block' }}
          >
            {overline}
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{ lineHeight: 1.3, mt: 0.25, overflowWrap: 'anywhere' }}
          >
            {title}
          </Typography>
        </Box>
        <Box
          sx={{
            gridArea: 'conditions',
            justifySelf: 'end',
            '&:not(:empty)': { ml: GAP, mt: 0.5, [WIDE_CARD]: { mt: 0 } },
          }}
        >
          {conditions}
        </Box>
        <Box sx={{ gridArea: 'photo', justifySelf: 'end', ml: GAP }}>{photo}</Box>
        <Box sx={{ gridArea: 'menu', ml: GAP, width: MENU_WIDTH }}>{menu}</Box>
        <Box sx={{ gridArea: 'rest', minWidth: 0 }}>
          {open && <OpenPart>{open.lines}</OpenPart>}
          {chip && (
            <Box sx={{ mt: 0.5 }}>
              <BookingChip booking={chip} detailsOnMobile={expanded} />
            </Box>
          )}
        </Box>
      </Box>
      {open && (
        <OpenPart>
          {open.extras}
          <NotesCluster notes={mid} expanded />
        </OpenPart>
      )}
      {children}
      {open && (
        <OpenPart>
          <NotesCluster notes={below} expanded />
          {open.google}
        </OpenPart>
      )}
    </Box>
  );
}
