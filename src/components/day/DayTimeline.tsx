import Timeline from '@mui/lab/Timeline';
import TimelineConnector from '@mui/lab/TimelineConnector';
import TimelineContent from '@mui/lab/TimelineContent';
import TimelineDot from '@mui/lab/TimelineDot';
import TimelineItem from '@mui/lab/TimelineItem';
import TimelineSeparator from '@mui/lab/TimelineSeparator';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Fragment, memo, type ReactElement } from 'react';

import { filterSequenceItems } from '../../model/filters';
import { firstImage } from '../../model/formatting';
import { activeMealOptions, selectedMealOptionIndex } from '../../model/mealOptions';
import { formatTime, splitOutStayBoundaries, stayRelation } from '../../model/tripModel';
import type {
  Day,
  EnrichedActivity,
  EnrichedMealOption,
  EnrichedStay,
  EnrichedTransit,
  RefEntityKind,
  ScenarioTrack,
  SequenceItem,
  StaySequenceItem,
  TransitBoundarySequenceItem,
  TransitStageSequenceItem,
} from '../../model/types';
import { useEdit } from '../../state/EditContext';
import {
  useFilterSelection,
  useMealOptionSelection,
  useRouteToneSelection,
} from '../../state/TripSelectionsContext';
import { BookingChip } from '../shared/BookingChip';
import { renderMaterialIcon } from '../shared/materialIcon';
import { NotesCluster, splitNotes } from '../shared/Notes';
import { ActivityLeading, ActivityRow } from './ActivityRow';
import { RouteVariantTabs } from './RouteVariantTabs';
import { RowSpeedDial } from './RowSpeedDial';
import { ScenarioTabsSection } from './ScenarioTabsSection';

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
function resolvedArrivesAtFor(
  transit: EnrichedTransit,
  routeTones: Map<string, string>,
): string | null {
  const tone = activeRouteTone(transit, routeTones);
  if (!tone || !transit.routeInfo) return transit.arrivesAt;
  return transit.routeInfo.variants.find((v) => v.tone === tone)?.arrivesAt ?? transit.arrivesAt;
}

const StayNode = memo(function StayNode({
  item,
  date,
  isLast,
  onOpen,
}: {
  item: StaySequenceItem;
  date: string;
  isLast: boolean;
  onOpen: (stay: EnrichedStay) => void;
}) {
  const { stay } = item;
  const name = stay.lodging?.name ?? 'Lodging still open';
  const detailBits = [
    stay.lodging?.roomType,
    stay.lodging?.roomNumber && `Room/cabin ${stay.lodging.roomNumber}`,
    stay.lodging?.campsite,
    stay.lodging?.bedConfiguration,
  ].filter(Boolean) as string[];
  const image = firstImage(stay);
  const { openEdit, deleteEntity } = useEdit();
  const { above, mid, below } = splitNotes(stay.notes);
  return (
    <TimelineItem>
      <TimelineSeparator>
        {image ? (
          <Avatar src={image.uri} sx={{ width: 32, height: 32 }} />
        ) : (
          <TimelineDot color="primary">
            {renderMaterialIcon('hotel', { fontSize: 'small' })}
          </TimelineDot>
        )}
        {!isLast && <TimelineConnector />}
      </TimelineSeparator>
      <TimelineContent sx={{ pb: 3 }}>
        <NotesCluster notes={above} />
        <Box sx={{ position: 'relative', cursor: 'pointer' }} onClick={() => onOpen(stay)}>
          <RowSpeedDial
            entity="stay"
            id={stay._id}
            onEdit={() => openEdit('stay', stay._id)}
            onDelete={() => deleteEntity('stay', stay._id)}
          />
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
            <NotesCluster notes={mid} />
            {stay.booking && (
              <Box sx={{ mt: 0.5 }}>
                <BookingChip booking={stay.booking} />
              </Box>
            )}
          </Box>
        </Box>
        <NotesCluster notes={below} />
      </TimelineContent>
    </TimelineItem>
  );
});

