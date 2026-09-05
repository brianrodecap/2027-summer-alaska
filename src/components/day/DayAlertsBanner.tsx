import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Stack from '@mui/material/Stack';
import { alpha } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

import type { NwsAlert, NwsSeverity } from '../../model/nwsAlerts';
import { formatTime } from '../../model/tripModel';
import type { Day } from '../../model/types';
import { AQI_MODERATE_COLOR, CLOUD_COLOR, RAIN_COLOR } from '../../model/weatherColors';
import { useDayAlerts } from './useDayAlerts';

// This site's own theme repurposes MUI Alert's built-in `error` color as the
// "alternate scenario" gold accent (see theme.ts's own note), not danger-red
// — so a genuine severe-weather alert can't just reach for severity="error"
// the way a stock MUI app would, or "Extreme" would render in the same color
// as an unrelated day's backup-plan tab. Fixed, ungated-by-theme hex values
// instead, same approach DayWeatherStrip already takes for its own
// domain-accurate colors (temperatureColor/AQI_BANDS) rather than routing
// through palette roles. Reuses AQI_BANDS' exact amber for Moderate and
// DayWeatherStrip's rain-blue/cloud-grey for Minor/Unknown, so "amber = use
// some caution" and "blue-grey = informational" mean the same thing across
// every weather surface on the site; Extreme/Severe get two dedicated red
// tones nothing else on the site uses, since no other reading here ever
// needed to say "this can hurt someone."
const SEVERITY_COLOR: Record<NwsSeverity, string> = {
  Extreme: '#c62828',
  Severe: '#e64a19',
  Moderate: AQI_MODERATE_COLOR,
  Minor: RAIN_COLOR,
  Unknown: CLOUD_COLOR,
};

function AlertCard({ alert }: { alert: NwsAlert }) {
  const [expanded, setExpanded] = useState(false);
  const color = SEVERITY_COLOR[alert.severity];
  return (
    <Alert
      icon={<WarningAmberIcon sx={{ color }} />}
      onClick={() => setExpanded((v) => !v)}
      sx={{
        cursor: 'pointer',
        alignItems: 'flex-start',
        bgcolor: alpha(color, 0.16),
        color: 'text.primary',
        borderLeft: 4,
        borderColor: color,
      }}
    >
      <AlertTitle sx={{ color }}>{alert.event}</AlertTitle>
      <Typography variant="body2">
        {alert.headline ?? alert.description}
        {' — until '}
        {formatTime(alert.expires)}
      </Typography>
      {expanded && (
        <Stack spacing={1} sx={{ mt: 1 }}>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
            {alert.description}
          </Typography>
          {alert.instruction && (
            <Typography variant="body2" sx={{ whiteSpace: 'pre-line', fontWeight: 500 }}>
              {alert.instruction}
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary">
            {alert.areaDesc}
          </Typography>
        </Stack>
      )}
    </Alert>
  );
}

// National Weather Service alerts (watches/warnings/advisories) active for
// this day's places — rendered at the very top of the day block, ahead of
// the sticky header's own Collapse, so a live severe-weather alert can't be
// hidden by collapsing the day the way DayWeatherStrip/NotesCluster can (see
// DayBlock). Only ever fetches for the day matching the real-world today/
// tomorrow (useDayAlerts); every other day renders nothing, no skeleton
// either, since there's nothing to wait on.
export function DayAlertsBanner({ day }: { day: Day }) {
  const { alerts } = useDayAlerts(day.date, [
    day.weatherPlaceId,
    day.sunsetPlaceId,
    day.sunrisePlaceId,
  ]);
  if (!alerts.length) return null;
  return (
    <Stack spacing={1} sx={{ px: 2, pt: 2 }}>
      {alerts.map((alert) => (
        <AlertCard key={alert.id} alert={alert} />
      ))}
    </Stack>
  );
}
