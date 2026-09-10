import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import Timeline from '@mui/lab/Timeline';
import TimelineConnector from '@mui/lab/TimelineConnector';
import TimelineContent from '@mui/lab/TimelineContent';
import TimelineItem from '@mui/lab/TimelineItem';
import TimelineSeparator from '@mui/lab/TimelineSeparator';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import {
  type CSSProperties,
  Fragment,
  memo,
  type ReactElement,
  type ReactNode,
  useMemo,
} from 'react';

import { filterSequenceItems } from '../../model/filters';
import { firstImage, placeFromLodging, stayDetailBits } from '../../model/formatting';
import {
  activeMealOptions,
  isMealActivity,
  selectedMealOptionIndex,
} from '../../model/mealOptions';
import {
  beforeScenarioSplitDragId,
  buildDragMeta,
  type DragMeta,
  rowMembersOf,
  scenarioTabsDragId,
} from '../../model/reorder';
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
import { isRowSelected, type RowSelectionMembers } from '../../state/TripSelectionsContextObject';
import { useEdit } from '../../state/useEdit';
import {
  useFilterSelection,
  useMealOptionSelection,
  useRouteToneSelection,
  useRowSelection,
  useScenarioSelection,
} from '../../state/useTripSelections';
import { BookingChip } from '../shared/BookingChip';
import { splitNotes } from '../shared/noteKind';
import { NotesCluster } from '../shared/Notes';
import { RowLeadingDot } from '../shared/RowLeadingDot';
import { ROW_LEADING_SIZE, ROW_OVERLINE_SX } from '../shared/rowLeadingTokens';
import { ActivityLeading, ActivityRow } from './ActivityRow';
import { AvatarOrDot } from './AvatarOrDot';
import { MealRow, MealRowLeading } from './MealRow';
import { PlaceConditionsLine } from './PlaceConditionsLine';
import { RouteVariantTabs } from './RouteVariantTabs';
import { RowMenu } from './RowMenu';
import { visibleTracksFor } from './scenarioSelection';
import { ScenarioTabsSection } from './ScenarioTabsSection';
import { useInViewport } from './useInViewport';

// Every route variant's stages/arrival were already walked once in
// buildTripView (transit.routeInfo.variants[]) — switching which tone is
// "active" just picks a different already-computed variant, no re-walk
// needed. (The one thing this doesn't do — a meal-format change nudging a
// drive's estimated arrival live — is a documented, deliberately deferred
// refinement; every variant's own stage/arrival times still reflect the
// model's own default meal-format guess.)
// Applied uniformly to every row (Stay/Transit/Activity alike) so the
// dot/image column it sits beside stays aligned down the page regardless of
// which individual rows actually carry a drag handle — an Activity row
// (ActivityNode below), a Transit's own Depart row (TransitBoundaryNode),
// and the scenario-tabs row (ScenarioTabsNode) do; a Stay row and a
// Transit's Arrive/stage rows never do.
const DRAG_HANDLE_HOVER_CLASS = 'day-drag-handle';

// ActivityNode's own hover/focus-reveal selector for the drag handle — a
// module-level constant so it isn't rebuilt on every render.
const ACTIVITY_HOVER_SX = {
  [`&:hover .${DRAG_HANDLE_HOVER_CLASS}, &:focus-within .${DRAG_HANDLE_HOVER_CLASS}`]: {
    opacity: 1,
  },
};

// A row that's part of the current drag-handle multi-select (see
// RowSelectionValue) — a plain background tint on just its content box
// is enough to show membership without needing a separate checkbox
// affordance, since the handle icon itself already switches to primary
// color/full opacity below. Deliberately scoped to TimelineContent alone,
// not the whole TimelineItem: painting it across the dot/connector rail and
// drag-handle gutter too left the row's own dot looking like it "bit into"
// the tint with an ugly notch, since the dot's own circular background sits
// on top of it.
const SELECTED_ROW_SX = { bgcolor: 'primary.container', borderRadius: 1.5 } as const;