const TransitBoundaryNode = memo(function TransitBoundaryNode({
  item,
  isLast,
  onOpen,
}: {
  item: TransitBoundarySequenceItem;
  isLast: boolean;
  onOpen: (transit: EnrichedTransit) => void;
}) {
  const { routeTones } = useRouteToneSelection();
  const { transit, phase } = item;
  const isDepart = phase === 'depart';
  const place = isDepart ? transit.from.label : transit.to.label;
  const time = isDepart ? transit.departsAt : resolvedArrivesAtFor(transit, routeTones);
  const modeIconName = transit.mode === 'flight' ? 'flight' : 'directions_car';
  const image = isDepart ? firstImage(transit) : null;
  const { openEdit, deleteEntity } = useEdit();
  const { above, mid, below } = isDepart
    ? splitNotes(transit.notes)
    : { above: [], mid: [], below: [] };

  const boundaryContent = (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary">
        {time
          ? `${formatTime(time)} · ${isDepart ? 'Depart' : 'Arrive'}`
          : isDepart
            ? 'Depart'
            : 'Arrive'}
      </Typography>
      <Typography variant="subtitle1">{place}</Typography>
      {isDepart && <NotesCluster notes={mid} />}
      {isDepart && transit.booking && (
        <Box sx={{ mt: 0.5 }}>
          <BookingChip booking={transit.booking} />
        </Box>
      )}
      {isDepart && <RouteVariantTabs transit={transit} />}
    </Box>
  );

  return (
    <TimelineItem>
      <TimelineSeparator>
        {image ? (
          <Avatar src={image.uri} sx={{ width: 32, height: 32 }} />
        ) : (
          <TimelineDot color={isDepart ? 'primary' : 'grey'}>
            {renderMaterialIcon(modeIconName, { fontSize: 'small' })}
          </TimelineDot>
        )}
        {!isLast && <TimelineConnector />}
      </TimelineSeparator>
      <TimelineContent sx={{ pb: 3 }}>
        {isDepart && <NotesCluster notes={above} />}
        {isDepart ? (
          <Box sx={{ position: 'relative', cursor: 'pointer' }} onClick={() => onOpen(transit)}>
            <RowSpeedDial
              entity="transit"
              id={transit._id}
              onEdit={() => openEdit('transit', transit._id)}
              onDelete={() => deleteEntity('transit', transit._id)}
            />
            {boundaryContent}
          </Box>
        ) : (
          boundaryContent
        )}
        {isDepart && <NotesCluster notes={below} />}
      </TimelineContent>
    </TimelineItem>
  );
});

// A stage's kind ('waypoint' — a real, callable-out stop — or 'via' — a
// point that exists only to steer routing onto the intended road, no stop)
// picks its overline word, same as Depart/Arrive above.
const STAGE_KIND_LABEL: Record<string, string> = { waypoint: 'Waypoint', via: 'Via' };

