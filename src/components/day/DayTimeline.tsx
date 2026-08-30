import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import Timeline from '@mui/lab/Timeline';
import TimelineConnector from '@mui/lab/TimelineConnector';
import TimelineContent from '@mui/lab/TimelineContent';
import TimelineItem from '@mui/lab/TimelineItem';
import TimelineSeparator from '@mui/lab/TimelineSeparator';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { type CSSProperties, Fragment, memo, type ReactElement, type ReactNode } from 'react';

import { filterSequenceItems } from '../../model/filters';
import { firstImage, stayDetailBits } from '../../model/formatting';
import { activeMealOptions, selectedMealOptionIndex } from '../../model/mealOptions';
import { buildDragMeta, type DragMeta } from '../../model/reorder';
import {
  activeRouteTone,
  formatTime,
  splitOutStayBoundaries,
  stayRelation,
} from '../../model/tripModel';
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
import { useEdit } from '../../state/useEdit';
import {
  useFilterSelection,
  useMealOptionSelection,
  useRouteToneSelection,
  useScenarioSelection,
} from '../../state/useTripSelections';
import { BookingChip } from '../shared/BookingChip';
import { splitNotes } from '../shared/noteKind';
import { NotesCluster } from '../shared/Notes';
import { RowLeadingDot } from '../shared/RowLeadingDot';
import { ActivityLeading, ActivityRow } from './ActivityRow';
import { RouteVariantTabs } from './RouteVariantTabs';
import { RowMenu } from './RowMenu';
import { visibleTracksFor } from './scenarioSelection';
import { ScenarioTabsSection } from './ScenarioTabsSection';

// Every route variant's stages/arrival were already walked once in
// buildTripView (transit.routeInfo.variants[]) — switching which tone is
// "active" just picks a different already-computed variant, no re-walk
// needed. (The one thing this doesn't do — a meal-format change nudging a
// drive's estimated arrival live — is a documented, deliberately deferred
// refinement; every variant's own stage/arrival times still reflect the
// model's own default meal-format guess.)
// Applied uniformly to every row (Stay/Transit/Activity alike) so the
// dot/image column it sits beside stays aligned down the page regardless of
// which individual rows actually carry a drag handle (only Activity rows
// do; see ActivityNode below).
const DRAG_HANDLE_HOVER_CLASS = 'day-drag-handle';

// ActivityNode's own hover/focus-reveal selector for the drag handle — a
// module-level constant so it isn't rebuilt on every render.
const ACTIVITY_HOVER_SX = {
  [`&:hover .${DRAG_HANDLE_HOVER_CLASS}, &:focus-within .${DRAG_HANDLE_HOVER_CLASS}`]: {
    opacity: 1,
  },
};

// Static — hoisted so LeadingGutter/TrailingGutter don't reallocate an sx
// object on every row's every render (every row now routes through one of
// these, not just the one-off drag-handle IconButton that used to be the
// only inline sx here).
const LEADING_GUTTER_SX = {
  // 24px matches the drag handle's IconButton (see its own tightened p: '2px'
  // below), so rows without one still reserve its width and keep the dot
  // column aligned.
  width: 24,
  flexShrink: 0,
  alignSelf: 'flex-start',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'flex-start',
  pt: '1px',
} as const;

function LeadingGutter({ dragHandle }: { dragHandle?: ReactNode }) {
  return <Box sx={LEADING_GUTTER_SX}>{dragHandle}</Box>;
}

// The row-menu counterpart to LeadingGutter above: a fixed rail at the far
// right of every row, sitting outside TimelineContent as its own flex
// sibling rather than inside it. Different row types give TimelineContent
// different horizontal padding (see ActivityNode's px: 2 vs. Stay/Transit's
// none), so a kebab button placed *inside* that padded area lands at a
// different x-position per row type; anchoring it here instead keeps every
// row's menu icon flush against the same right edge regardless of that
// per-row padding.
const TRAILING_GUTTER_SX = { flexShrink: 0, alignSelf: 'flex-start', display: 'flex' } as const;

function TrailingGutter({ children }: { children?: ReactNode }) {
  return <Box sx={TRAILING_GUTTER_SX}>{children}</Box>;
}

