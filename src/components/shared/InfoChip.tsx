import ButtonBase from '@mui/material/ButtonBase';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import type { SxProps, Theme } from '@mui/material/styles';
import type { SvgIconProps } from '@mui/material/SvgIcon';
import Typography from '@mui/material/Typography';
import type { ComponentType, ReactNode } from 'react';

// A tappable deep link (a Weather-app link today, but any URL works)
// wrapping content when one resolved, rendered plain otherwise — the same
// optional-link shape every weather/elevation/travel reading on the site
// can have (PlaceConditionsLine shows this at a smaller scale; DayWeatherChips/
// DayTravelChip below use it at InfoChip's own).
export function InfoLink({
  href,
  sx,
  children,
}: {
  href?: string | null;
  sx?: SxProps<Theme>;
  children: ReactNode;
}) {
  if (!href) return <>{children}</>;
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener"
      // Stops the click from bubbling up to a clickable ancestor — the
      // day header's AccordionSummary, whenever this renders inside
      // DayWeatherChips there, would otherwise toggle expand/collapse in
      // the same tap that opens the external link.
      onClick={(event) => event.stopPropagation()}
      sx={{ color: 'inherit', textDecoration: 'none', ...sx }}
    >
      {children}
    </Link>
  );
}

// The one visual primitive DayWeatherChips and DayTravelChip both build on
// — an icon-or-emoji plus a line of text, optionally deep-linked — so their
// two independent fetches (weather conditions, live drive time/distance)
// never have to share rendering code, just this shared shape. Exactly one
// of Icon/emoji is expected to be set (MUI's icon set has no moon-phase
// glyphs, so DayWeatherChips' own moon row renders its phase's actual
// emoji here instead of a colored SvgIcon).
export interface InfoChipData {
  key: string;
  Icon?: ComponentType<SvgIconProps>;
  emoji?: string;
  color: string;
  text: string;
  href?: string | null;
}

// onClick is for an in-app action (DayTravelChip's own "open the map"),
// distinct from href's external deep link — a chip is expected to use at
// most one of the two. Given onClick, the chip renders as its own
// keyboard-accessible button rather than deferring to InfoLink's <a>.
export function InfoChip({
  Icon,
  emoji,
  color,
  text,
  href,
  onClick,
}: Omit<InfoChipData, 'key'> & { onClick?: () => void }) {
  const content = (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
      {Icon ? (
        <Icon fontSize="small" sx={{ color }} />
      ) : (
        <Typography sx={{ fontSize: '1.1rem', lineHeight: 1 }}>{emoji}</Typography>
      )}
      <Typography variant="body2" color="text.secondary" noWrap>
        {text}
      </Typography>
    </Stack>
  );

  if (onClick) {
    // component="span" — DayTravelChip mounts this inside AccordionSummary's
    // own root <button> (MUI's ButtonBase default), and a nested button is
    // invalid HTML that assistive tech handles inconsistently. ButtonBase
    // still renders it as a keyboard-operable, focusable control either way.
    return (
      <ButtonBase
        component="span"
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
        sx={{
          alignItems: 'center',
          // Override ButtonBase's own default justifyContent: 'center' —
          // this chip stretches to fill DayInfoStrip's column width (its
          // sibling DayWeatherChips row does the same and stays left-aligned
          // since a plain Box has no such default), so without this override
          // the icon+text visibly center instead of hugging the left edge.
          justifyContent: 'flex-start',
          font: 'inherit',
          color: 'inherit',
        }}
      >
        {content}
      </ButtonBase>
    );
  }

  return <InfoLink href={href}>{content}</InfoLink>;
}
