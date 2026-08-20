import { Fragment, type ReactElement } from 'react';
import Timeline from '@mui/lab/Timeline';
import TimelineItem from '@mui/lab/TimelineItem';
import TimelineSeparator from '@mui/lab/TimelineSeparator';
import TimelineDot from '@mui/lab/TimelineDot';
import TimelineConnector from '@mui/lab/TimelineConnector';
import TimelineContent from '@mui/lab/TimelineContent';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import EditIcon from '@mui/icons-material/Edit';

import { formatTime, splitOutStayBoundaries, stayRelation } from '../../model/tripModel';
import { filterSequenceItems } from '../../model/filters';
import { firstImage } from '../../model/formatting';
import { materialIcon } from '../shared/materialIcon';
import { BookingChip } from '../shared/BookingChip';
import { RouteVariantTabs } from './RouteVariantTabs';
import { ActivityRow, ActivityLeading } from './ActivityRow';
import { ScenarioTabsSection } from './ScenarioTabsSection';
import { useTripSelections } from '../../state/TripSelectionsContext';
import { useEdit } from '../../state/EditContext';
import type {
  Day,
  EnrichedActivity,
  EnrichedMealOption,
  EnrichedTransit,
  ScenarioTrack,
  SequenceItem,
  StaySequenceItem,
  TransitBoundarySequenceItem,
  TransitStageSequenceItem,
} from '../../model/types';

function activeRouteTone(transit: EnrichedTransit, routeTones: Map<string, string>): string | null {
  if (!transit.routeInfo) return null;
  return routeTones.get(transit._id) ?? transit.routeInfo.selectedTone;
}

// Every route variant's stages/arrival were already walked once in
// buildTripView (transit.routeInfo.variants[]) — switching which tone is
// "active" just picks a different already-computed variant, no re-walk
// needed. (The one thing this doesn't do — a meal-format change nudging a
// drive's estimated arrival live — is a documented, deliberately deferred
// refinement; every variant's own stage/arrival times still reflect the
// model's own default meal-format guess.)
function resolvedArrivesAtFor(transit: EnrichedTransit, routeTones: Map<string, string>): string | null {
  const tone = activeRouteTone(transit, routeTones);
  if (!tone || !transit.routeInfo) return transit.arrivesAt;
  return transit.routeInfo.variants.find((v) => v.tone === tone)?.arrivesAt ?? transit.arrivesAt;
}