// Every *Node below assembles the same five pieces in the same order —
// TimelineItem, LeadingGutter, a TimelineSeparator holding one dot plus an
// optional connector, TimelineContent, and an optional TrailingGutter — with
// only the dot, the content, and whether a drag handle/menu apply actually
// varying per row type. Centralizing that wiring here means a future change
// to the shared chrome (the gutters, the connector-suppression on the last
// row, ...) touches one place instead of five. `contentSx` defaults to every
// row's own { pb: 3, pt: 0 } and merges in a caller's override rather than
// requiring each of the five callers to repeat it; the drag-handle
// hover-reveal (ACTIVITY_HOVER_SX) is likewise wired automatically off
// whether a dragHandle was passed, rather than exposed as its own opaque
// itemSx prop — only a row with a drag handle needs it.
const DEFAULT_CONTENT_SX = { pb: 3, pt: 0 };

function TimelineRow({
  dot,
  isLast,
  contentSx,
  dragHandle,
  trailing,
  children,
}: {
  dot: ReactNode;
  isLast: boolean;
  contentSx?: { pb?: number; px?: number };
  dragHandle?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <TimelineItem sx={dragHandle ? ACTIVITY_HOVER_SX : undefined}>
      <LeadingGutter dragHandle={dragHandle} />
      <TimelineSeparator>
        {dot}
        {!isLast && <TimelineConnector />}
      </TimelineSeparator>
      <TimelineContent sx={{ ...DEFAULT_CONTENT_SX, ...contentSx }}>{children}</TimelineContent>
      {trailing && <TrailingGutter>{trailing}</TrailingGutter>}
    </TimelineItem>
  );
}

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
  const detailBits = stayDetailBits(stay.lodging);
  const image = firstImage(stay);
  const { openEdit, deleteEntity } = useEdit();
  const { above, mid, below } = splitNotes(stay.notes);
  return (
    <TimelineRow
      dot={
        image ? (
          <Avatar src={image.uri} sx={{ width: 32, height: 32 }} />
        ) : (
          <RowLeadingDot icon="hotel" />
        )
      }
      isLast={isLast}
      trailing={
        <RowMenu
          entity="stay"
          id={stay._id}
          onEdit={() => openEdit('stay', stay._id)}
          onDelete={() => deleteEntity('stay', stay._id)}
        />
      }
    >
      <NotesCluster notes={above} />
      <Box sx={{ cursor: 'pointer' }} onClick={() => onOpen(stay)}>
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
      <NotesCluster notes={below} />
    </TimelineRow>
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
    <TimelineRow
      dot={
        image ? (
          <Avatar src={image.uri} sx={{ width: 32, height: 32 }} />
        ) : (
          <RowLeadingDot icon={modeIconName} />
        )
      }
      isLast={isLast}
      trailing={
        isDepart && (
          <RowMenu
            entity="transit"
            id={transit._id}
            onEdit={() => openEdit('transit', transit._id)}
            onDelete={() => deleteEntity('transit', transit._id)}
          />
        )
      }
    >
      {isDepart && <NotesCluster notes={above} />}
      {isDepart ? (
        <Box sx={{ cursor: 'pointer' }} onClick={() => onOpen(transit)}>
          {boundaryContent}
        </Box>
      ) : (
        boundaryContent
      )}
      {isDepart && <NotesCluster notes={below} />}
    </TimelineRow>
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
    <TimelineRow dot={<RowLeadingDot icon="signpost" />} isLast={isLast}>
      <Typography variant="caption" color="text.secondary">
        {formatTime(stage.key)} · {STAGE_KIND_LABEL[stage.kind] ?? 'Via'}
      </Typography>
      <Typography variant="subtitle1" title={stage.note ?? undefined}>
        {stage.label}
      </Typography>
    </TimelineRow>
  );
});