// The drag handle IconButton's fontSize="small" icon is 20px, plus this much
// padding on each side — both the gutter width below and the IconButton's
// own sx (see the drag handle render further down) derive from these two
// numbers instead of restating the resulting 24px independently.
const DRAG_HANDLE_ICON_SIZE = 20;
const DRAG_HANDLE_PADDING_PX = 2;
const DRAG_HANDLE_WIDTH = DRAG_HANDLE_ICON_SIZE + DRAG_HANDLE_PADDING_PX * 2;

// Static — hoisted so LeadingGutter/TrailingGutter don't reallocate an sx
// object on every row's every render (every row now routes through one of
// these, not just the one-off drag-handle IconButton that used to be the
// only inline sx here).
const LEADING_GUTTER_SX = {
  // Matches DRAG_HANDLE_WIDTH, so rows without a drag handle still reserve
  // its width and keep the dot column aligned.
  width: DRAG_HANDLE_WIDTH,
  flexShrink: 0,
  alignSelf: 'flex-start',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'flex-start',
  // Centers the grip icon against ROW_LEADING_SIZE (every dot/Avatar in the
  // column, now a uniform diameter — see RowLeadingDot.tsx), derived from
  // both known sizes rather than a hand-tuned pixel value that would go
  // stale the next time either one changes.
  pt: `${(ROW_LEADING_SIZE - DRAG_HANDLE_WIDTH) / 2}px`,
} as const;

function LeadingGutter({ dragHandle }: { dragHandle?: ReactNode }) {
  return <Box sx={LEADING_GUTTER_SX}>{dragHandle}</Box>;
}

// The row-menu counterpart to LeadingGutter above: a fixed rail at the far
// right of every row, sitting outside TimelineContent as its own flex
// sibling rather than inside it, so a kebab lands flush against this
// Timeline's own right edge (this component's own p: 0/m: 0, see below)
// regardless of that row's TimelineContent's horizontal padding. This only
// holds because every *Node's TimelineRow lives directly in the same flat
// Timeline — a nested one, like ScenarioTabsSection's own DayTimeline for a
// scenario branch, is a second Timeline instance one level down, so it needs
// its own wrapping content to stay unpadded too (see ScenarioTabsNode's own
// px: 0 below) or its TrailingGutters would land inset from this one's.
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
// row's own { pb: 3, pt: 0, px: ROW_CONTENT_PX } and merges in a
// caller's override rather than requiring each of the five callers to repeat it; the
// drag-handle hover-reveal (ACTIVITY_HOVER_SX) is likewise wired
// automatically off whether a dragHandle was passed, rather than exposed as
// its own opaque itemSx prop — only a row with a drag handle needs it.
//
// The standard horizontal inset for a row's own text/chips content —
// smaller than MuiTimelineContent's own built-in `16px` default so text has
// more room now that the leading dot/Avatar column is wider (see
// RowLeadingDot's ROW_LEADING_SIZE). Every row gets it by default (folded
// into DEFAULT_CONTENT_SX below) so Activity, Stay, and Transit rows all
// line up at the same left/right edge; only ScenarioTabsNode opts out
// (px: 0), and ScenarioTabsSection's own chip/notes wrapper re-imports this
// same constant rather than hand-matching it, so the two can't silently
// drift apart.
export const ROW_CONTENT_PX = 1;

// TimelineContent stretches to match its row's full height (TimelineItem's
// own flex default), so its padding-top is measured from the exact same y
// as the dot/Avatar's own top edge — `pt: 0` puts text flush against it.
// Each row's own leading caption additionally sets `lineHeight: 1` (see e.g.
// StayNode below) so its own line-height leading doesn't leave that first
// line sitting visibly lower than the dot/Avatar's top — fixed on the
// caption itself rather than as an offset here, since the amount of leading
// is a property of that Typography, not of this shared container.
const DEFAULT_CONTENT_SX = { pb: 3, pt: 0, px: ROW_CONTENT_PX };