function StayNode({ item, date, isLast }: { item: StaySequenceItem; date: string; isLast: boolean }) {
  const { stay } = item;
  const name = stay.lodging?.name ?? 'Lodging still open';
  const detailBits = [
    stay.lodging?.roomType,
    stay.lodging?.roomNumber && `Room/cabin ${stay.lodging.roomNumber}`,
    stay.lodging?.campsite,
    stay.lodging?.bedConfiguration,
  ].filter(Boolean) as string[];
  const image = firstImage(stay);
  const Icon = materialIcon('hotel');
  const { openEdit } = useEdit();
  return (
    <TimelineItem>
      <TimelineSeparator>
        {image ? (
          <Avatar src={image.uri} sx={{ width: 32, height: 32 }} />
        ) : (
          <TimelineDot color="primary">
            <Icon fontSize="small" />
          </TimelineDot>
        )}
        {!isLast && <TimelineConnector />}
      </TimelineSeparator>
      <TimelineContent sx={{ pb: 3, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary">
            {stayRelation(stay, date)}
          </Typography>
          <Typography variant="subtitle1">{name}</Typography>
          <Typography variant="body2" color="text.secondary">
            {formatTime(stay.checkInAt)} in · {formatTime(stay.checkOutAt)} out
          </Typography>
          {detailBits.length > 0 && (
            <Typography variant="body2" color="text.secondary">
              {detailBits.join(' · ')}
            </Typography>
          )}
          {stay.lodging?.checkInInstructions && (
            <Typography variant="body2" color="text.secondary">
              {stay.lodging.checkInInstructions}
            </Typography>
          )}
          {stay.booking && (
            <Box sx={{ mt: 0.5 }}>
              <BookingChip booking={stay.booking} />
            </Box>
          )}
        </Box>
        <IconButton size="small" aria-label="Edit" onClick={() => openEdit('stay', stay._id)}>
          <EditIcon fontSize="small" />
        </IconButton>
      </TimelineContent>
    </TimelineItem>
  );
}

function TransitBoundaryNode({ item, isLast }: { item: TransitBoundarySequenceItem; isLast: boolean }) {
  const { routeTones } = useTripSelections();
  const { transit, phase } = item;
  const isDepart = phase === 'depart';
  const place = isDepart ? transit.from.label : transit.to.label;
  const time = isDepart ? transit.departsAt : resolvedArrivesAtFor(transit, routeTones);
  const modeIconName = transit.mode === 'flight' ? 'flight' : 'directions_car';
  const image = isDepart ? firstImage(transit) : null;
  const Icon = materialIcon(modeIconName);
  const { openEdit } = useEdit();
  return (
    <TimelineItem>
      <TimelineSeparator>
        {image ? (
          <Avatar src={image.uri} sx={{ width: 32, height: 32 }} />
        ) : (
          <TimelineDot color={isDepart ? 'primary' : 'grey'}>
            <Icon fontSize="small" />
          </TimelineDot>
        )}
        {!isLast && <TimelineConnector />}
      </TimelineSeparator>
      <TimelineContent sx={{ pb: 3, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary">
            {time ? `${formatTime(time)} · ${isDepart ? 'Depart' : 'Arrive'}` : isDepart ? 'Depart' : 'Arrive'}
          </Typography>
          <Typography variant="subtitle1">{place}</Typography>
          {isDepart && transit.booking && (
            <Box sx={{ mt: 0.5 }}>
              <BookingChip booking={transit.booking} />
            </Box>
          )}
          {isDepart && <RouteVariantTabs transit={transit} />}
        </Box>
        {isDepart && (
          <IconButton size="small" aria-label="Edit" onClick={() => openEdit('transit', transit._id)}>
            <EditIcon fontSize="small" />
          </IconButton>
        )}
      </TimelineContent>
    </TimelineItem>
  );
}

// A stage's kind ('waypoint' — a real, callable-out stop — or 'via' — a
// point that exists only to steer routing onto the intended road, no stop)
// picks its overline word, same as Depart/Arrive above.
const STAGE_KIND_LABEL: Record<string, string> = { waypoint: 'Waypoint', via: 'Via' };

function TransitStageNode({ item, isLast }: { item: TransitStageSequenceItem; isLast: boolean }) {
  const { routeTones } = useTripSelections();
  const { transit, variant, stage } = item;
  const tone = activeRouteTone(transit, routeTones);
  if (variant.tone !== tone) return null; // a non-active variant's stages simply aren't rendered
  const Icon = materialIcon('signpost');
  return (
    <TimelineItem>
      <TimelineSeparator>
        <TimelineDot variant="outlined" color="grey">
          <Icon fontSize="small" />
        </TimelineDot>
        {!isLast && <TimelineConnector />}
      </TimelineSeparator>
      <TimelineContent sx={{ pb: 3 }}>
        <Typography variant="caption" color="text.secondary">
          {formatTime(stage.key)} · {STAGE_KIND_LABEL[stage.kind] ?? 'Via'}
        </Typography>
        <Typography variant="subtitle1" title={stage.note ?? undefined}>
          {stage.label}
        </Typography>
      </TimelineContent>
    </TimelineItem>
  );
}

function ActivityNode({
  activity,
  day,
  isLast,
  onOpenActivity,
}: {
  activity: EnrichedActivity;
  day: Day;
  isLast: boolean;
  onOpenActivity: (activity: EnrichedActivity, selectedOption?: EnrichedMealOption) => void;
}) {
  return (
    <TimelineItem>
      <TimelineSeparator>
        <ActivityLeading activity={activity} day={day} />
        {!isLast && <TimelineConnector />}
      </TimelineSeparator>
      <TimelineContent sx={{ pb: 3, px: 2, pt: 0 }}>
        <ActivityRow activity={activity} day={day} onOpen={onOpenActivity} />
      </TimelineContent>
    </TimelineItem>
  );
}

function ScenarioTabsNode({
  day,
  tracks,
  topLevel,
  isLast,
  daysByDate,
  onOpenActivity,
}: {
  day: Day;
  tracks: ScenarioTrack[];
  topLevel: boolean;
  isLast: boolean;
  daysByDate: Map<string, Day>;
  onOpenActivity: (activity: EnrichedActivity, selectedOption?: EnrichedMealOption) => void;
}) {
  const Icon = materialIcon('alt_route');
  return (
    <TimelineItem>
      <TimelineSeparator>
        <TimelineDot variant="outlined" color="secondary">
          <Icon fontSize="small" />
        </TimelineDot>
        {!isLast && <TimelineConnector />}
      </TimelineSeparator>
      <TimelineContent sx={{ pb: 3 }}>
        <ScenarioTabsSection day={day} tracks={tracks} topLevel={topLevel} daysByDate={daysByDate} onOpenActivity={onOpenActivity} />
      </TimelineContent>
    </TimelineItem>
  );
}

export function DayTimeline({
  day,
  sequence,
  daysByDate,
  onOpenActivity,
}: {
  day: Day;
  sequence: SequenceItem[];
  daysByDate: Map<string, Day>;
  onOpenActivity: (activity: EnrichedActivity, selectedOption?: EnrichedMealOption) => void;
}) {
  const { activeFilterTokens } = useTripSelections();
  const filtered = filterSequenceItems(sequence, day, activeFilterTokens);

  // Safe to run unconditionally at every level — a scenario track's own
  // sequence never contains a 'stay' item (Stay never branches), so this is
  // a no-op there; only the top-level day.sequence actually has boundaries
  // to pull out.
  const { checkOuts, rest, checkIns } = splitOutStayBoundaries(filtered);
  const flattened = [...checkOuts, ...rest, ...checkIns];

  if (!flattened.length) {
    // Filtering everything out of an otherwise non-empty sequence renders
    // nothing at all here — DaysView's own dayHasVisibleContent check is
    // what hides the day-block itself; "Nothing scheduled yet" stays
    // reserved for a day that's genuinely empty, filters aside.
    if (sequence.length && activeFilterTokens.size) return null;
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
        Nothing scheduled yet.
      </Typography>
    );
  }

  // A 'section' item bundles several same-moment activities into one array —
  // flatten it to one timeline row per activity so the connector runs
  // through every image/icon on the day, not just past the section as a
  // whole (each activity gets its own dot, matching every other node type).
  const nodes: { key: string; render: (isLast: boolean) => ReactElement }[] = flattened.flatMap((item, i) => {
    if (item.type === 'stay') {
      return [{ key: `stay-${item.stay._id}-${i}`, render: (isLast: boolean) => <StayNode item={item} date={day.date} isLast={isLast} /> }];
    }
    if (item.type === 'transit-boundary') {
      return [{ key: `transit-${item.transit._id}-${item.phase}`, render: (isLast: boolean) => <TransitBoundaryNode item={item} isLast={isLast} /> }];
    }
    if (item.type === 'transit-stage') {
      return [{ key: `stage-${item.transit._id}-${item.variant.tone}-${i}`, render: (isLast: boolean) => <TransitStageNode item={item} isLast={isLast} /> }];
    }
    if (item.type === 'section') {
      return item.activities.map((activity) => ({
        key: `activity-${activity._id}`,
        render: (isLast: boolean) => <ActivityNode activity={activity} day={day} isLast={isLast} onOpenActivity={onOpenActivity} />,
      }));
    }
    // scenario-tabs
    return [
      {
        key: `scenario-tabs-${i}`,
        render: (isLast: boolean) => (
          <ScenarioTabsNode
            day={day}
            tracks={item.tracks ?? day.scenarioTracks}
            topLevel={!item.tracks}
            isLast={isLast}
            daysByDate={daysByDate}
            onOpenActivity={onOpenActivity}
          />
        ),
      },
    ];
  });

  return (
    <Timeline
      sx={{
        p: 0,
        m: 0,
        // MUI reserves a flex-basis gutter on TimelineItem's own ::before
        // for the "opposite content" column even when nothing ever supplies
        // one — kill it so the dot/connector column sits flush against the
        // day block's own left edge instead of floating in the middle.
        '& .MuiTimelineItem-root::before': { display: 'none !important' },
      }}
    >
      {nodes.map((node, i) => (
        <Fragment key={node.key}>{node.render(i === nodes.length - 1)}</Fragment>
      ))}
    </Timeline>
  );
}