const ActivityNode = memo(function ActivityNode({
  activity,
  day,
  isLast,
  onOpenActivity,
  dragHandle,
}: {
  activity: EnrichedActivity;
  day: Day;
  isLast: boolean;
  onOpenActivity: (activity: EnrichedActivity, selectedOption?: EnrichedMealOption) => void;
  dragHandle?: ReactNode;
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
    <TimelineRow
      dot={<ActivityLeading activity={activity} day={day} />}
      isLast={isLast}
      contentSx={{ px: 2 }}
      dragHandle={dragHandle}
      trailing={
        <RowMenu
          entity={noteTarget.entity}
          id={noteTarget.id}
          onEdit={() => openEdit('activity', activity._id)}
          onDelete={() => deleteEntity('activity', activity._id)}
        />
      }
    >
      <NotesCluster notes={above} />
      <ActivityRow activity={activity} day={day} onOpen={onOpenActivity} midNotes={mid} />
      <NotesCluster notes={below} />
    </TimelineRow>
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
  const { scenarioTone } = useScenarioSelection();
  // Mirrors ScenarioTabsSection's own emptiness check — a gated child track
  // whose requires-list no longer matches the followed day's active branch
  // (or a track list that's simply gone, e.g. right after the scenario it
  // held was deleted) has nothing to show. Bail before rendering any of the
  // TimelineItem chrome, same as TransitStageNode does for a non-active
  // route variant's stage — otherwise the dot/connector renders with an
  // empty panel underneath.
  const visible = visibleTracksFor(tracks, daysByDate, scenarioTone, topLevel);
  if (!visible.length) return null;
  return (
    <TimelineRow
      dot={<RowLeadingDot icon="alt_route" />}
      isLast={isLast}
      // No pb here (unlike every other node's default pb: 3) —
      // ScenarioTabsSection's own nested DayTimeline already ends in a row
      // with its standard pb: 3, so adding this node's own would double up
      // the trailing gap before whatever comes after the scenario section.
      contentSx={{ pb: 0 }}
    >
      <ScenarioTabsSection
        day={day}
        tracks={tracks}
        visible={visible}
        topLevel={topLevel}
        daysByDate={daysByDate}
        onOpenActivity={onOpenActivity}
        onOpenStay={onOpenStay}
        onOpenTransit={onOpenTransit}
      />
    </TimelineRow>
  );
});

// Wraps every drop-target-eligible row (Stay/Transit boundary or stage, or
// an Activity) in dnd-kit's useSortable — a Stay/Transit row stays
// `disabled` (can't be picked up) but still gets measured, so an Activity
// can still be dropped immediately before or after it. Only a non-disabled
// row's drag-handle listeners actually get attached to anything visible
// (ActivityNode's own handle icon, via the `children` render-prop below),
// matching this app's existing per-row icon-button convention rather than
// making the whole row a drag target — that would fight the row's own
// click-to-open handler.
function SortableRow({
  dragId,
  disabled,
  dragMeta,
  children,
}: {
  dragId: string;
  disabled: boolean;
  dragMeta?: DragMeta;
  children: (
    dragHandleProps: {
      attributes: ReturnType<typeof useSortable>['attributes'];
      listeners: ReturnType<typeof useSortable>['listeners'];
    } | null,
    isOver: boolean,
  ) => ReactElement;
}) {
  const { setNodeRef, transform, transition, attributes, listeners, isDragging, isOver } =
    useSortable({
      id: dragId,
      // A plain boolean here disables both draggable AND droppable (dnd-kit's
      // own normalizeDisabled) — a Stay/Transit row must stay non-draggable
      // but still droppable, so an Activity can land immediately before/after
      // it (see this function's own note above).
      disabled: { draggable: disabled, droppable: false },
      data: dragMeta,
    });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <Box ref={setNodeRef} style={style}>
      {children(disabled ? null : { attributes, listeners }, isOver)}
    </Box>
  );
}

// The droppable placeholder for a sequence with nothing in it yet — most
// notably a freshly-added, still-empty Scenario tab (DaysView's "Add to
// this day" > Scenario), which otherwise has no rendered row at all to drop
// an Activity onto. Built on SortableRow (disabled to drag, not to drop) so
// it shares the same DragMeta-shaped `data`/useSortable wiring every other
// row uses, and gets picked up by DaysView.tsx's handleDragEnd the same way.
const EmptyDropZone = memo(function EmptyDropZone({
  id,
  meta,
  scenario,
}: {
  id: string;
  meta: DragMeta;
  scenario: boolean;
}) {
  return (
    <SortableRow dragId={id} disabled dragMeta={meta}>
      {(_dragHandleProps, isOver) => (
        <Box
          sx={{
            border: '1px dashed',
            borderColor: isOver ? 'primary.main' : 'divider',
            borderRadius: 1.5,
            py: 2,
            px: 2,
            textAlign: 'center',
            bgcolor: isOver ? 'primary.container' : 'transparent',
            transition: 'background-color 120ms, border-color 120ms',
          }}
        >
          <Typography variant="body2" color="text.secondary">
            {scenario ? 'Nothing here yet — drag an activity in' : 'Nothing scheduled yet.'}
          </Typography>
        </Box>
      )}
    </SortableRow>
  );
});