function TimelineRow({
  dot,
  isLast,
  contentSx,
  dragHandle,
  trailing,
  selected,
  testId,
  children,
}: {
  dot: ReactNode;
  isLast: boolean;
  contentSx?: { pb?: number; px?: number };
  dragHandle?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <TimelineItem data-testid={testId} sx={dragHandle ? ACTIVITY_HOVER_SX : undefined}>
      <LeadingGutter dragHandle={dragHandle} />
      <TimelineSeparator>
        {dot}
        {!isLast && <TimelineConnector />}
      </TimelineSeparator>
      <TimelineContent
        sx={{
          ...DEFAULT_CONTENT_SX,
          ...contentSx,
          ...(selected ? SELECTED_ROW_SX : undefined),
        }}
      >
        {children}
      </TimelineContent>
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
  dragHandle,
  selected,
}: {
  item: StaySequenceItem;
  date: string;
  isLast: boolean;
  onOpen: (stay: EnrichedStay) => void;
  dragHandle?: ReactNode;
  selected?: boolean;
}) {
  const { stay } = item;
  const lodgingPlace = placeFromLodging(stay.lodging);
  const name = lodgingPlace?.label ?? 'Lodging still open';
  const detailBits = stayDetailBits(stay.lodging);
  const image = firstImage(stay);
  const { openEdit, deleteEntity } = useEdit();
  const { above, mid, below } = splitNotes(stay.notes);
  return (
    <TimelineRow
      dot={<AvatarOrDot image={image} icon="hotel" />}
      isLast={isLast}
      dragHandle={dragHandle}
      selected={selected}
      testId={`stay-row-${item.key}`}
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
        <Typography variant="caption" color="text.secondary" sx={ROW_OVERLINE_SX}>
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
        <PlaceConditionsLine place={lodgingPlace} date={date} />
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
  date,
  isLast,
  onOpen,
  dragHandle,
  selected,
}: {
  item: TransitBoundarySequenceItem;
  date: string;
  isLast: boolean;
  onOpen: (transit: EnrichedTransit) => void;
  dragHandle?: ReactNode;
  selected?: boolean;
}) {
  const { routeTones } = useRouteToneSelection();
  const { transit, phase } = item;
  const isDepart = phase === 'depart';
  const endpointPlace = isDepart ? transit.from : transit.to;
  const time = isDepart ? transit.departsAt : resolvedArrivesAtFor(transit, routeTones);
  const modeIconName = transit.mode === 'flight' ? 'flight' : 'directions_car';
  const image = isDepart ? firstImage(transit) : null;
  const { openEdit, deleteEntity } = useEdit();
  const { above, mid, below } = isDepart
    ? splitNotes(transit.notes)
    : { above: [], mid: [], below: [] };

  const boundaryContent = (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={ROW_OVERLINE_SX}>
        {time
          ? `${formatTime(time)} · ${isDepart ? 'Depart' : 'Arrive'}`
          : isDepart
            ? 'Depart'
            : 'Arrive'}
      </Typography>
      <Typography variant="subtitle1">{endpointPlace.label}</Typography>
      <PlaceConditionsLine place={endpointPlace} date={date} />
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
      dot={<AvatarOrDot image={image} icon={modeIconName} />}
      isLast={isLast}
      dragHandle={dragHandle}
      selected={selected}
      testId={`transit-boundary-${item.key}`}
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
    <TimelineRow
      dot={<RowLeadingDot icon="signpost" />}
      isLast={isLast}
      testId={`transit-stage-${item.key}`}
    >
      <Typography variant="caption" color="text.secondary" sx={ROW_OVERLINE_SX}>
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
  selected,
}: {
  activity: EnrichedActivity;
  day: Day;
  isLast: boolean;
  onOpenActivity: (activity: EnrichedActivity, selectedOption?: EnrichedMealOption) => void;
  dragHandle?: ReactNode;
  selected?: boolean;
}) {
  const { openEdit, deleteEntity } = useEdit();
  const { mealOptionIndex } = useMealOptionSelection();
  const { above, mid, below } = splitNotes(activity.notes);
  // One observer shared by this node's leading dot and its row text — both
  // sit in the same TimelineItem and cross the same rootMargin together, so
  // there's no need for AvatarOrDot to stand up a second one of its own.
  const { ref: rowRef, inView } = useInViewport<HTMLButtonElement>();

  // A meal row's "add note" actions target whichever candidate is currently
  // selected, not the Activity as a whole — see EnrichedMealOption.notes and
  // mealOptions.ts's selectedMealOptionIndex. onEdit/onDelete below still act
  // on the Activity itself (there's no separate delete for a candidate; that
  // goes through ActivityEditForm's MealOptionList instead).
  let noteTarget: { entity: RefEntityKind; id: string } = { entity: 'activity', id: activity._id };
  const isMeal = isMealActivity(activity);
  if (isMeal) {
    const options = activeMealOptions(activity, day);
    const selected = options[selectedMealOptionIndex(options, mealOptionIndex, activity._id)];
    if (selected) noteTarget = { entity: 'mealOption', id: selected._id };
  }
  const leading = isMeal ? (
    <MealRowLeading activity={activity} day={day} inView={inView} />
  ) : (
    <ActivityLeading activity={activity} inView={inView} />
  );
  // MealRow/ActivityRow take identical props — pick the component itself
  // rather than duplicating the JSX per branch.
  const RowComponent = isMeal ? MealRow : ActivityRow;
  const row = (
    <RowComponent
      activity={activity}
      day={day}
      onOpen={onOpenActivity}
      midNotes={mid}
      inView={inView}
      buttonRef={rowRef}
    />
  );

  return (
    <TimelineRow
      dot={leading}
      isLast={isLast}
      dragHandle={dragHandle}
      selected={selected}
      testId={`activity-row-${activity._id}`}
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
      {row}
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
  dragHandle,
  selected,
}: {
  day: Day;
  tracks: ScenarioTrack[];
  topLevel: boolean;
  isLast: boolean;
  daysByDate: Map<string, Day>;
  onOpenActivity: (activity: EnrichedActivity, selectedOption?: EnrichedMealOption) => void;
  onOpenStay: (stay: EnrichedStay) => void;
  onOpenTransit: (transit: EnrichedTransit) => void;
  dragHandle?: ReactNode;
  selected?: boolean;
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
      dragHandle={dragHandle}
      selected={selected}
      // No pb here (unlike every other node's default pb: 3) —
      // ScenarioTabsSection's own nested DayTimeline already ends in a row
      // with its standard pb: 3, so adding this node's own would double up
      // the trailing gap before whatever comes after the scenario section.
      // px: 0 too, for the same reason TrailingGutter must stay unpadded
      // (see its comment above): this content is a nested DayTimeline, which
      // needs to be exactly as unindented as the top-level one. Scenario
      // TabsSection re-adds the usual ROW_CONTENT_PX inset itself, scoped to
      // just its chips/notes.
      contentSx={{ pb: 0, px: 0 }}
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
// an Activity) in dnd-kit's useSortable — a Stay row and a Transit's
// Arrive/stage rows stay `disabled` (can't be picked up) but still get
// measured, so an Activity can still be dropped immediately before or
// after them; a Transit's own Depart row and the scenario-tabs row are
// `disabled: false` (real drag sources), the latter also passing
// `droppable: false` since it's never a valid drop target (see DragMeta's
// own note in reorder.ts). Only a non-disabled row's drag-handle listeners
// actually get attached to anything visible (each node's own handle icon,
// via the `children` render-prop below), matching this app's existing
// per-row icon-button convention rather than making the whole row a drag
// target — that would fight the row's own click-to-open handler.
function SortableRow({
  dragId,
  disabled,
  droppable = true,
  dragMeta,
  children,
}: {
  dragId: string;
  disabled: boolean;
  droppable?: boolean;
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
      // Must stay the object form, not a plain boolean — dnd-kit's own
      // normalizeDisabled treats `disabled: someBoolean` as disabling BOTH
      // draggable and droppable together, which would make `droppable`
      // above unable to control drop-eligibility independently of
      // drag-eligibility (e.g. a Stay/Transit boundary row: not draggable,
      // but still droppable).
      disabled: { draggable: disabled, droppable: !droppable },
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

// The one droppable row a container needs when it has nothing real
// preceding its own scenario-tabs split (reorder.ts's own note on
// beforeScenarioSplitDragId/realAnchorIdx) — a branch whose entire content
// is one nested scenario-tabs split would otherwise have zero droppable
// rows, since the scenario-tabs row itself never is one. This is pure
// drag-and-drop plumbing, not a real Stay/Transit/Activity entry, so it
// deliberately doesn't render through TimelineRow (no dot, no connector) —
// giving it the same full-size icon-dot treatment as every real row made it
// read as a broken, content-less timeline entry rather than "nothing here."
// It stays fully collapsed until something is actually dragged over it
// (SortableRow's own `isOver`, threaded through here), at which point it
// opens into a thin insertion line — still no dashed box like
// EmptyDropZone's, since this container isn't actually empty, it just has
// nothing to fall back to for a drop meant to land right before the split.
const ScenarioSplitDropSpacer = memo(function ScenarioSplitDropSpacer({
  isOver,
}: {
  isOver?: boolean;
}) {
  return (
    <Box
      sx={{
        ml: `${DRAG_HANDLE_WIDTH + ROW_LEADING_SIZE}px`,
        height: isOver ? 8 : 0,
        borderRadius: 1,
        bgcolor: isOver ? 'primary.main' : 'transparent',
        transition: 'height 120ms, background-color 120ms',
      }}
    />
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
  const filtered = useMemo(
    () => filterSequenceItems(sequence, activeFilterTokens),
    [sequence, activeFilterTokens],
  );
  const { selection, toggleRowSelection } = useRowSelection();

  // Safe to run unconditionally at every level — a scenario track whose own
  // branch carries no scenario-scoped Stay has nothing for this to touch, so
  // it's a no-op there, same as the top-level day.sequence case; a branch
  // that does carry one (Stay.scenarioId) gets its own Check-in/Check-out
  // pulled to the front/back of that branch's own timeline exactly like the
  // top level's. Passing day.scenarioTracks opts splitOutStayBoundaries into
  // also treating a scenario-tabs group as a bare Stay boundary when every
  // one of its tracks agrees it is one (see its own comment) — pulled to the
  // same front/back position a plain Stay item would get, alongside (not
  // ahead of/behind) any real top-level Stay boundary already there.
  const flattened = useMemo(() => {
    const { checkOuts, rest, checkIns } = splitOutStayBoundaries(filtered, day.scenarioTracks);
    return [...checkOuts, ...rest, ...checkIns];
  }, [filtered, day.scenarioTracks]);
  const dayStart = `${day.date}T00:00`;

  // Kept a stable reference across renders the filter/selection/scenario
  // contexts trigger elsewhere in the (unvirtualized, ~28-day) list — every
  // DayTimeline instance shares those contexts, so without this a toggle on
  // one day recomputes every other day's buildDragMeta (including its own
  // recursive collectScenarioGroupMembers walk) for nothing.
  const dragMeta = useMemo(
    () => buildDragMeta(flattened, scenarioId, dayStart, day.leg._id, day.scenarioTracks),
    [flattened, scenarioId, dayStart, day.leg._id, day.scenarioTracks],
  );
  const dragMetaById = useMemo(() => new Map(dragMeta.map((d) => [d.id, d])), [dragMeta]);

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
      source: null,
      anchorEntityId: null,
      anchorTimeLabel: null,
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
    droppable: boolean;
    render: (props: {
      isLast: boolean;
      dragHandle?: ReactNode;
      selected?: boolean;
      isOver?: boolean;
    }) => ReactElement;
  }

  const nodes: DayTimelineNode[] = flattened.flatMap((item, i): DayTimelineNode[] => {
    if (item.type === 'stay') {
      // Must match buildDragMeta's own id scheme exactly (reorder.ts) — keyed
      // by date, not `i`, since a multi-night Stay renders its own row on
      // every night under one shared DndContext (DaysView.tsx), and `i` alone
      // can collide across different days' rows.
      const dragId = `stay-${item.stay._id}-${day.date}`;
      // Only Check-in is a drag source (mirrors Transit's Depart-row-is-the-
      // handle convention) — dropping it onto a scenario tab (or back out to
      // the top-level day) reassigns the whole Stay's scenarioId, same as
      // dragging any other row into/out of a branch. See applyStayReorder.
      const draggable = item.relation === 'Check in';
      return [
        {
          key: dragId,
          dragId,
          draggable,
          droppable: true,
          render: ({ isLast, dragHandle, selected }) => (
            <StayNode
              item={item}
              date={day.date}
              isLast={isLast}
              onOpen={onOpenStay}
              dragHandle={draggable ? dragHandle : undefined}
              selected={draggable ? selected : undefined}
            />
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
          draggable: item.phase === 'depart',
          droppable: true,
          render: ({ isLast, dragHandle, selected }) => (
            <TransitBoundaryNode
              item={item}
              date={day.date}
              isLast={isLast}
              onOpen={onOpenTransit}
              dragHandle={item.phase === 'depart' ? dragHandle : undefined}
              selected={item.phase === 'depart' ? selected : undefined}
            />
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
          droppable: true,
          render: ({ isLast }) => <TransitStageNode item={item} isLast={isLast} />,
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
          droppable: true,
          render: ({ isLast, dragHandle, selected }) => (
            <ActivityNode
              activity={activity}
              day={day}
              isLast={isLast}
              onOpenActivity={onOpenActivity}
              dragHandle={dragHandle}
              selected={selected}
            />
          ),
        };
      });
    }
    // scenario-tabs — id must match buildDragMeta's own id scheme exactly
    // (reorder.ts): namespaced by calendar day AND scenarioId, not just `i`
    // alone, since every DayTimeline instance shares one DndContext
    // (DaysView.tsx) and a bare local index collides across different days'
    // (or a nested group's own) scenario-tabs rows.
    const scenarioDragId = scenarioTabsDragId(dayStart, scenarioId, i);
    const scenarioNode: DayTimelineNode = {
      key: scenarioDragId,
      dragId: scenarioDragId,
      draggable: true,
      droppable: false,
      render: ({ isLast, dragHandle, selected }) => (
        <ScenarioTabsNode
          day={day}
          tracks={item.tracks ?? day.scenarioTracks}
          topLevel={!item.tracks}
          isLast={isLast}
          daysByDate={daysByDate}
          onOpenActivity={onOpenActivity}
          onOpenStay={onOpenStay}
          onOpenTransit={onOpenTransit}
          dragHandle={dragHandle}
          selected={selected}
        />
      ),
    };
    // buildDragMeta (reorder.ts) already decided whether this container has
    // nothing real preceding this split — that's exactly when it emits a
    // beforeScenarioSplitDragId entry alongside the scenario-tabs one, so
    // rather than re-detecting the same condition here, just check whether
    // its id is present. A branch whose entire content is one nested
    // scenario-tabs split would otherwise have zero droppable rows, since
    // this scenario-tabs row never is one itself; this spacer is the one
    // droppable anchor that case needs.
    const spacerId = beforeScenarioSplitDragId(scenarioDragId);
    if (dragMetaById.has(spacerId)) {
      return [
        {
          key: spacerId,
          dragId: spacerId,
          draggable: false,
          droppable: true,
          render: ({ isOver }) => <ScenarioSplitDropSpacer isOver={isOver} />,
        },
        scenarioNode,
      ];
    }
    return [scenarioNode];
  });

  // A 'Staying' night (relation 'Staying') is lodging that bookends the
  // whole day — it's where the day starts (waking up there) as much as
  // where it ends (going back to sleep there), unlike Check out/Check in
  // which each name a single real event. splitOutStayBoundaries already
  // renders its one canonical item at the end of the day, alongside Check
  // in (dragMeta/dnd-kit, the map/route stops, and reorder.ts's drop
  // targeting all key off that single occurrence) — this adds a second,
  // purely decorative copy at the very top for the "woke up here" half,
  // outside the sortable list entirely (dragId: null) so it never becomes a
  // second drop target or a second map/route stop for the same lodging.
  const morningStayNodes: DayTimelineNode[] = flattened
    .filter((item): item is StaySequenceItem => item.type === 'stay' && item.relation === 'Staying')
    .map((item) => ({
      key: `stay-${item.stay._id}-${day.date}-morning`,
      dragId: null,
      draggable: false,
      droppable: false,
      render: ({ isLast }) => (
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
        {allNodes.map((node, i) => {
          const meta = node.dragId ? dragMetaById.get(node.dragId) : undefined;
          const isSelected = Boolean(meta && isRowSelected(selection, meta.id));
          // What this row itself contributes to a group drag: the whole
          // bundle for a scenario-tabs row, or its own single id for a
          // plain Activity/Transit/Stay row — see RowSelectionMembers' own
          // note in TripSelectionsContextObject.ts.
          const rowMembers: RowSelectionMembers | null = meta ? rowMembersOf(meta) : null;
          return (
            <Fragment key={node.key}>
              {node.dragId ? (
                <SortableRow
                  dragId={node.dragId}
                  disabled={!node.draggable}
                  droppable={node.droppable}
                  dragMeta={meta}
                >
                  {(dragHandleProps, isOver) =>
                    node.render({
                      isLast: i === allNodes.length - 1,
                      dragHandle: dragHandleProps ? (
                        <Tooltip
                          title={isSelected ? 'Selected — drag to move group' : 'Drag to reorder'}
                        >
                          <IconButton
                            className={DRAG_HANDLE_HOVER_CLASS}
                            size="small"
                            aria-label={isSelected ? 'Selected, drag to move group' : 'Reorder'}
                            color={isSelected ? 'primary' : 'default'}
                            onClick={
                              meta && rowMembers
                                ? (event) => {
                                    event.stopPropagation();
                                    toggleRowSelection(
                                      meta.id,
                                      containerId,
                                      rowMembers,
                                      meta.source?.kind === 'scenario-group',
                                    );
                                  }
                                : undefined
                            }
                            sx={{
                              flexShrink: 0,
                              cursor: 'grab',
                              touchAction: 'none',
                              opacity: isSelected ? 1 : 0,
                              transition: 'opacity 0.15s',
                              p: `${DRAG_HANDLE_PADDING_PX}px`,
                            }}
                            {...dragHandleProps.attributes}
                            {...dragHandleProps.listeners}
                          >
                            <DragIndicatorIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      ) : undefined,
                      selected: isSelected,
                      isOver,
                    })
                  }
                </SortableRow>
              ) : (
                node.render({ isLast: i === allNodes.length - 1 })
              )}
            </Fragment>
          );
        })}
      </Timeline>
    </SortableContext>
  );
});