const TransitStageNode = memo(function TransitStageNode({
  item,
  isLast,
}: {
  item: TransitStageSequenceItem;
  isLast: boolean;
}) {
  const { routeTones } = useRouteToneSelection();
  const { transit, variant, stage } = item;
  const tone = activeRouteTone(transit, routeTones);
  if (variant.tone !== tone) return null; // a non-active variant's stages simply aren't rendered
  return (
    <TimelineItem>
      <TimelineSeparator>
        <TimelineDot variant="outlined" color="grey">
          {renderMaterialIcon('signpost', { fontSize: 'small' })}
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
});

const ActivityNode = memo(function ActivityNode({
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
  const { openEdit, deleteEntity } = useEdit();
  const { mealOptionIndex } = useMealOptionSelection();
  const { above, mid, below } = splitNotes(activity.notes);

  // A meal row's "add note" actions target whichever candidate is currently
  // selected, not the Activity as a whole — see EnrichedMealOption.notes and
  // mealOptions.ts's selectedMealOptionIndex. onEdit/onDelete below still act
  // on the Activity itself (there's no separate delete for a candidate; that
  // goes through ActivityEditForm's MealOptionList instead).
  let noteTarget: { entity: RefEntityKind; id: string } = { entity: 'activity', id: activity._id };
  if (activity.options?.length) {
    const options = activeMealOptions(activity, day);
    const selected = options[selectedMealOptionIndex(options, mealOptionIndex, activity._id)];
    if (selected) noteTarget = { entity: 'mealOption', id: selected._id };
  }

  return (
    <TimelineItem>
      <TimelineSeparator>
        <ActivityLeading activity={activity} day={day} />
        {!isLast && <TimelineConnector />}
      </TimelineSeparator>
      <TimelineContent sx={{ pb: 3, px: 2, pt: 0 }}>
        <NotesCluster notes={above} />
        <Box sx={{ position: 'relative' }}>
          <RowSpeedDial
            entity={noteTarget.entity}
            id={noteTarget.id}
            onEdit={() => openEdit('activity', activity._id)}
            onDelete={() => deleteEntity('activity', activity._id)}
          />
          <ActivityRow activity={activity} day={day} onOpen={onOpenActivity} midNotes={mid} />
        </Box>
        <NotesCluster notes={below} />
      </TimelineContent>
    </TimelineItem>
  );
});

const ScenarioTabsNode = memo(function ScenarioTabsNode({
  day,
  tracks,
  topLevel,
  isLast,
  daysByDate,
  onOpenActivity,
  onOpenStay,
  onOpenTransit,
}: {
  day: Day;
  tracks: ScenarioTrack[];
  topLevel: boolean;
  isLast: boolean;
  daysByDate: Map<string, Day>;
  onOpenActivity: (activity: EnrichedActivity, selectedOption?: EnrichedMealOption) => void;
  onOpenStay: (stay: EnrichedStay) => void;
  onOpenTransit: (transit: EnrichedTransit) => void;
}) {
  return (
    <TimelineItem>
      <TimelineSeparator>
        <TimelineDot variant="outlined" color="secondary">
          {renderMaterialIcon('alt_route', { fontSize: 'small' })}
        </TimelineDot>
        {!isLast && <TimelineConnector />}
      </TimelineSeparator>
      <TimelineContent sx={{ pb: 3 }}>
        <ScenarioTabsSection
          day={day}
          tracks={tracks}
          topLevel={topLevel}
          daysByDate={daysByDate}
          onOpenActivity={onOpenActivity}
          onOpenStay={onOpenStay}
          onOpenTransit={onOpenTransit}
        />
      </TimelineContent>
    </TimelineItem>
  );
});

export const DayTimeline = memo(function DayTimeline({
  day,
  sequence,
  daysByDate,
  onOpenActivity,
  onOpenStay,
  onOpenTransit,
}: {
  day: Day;
  sequence: SequenceItem[];
  daysByDate: Map<string, Day>;
  onOpenActivity: (activity: EnrichedActivity, selectedOption?: EnrichedMealOption) => void;
  onOpenStay: (stay: EnrichedStay) => void;
  onOpenTransit: (transit: EnrichedTransit) => void;
}) {
  const { activeFilterTokens } = useFilterSelection();
  const filtered = filterSequenceItems(sequence, activeFilterTokens);

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
  const nodes: { key: string; render: (isLast: boolean) => ReactElement }[] = flattened.flatMap(
    (item, i) => {
      if (item.type === 'stay') {
        return [
          {
            key: `stay-${item.stay._id}-${i}`,
            render: (isLast: boolean) => (
              <StayNode item={item} date={day.date} isLast={isLast} onOpen={onOpenStay} />
            ),
          },
        ];
      }
      if (item.type === 'transit-boundary') {
        return [
          {
            key: `transit-${item.transit._id}-${item.phase}`,
            render: (isLast: boolean) => (
              <TransitBoundaryNode item={item} isLast={isLast} onOpen={onOpenTransit} />
            ),
          },
        ];
      }
      if (item.type === 'transit-stage') {
        return [
          {
            key: `stage-${item.transit._id}-${item.variant.tone}-${i}`,
            render: (isLast: boolean) => <TransitStageNode item={item} isLast={isLast} />,
          },
        ];
      }
      if (item.type === 'section') {
        return item.activities.map((activity) => ({
          key: `activity-${activity._id}`,
          render: (isLast: boolean) => (
            <ActivityNode
              activity={activity}
              day={day}
              isLast={isLast}
              onOpenActivity={onOpenActivity}
            />
          ),
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
              onOpenStay={onOpenStay}
              onOpenTransit={onOpenTransit}
            />
          ),
        },
      ];
    },
  );

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
});