export const DayTimeline = memo(function DayTimeline({
  day,
  sequence,
  containerId,
  scenarioId = null,
  daysByDate,
  onOpenActivity,
  onOpenStay,
  onOpenTransit,
}: {
  day: Day;
  sequence: SequenceItem[];
  // Distinct per rendered timeline — the top-level day passes its own date,
  // a scenario tab passes `${date}::${scenarioId}` — so dnd-kit can tell
  // which of this day's (possibly several) sortable lists a drop landed in.
  containerId: string;
  // null for the top-level (scenario-less) list; a scenario tab passes its
  // own scenario._id, so a dropped Activity picks it up as its new
  // scenarioId.
  scenarioId?: string | null;
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
  const dayStart = `${day.date}T00:00`;

  if (!flattened.length) {
    // Filtering everything out of an otherwise non-empty sequence renders
    // nothing at all here — DaysView's own dayHasVisibleContent check is
    // what hides the day-block itself; "Nothing scheduled yet" stays
    // reserved for a day that's genuinely empty, filters aside.
    if (sequence.length && activeFilterTokens.size) return null;
    // Still wrapped in a SortableContext, same as the non-empty branch below
    // — a freshly-added, still-empty scenario (DaysView's "Add to this day"
    // > Scenario) needs somewhere to catch a drop, and a bare early-return
    // here would leave it with no registered droppable at all.
    const placeholderId = `empty-${containerId}`;
    const placeholderMeta: DragMeta = {
      id: placeholderId,
      index: 0,
      endAt: null,
      containerDayStart: dayStart,
      legId: day.leg._id,
      scenarioId,
      activityId: null,
      anchorActivityId: null,
      kind: 'after',
    };
    return (
      <SortableContext
        items={[placeholderId]}
        strategy={verticalListSortingStrategy}
        id={containerId}
      >
        <EmptyDropZone id={placeholderId} meta={placeholderMeta} scenario={scenarioId !== null} />
      </SortableContext>
    );
  }

  const dragMeta = buildDragMeta(flattened, scenarioId, dayStart);
  const dragMetaById = new Map(dragMeta.map((d) => [d.id, d]));

  // A 'section' item bundles several same-moment activities into one array —
  // flatten it to one timeline row per activity so the connector runs
  // through every image/icon on the day, not just past the section as a
  // whole (each activity gets its own dot, matching every other node type).
  // `dragId` mirrors buildDragMeta's own id scheme exactly (see reorder.ts)
  // so a row and its DragMeta always resolve to the same dnd-kit id; null
  // for scenario-tabs, which isn't a single point in time to drop against.
  interface DayTimelineNode {
    key: string;
    dragId: string | null;
    draggable: boolean;
    render: (isLast: boolean, dragHandle?: ReactNode) => ReactElement;
  }

  const nodes: DayTimelineNode[] = flattened.flatMap((item, i): DayTimelineNode[] => {
    if (item.type === 'stay') {
      // Must match buildDragMeta's own id scheme exactly (reorder.ts) — keyed
      // by date, not `i`, since a multi-night Stay renders its own row on
      // every night under one shared DndContext (DaysView.tsx), and `i` alone
      // can collide across different days' rows.
      const dragId = `stay-${item.stay._id}-${day.date}`;
      return [
        {
          key: dragId,
          dragId,
          draggable: false,
          render: (isLast: boolean) => (
            <StayNode item={item} date={day.date} isLast={isLast} onOpen={onOpenStay} />
          ),
        },
      ];
    }
    if (item.type === 'transit-boundary') {
      const dragId = `transit-${item.transit._id}-${item.phase}`;
      return [
        {
          key: dragId,
          dragId,
          draggable: false,
          render: (isLast: boolean) => (
            <TransitBoundaryNode item={item} isLast={isLast} onOpen={onOpenTransit} />
          ),
        },
      ];
    }
    if (item.type === 'transit-stage') {
      const dragId = `stage-${item.transit._id}-${item.variant.tone}-${i}`;
      return [
        {
          key: dragId,
          dragId,
          draggable: false,
          render: (isLast: boolean) => <TransitStageNode item={item} isLast={isLast} />,
        },
      ];
    }
    if (item.type === 'section') {
      return item.activities.map((activity) => {
        const dragId = `activity-${activity._id}`;
        return {
          key: dragId,
          dragId,
          draggable: true,
          render: (isLast: boolean, dragHandle?: ReactNode) => (
            <ActivityNode
              activity={activity}
              day={day}
              isLast={isLast}
              onOpenActivity={onOpenActivity}
              dragHandle={dragHandle}
            />
          ),
        };
      });
    }
    // scenario-tabs
    return [
      {
        key: `scenario-tabs-${i}`,
        dragId: null,
        draggable: false,
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
  });

  // A 'Staying' night (relation 'Staying') is lodging that bookends the
  // whole day — it's where the day starts (waking up there) as much as
  // where it ends (going back to sleep there), unlike Check out/Check in
  // which each name a single real event. splitOutStayBoundaries already
  // renders its one canonical item at the end of the day, alongside Check
  // in (dragMeta/dnd-kit, the map/route stops, and reorder.ts's drop
  // targeting all key off that single occurrence) — this adds a second,
  // purely decorative copy at the very top for the "woke up here" half,
  // outside the sortable list entirely (dragId: null, same as a
  // scenario-tabs row) so it never becomes a second drop target or a second
  // map/route stop for the same lodging.
  const morningStayNodes: DayTimelineNode[] = flattened
    .filter((item): item is StaySequenceItem => item.type === 'stay' && item.relation === 'Staying')
    .map((item) => ({
      key: `stay-${item.stay._id}-${day.date}-morning`,
      dragId: null,
      draggable: false,
      render: (isLast: boolean) => (
        <StayNode item={item} date={day.date} isLast={isLast} onOpen={onOpenStay} />
      ),
    }));
  const allNodes = [...morningStayNodes, ...nodes];

  return (
    <SortableContext
      items={dragMeta.map((d) => d.id)}
      strategy={verticalListSortingStrategy}
      id={containerId}
    >
      <Timeline
        sx={{
          p: 0,
          m: 0,
          // MUI reserves a flex-basis gutter on TimelineItem's own ::before
          // for the "opposite content" column even when nothing ever supplies
          // one — kill it so the dot/connector column sits flush against the
          // day block's own left edge instead of floating in the middle.
          '& .MuiTimelineItem-root::before': { display: 'none !important' },
          // TimelineContent is a flex item with no min-width override, so its
          // default content-based automatic minimum size wins over its flex
          // basis. A clamped note's `-webkit-box`/`-webkit-line-clamp` content
          // (see Notes.tsx's CLAMPED_SX) reports its full unwrapped width as
          // that minimum instead of a wrapped one, which forces this — and
          // every ancestor up to the day block — wider than the viewport,
          // producing horizontal overflow (extra whitespace to the right of
          // everything else once scrolled). Reset it so flexbox can actually
          // shrink the content to fit.
          '& .MuiTimelineContent-root': { minWidth: 0 },
        }}
      >
        {allNodes.map((node, i) => (
          <Fragment key={node.key}>
            {node.dragId ? (
              <SortableRow
                dragId={node.dragId}
                disabled={!node.draggable}
                dragMeta={dragMetaById.get(node.dragId)}
              >
                {(dragHandleProps) =>
                  node.render(
                    i === allNodes.length - 1,
                    dragHandleProps ? (
                      <Tooltip title="Drag to reorder">
                        <IconButton
                          className={DRAG_HANDLE_HOVER_CLASS}
                          size="small"
                          aria-label="Reorder"
                          sx={{
                            flexShrink: 0,
                            cursor: 'grab',
                            touchAction: 'none',
                            opacity: 0,
                            transition: 'opacity 0.15s',
                            // Matches LEADING_GUTTER_SX's 24px width exactly
                            // (20px icon + 2px padding each side).
                            p: '2px',
                          }}
                          {...dragHandleProps.attributes}
                          {...dragHandleProps.listeners}
                        >
                          <DragIndicatorIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    ) : undefined,
                  )
                }
              </SortableRow>
            ) : (
              node.render(i === allNodes.length - 1)
            )}
          </Fragment>
        ))}
      </Timeline>
    </SortableContext>
  );
});
