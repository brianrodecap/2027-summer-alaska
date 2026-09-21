import AltRouteIcon from '@mui/icons-material/AltRoute';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import RouteIcon from '@mui/icons-material/Route';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import useMediaQuery from '@mui/material/useMediaQuery';
import useScrollTrigger from '@mui/material/useScrollTrigger';

import { MARK_SRC, WORDMARK_SRC } from '../../config/brand';
import type { LegSummary } from '../../model/types';
import { DAYS_APP_BAR_HEIGHT } from '../day/dayLayout';
import { FilterMenu } from '../day/FilterMenu';
import { useLogoFadeOnScroll } from './useLogoFadeOnScroll';

const problemLabel = (count: number) =>
  count ? `${count} scenario group${count === 1 ? '' : 's'} need attention` : '';

// The day list's sticky bar: jump-to-day and filters on the left, the trip logo
// (faded in once the hero scrolls away) in the middle, and the routes /
// scenarios / Ask AI buttons on the right.
export function DaysAppBar({
  canJumpToDay,
  legSummaries,
  scenarioProblemCount,
  onJumpToDay,
  onManageRoutes,
  onManageScenarios,
  onAskAI,
}: {
  canJumpToDay: boolean;
  legSummaries: LegSummary[];
  // Groups of alternatives without exactly one Ideal — surfaced on the
  // Manage-scenarios button.
  scenarioProblemCount: number;
  onJumpToDay: () => void;
  onManageRoutes: () => void;
  onManageScenarios: () => void;
  onAskAI: () => void;
}) {
  // Flat while it's the page's own leading edge, shadowed only once content
  // has scrolled in underneath it — the M3 app-bar spec's own elevation rule.
  const elevated = useScrollTrigger({ disableHysteresis: true, threshold: 1 });
  const { sentinelRef, logoRef } = useLogoFadeOnScroll();
  // Below `sm` the centered wordmark would collide with the right-hand icon
  // group, so the compact mark stands in for it.
  const barLogo = useMediaQuery((theme) => theme.breakpoints.down('sm'))
    ? { src: MARK_SRC, height: 28 }
    : { src: WORDMARK_SRC, height: 36 };

  return (
    <>
      <Box ref={sentinelRef} aria-hidden sx={{ height: 0 }} />
      <Box
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 3,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          minHeight: DAYS_APP_BAR_HEIGHT,
          px: 2,
          bgcolor: 'background.default',
          boxShadow: elevated ? 2 : 0,
          transition: 'box-shadow 150ms',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          {canJumpToDay && (
            <IconButton edge="start" aria-label="Jump to a day" onClick={onJumpToDay}>
              <CalendarMonthIcon />
            </IconButton>
          )}
          <FilterMenu legSummaries={legSummaries} />
        </Box>
        <Box
          component="img"
          ref={logoRef}
          src={barLogo.src}
          alt="Trippin'"
          sx={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            height: barLogo.height,
            transform: 'translate(-50%, -50%)',
            opacity: 0,
            transition: 'opacity 100ms',
            pointerEvents: 'none',
          }}
        />
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <IconButton aria-label="Manage routes" onClick={onManageRoutes}>
            <RouteIcon />
          </IconButton>
          <Tooltip title={problemLabel(scenarioProblemCount)}>
            <IconButton aria-label="Manage scenarios" onClick={onManageScenarios}>
              <Badge color="error" variant="dot" invisible={scenarioProblemCount === 0}>
                <AltRouteIcon />
              </Badge>
            </IconButton>
          </Tooltip>
          <IconButton edge="end" aria-label="Ask AI" onClick={onAskAI}>
            <AutoAwesomeIcon />
          </IconButton>
        </Box>
      </Box>
    </>
  );
}
