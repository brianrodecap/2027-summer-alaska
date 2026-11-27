import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import Timeline from '@mui/lab/Timeline';
import TimelineConnector from '@mui/lab/TimelineConnector';
import TimelineContent from '@mui/lab/TimelineContent';
import TimelineDot from '@mui/lab/TimelineDot';
import TimelineItem from '@mui/lab/TimelineItem';
import TimelineSeparator from '@mui/lab/TimelineSeparator';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import { useTheme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import {
  createContext,
  type CSSProperties,
  memo,
  type ReactElement,
  type ReactNode,
  useContext,
  useMemo,
} from 'react';

import { useKeyedAsync } from '../../hooks/useKeyedAsync';
import { clockSuffix, dayClocks, dayClocksOf } from '../../model/dayClocks';
import {
  isScheduled,
  mapPinNumbers,
  rowHop,
  stayMorningRowId,
  stayRowId,
} from '../../model/dayMap';
import { type DriveInfo, lookupTravelInfo } from '../../model/directions';
import { applyTravelModeSelection, resolveTravelMode } from '../../model/editForms';
import { filterRows } from '../../model/filters';
import {
  firstImage,
  formatMinutes,
  formatTravel,
  placeFromLodging,
  STAGE_KIND_LABEL,
  TRAVEL_MODES,
} from '../../model/formatting';
import { activeMealOptions, isMealActivity, selectedMealOption } from '../../model/mealOptions';
import {
  beforeScenarioSplitDragId,
  containerDragMeta,
  dragIdOf,
  type DragMeta,
  rowMembersOf,
} from '../../model/reorder';
import {
  activeTrackOf,
  activityNodeKey,
  buildDirectionsUrl,
  entryNotes,
  flattenStayBoundaries,
  formatTime,
  routeStop,
  rowShows,
  segmentKey,
  stayNodeKey,
  stayRelation,
  transitRowPlace,
  type ZonedTime,
} from '../../model/tripModel';
import type {
  Day,
  DayRow,
  EnrichedActivity,
  Place,
  RefEntityKind,
  ScenarioTrack,
  StayRow,
  TransitBoundaryRow,
  TransitStageRow,
  TravelMode,
} from '../../model/types';
import { cardId } from '../../state/expandedRows';
import { isRowSelected, type RowSelectionMembers } from '../../state/TripSelectionsContextObject';
import { useEdit } from '../../state/useEdit';
import { useMoveToDay } from '../../state/useMoveToDay';
import { useTripData } from '../../state/useTripData';
import {
  useFilterSelection,
  useMealOptionSelection,
  useRowSelection,
} from '../../state/useTripSelections';
import { StayExtras, StayGoogle, StayLines } from '../detail/StayCardDetails';
import { TransitExtras, TransitGoogle, TransitLines } from '../detail/TransitCardDetails';
import { InfoLink } from '../shared/InfoChip';
import { renderMaterialIcon, transitModeIconName, TRAVEL_MODE_ICON } from '../shared/materialIcon';
import { planColor } from '../shared/planColor';
import { CARD_PADDING_PX } from '../shared/rowLeadingTokens';
import { STOP_NODE_SIZE, StopNode } from '../shared/StopRail';
import { ActivityRow } from './ActivityRow';
import { AvatarOrDot } from './AvatarOrDot';
import { ClockChangeMarker } from './ClockChangeMarker';
import { ClockSuffixContext, useClockSuffix } from './dayClock';
import { DRAG_HANDLE_PADDING_PX, DRAG_HANDLE_WIDTH, TIMELINE_CONTENT_PAD } from './dayLayout';
import { DayPinsContext, useDayPin } from './dayPins';
import { MealRow } from './MealRow';
import { PlaceConditionsLine } from './PlaceConditionsLine';
import { RouteVariantTabs } from './RouteVariantTabs';
import { RowCard } from './RowCard';
import { RowMenu } from './RowMenu';
import { tracksByGroup } from './scenarioSelection';
import { ScenarioTabsSection } from './ScenarioTabsSection';
import { useInViewport } from './useInViewport';

// Applied uniformly to every row (Stay/Transit/Activity alike) so the cards
// beside it stay aligned down the page regardless of which individual rows actually carry a drag handle — an Activity row
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

// A plan section that's part of the drag-handle multi-select (a card tints itself).
const SELECTED_SECTION_SX = { bgcolor: 'primary.container', borderRadius: 1.5 } as const;

// A row is as tall as its content, not MUI's minimum item height.
const ITEM_SX = { minHeight: 0 } as const;

// Static — hoisted so LeadingGutter doesn't reallocate an sx object on every
// row's every render.
const LEADING_GUTTER_SX = {
  // Matches DRAG_HANDLE_WIDTH, so rows without a drag handle still reserve
  // its width and keep the cards aligned.
  width: DRAG_HANDLE_WIDTH,
  flexShrink: 0,
  alignSelf: 'flex-start',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'flex-start',
  // Level with the card's first line.
  pt: `${CARD_PADDING_PX}px`,
} as const;

function LeadingGutter({ dragHandle }: { dragHandle?: ReactNode }) {
  return <Box sx={LEADING_GUTTER_SX}>{dragHandle}</Box>;
}

// Whether a row opens or closes its own list, where the timeline's line starts and
// stops.
const RowEndsContext = createContext({ first: false, last: false });
// One object per combination, so a re-rendering list doesn't re-render every row.
const ROW_ENDS = [false, true].map((first) => [false, true].map((last) => ({ first, last })));

// The line's column, as wide as a numbered dot.
const SEPARATOR_SX = { flex: `0 0 ${STOP_NODE_SIZE}px` } as const;

// A row's dot on the line: its map pin's number (the route planner's ring), else an
// icon where the row has one (a plan section), else a plain dot. A plain dot is
// smaller than a ring, so the line runs through its box to meet it.
function RowDot({
  pinId,
  icon,
  travelAbove,
}: {
  pinId?: string;
  icon?: string;
  travelAbove?: boolean;
}) {
  const { number, color } = useDayPin(pinId ?? '');
  const { first, last } = useContext(RowEndsContext);
  if (pinId && number !== undefined) {
    return (
      <Box role="img" aria-label={`Map pin ${number}`}>
        <StopNode glyph={String(number)} color={color} />
      </Box>
    );
  }
  return (
    <Box
      sx={{
        height: STOP_NODE_SIZE,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      <TimelineConnector sx={{ visibility: first && !travelAbove ? 'hidden' : 'visible' }} />
      <TimelineDot variant="outlined" color="grey" sx={{ m: 0, p: icon ? '3px' : '4px' }}>
        {icon && renderMaterialIcon(icon, { sx: { fontSize: 16 } })}
      </TimelineDot>
      <TimelineConnector sx={{ visibility: last ? 'hidden' : 'visible' }} />
    </Box>
  );
}

// One list row on the timeline: the drag handle's gutter, the dot on the line, and
// the row's card. The travel that ends here is its own item just above, on the line
// between the two cards. A plan section passes `bare`: its own nested list already
// spaces its rows.
function TimelineRow({
  dragHandle,
  pinId,
  icon,
  bare,
  travel,
  children,
}: {
  dragHandle?: ReactNode;
  pinId?: string;
  icon?: string;
  bare?: boolean;
  travel?: ReactNode;
  children: ReactNode;
}) {
  const { first, last } = useContext(RowEndsContext);
  return (
    <>
      {travel && (
        <TimelineItem sx={ITEM_SX}>
          <LeadingGutter />
          <TimelineSeparator sx={SEPARATOR_SX}>
            <TimelineConnector />
          </TimelineSeparator>
          {/* lined up with the card's text, midway between the two cards */}
          <TimelineContent sx={{ py: 0, pr: 0, pl: `${8 + CARD_PADDING_PX}px`, pb: 1 }}>
            <Box sx={{ display: 'flex' }}>{travel}</Box>
          </TimelineContent>
        </TimelineItem>
      )}
      <TimelineItem sx={dragHandle ? { ...ITEM_SX, ...ACTIVITY_HOVER_SX } : ITEM_SX}>
        <LeadingGutter dragHandle={dragHandle} />
        <TimelineSeparator sx={SEPARATOR_SX}>
          {/* brings the line down to the dot, which sits level with the card's first line */}
          <TimelineConnector
            sx={{
              flex: `0 0 ${CARD_PADDING_PX}px`,
              visibility: first && !travel ? 'hidden' : 'visible',
            }}
          />
          <RowDot pinId={pinId} icon={icon} travelAbove={Boolean(travel)} />
          {!last && <TimelineConnector />}
        </TimelineSeparator>
        <TimelineContent sx={{ py: 0, pr: 0, pl: TIMELINE_CONTENT_PAD, pb: bare ? 0 : 1 }}>
          {children}
        </TimelineContent>
      </TimelineItem>
    </>
  );
}

const isBoundaryRow = (row: DayRow): row is TransitBoundaryRow =>
  row.type === 'transit' && row.phase !== 'stage';

const StayNode = memo(function StayNode({
  item,
  morning,
  date,
  dragHandle,
  selected,
  travel,
}: {
  item: StayRow;
  date: string;
  // The copy that opens a day spent in the middle of a stay.
  morning?: boolean;
  dragHandle?: ReactNode;
  selected?: boolean;
  travel?: ReactNode;
}) {
  const { stay } = item;
  const lodgingPlace = placeFromLodging(stay.lodging);
  const name = lodgingPlace?.label ?? 'Lodging still open';
  const image = firstImage(stay, lodgingPlace);
  const { openEdit, deleteEntity } = useEdit();
  const { requestMove } = useMoveToDay();
  const { booking, notes } = rowShows(item);
  const rowId = morning ? stayMorningRowId(stay._id) : stayRowId(stay._id, item.key);
  return (
    <TimelineRow dragHandle={dragHandle} travel={travel} pinId={rowId}>
      <RowCard
        selected={selected}
        notes={notes}
        booking={booking}
        overline={stayRelation(stay, date)}
        name={name}
        title={name}
        conditions={<PlaceConditionsLine place={lodgingPlace} date={date} />}
        photo={<AvatarOrDot image={image} icon="hotel" />}
        cardId={cardId(date, rowId)}
        details={{
          booking: stay.booking,
          notes: entryNotes(stay),
          lines: <StayLines stay={stay} />,
          extras: <StayExtras stay={stay} />,
          google: <StayGoogle stay={stay} />,
        }}
        menu={
          <RowMenu
            entity="stay"
            id={stay._id}
            onEdit={() => openEdit('stay', stay._id)}
            onMove={() => requestMove([{ activityIds: [], transitIds: [], stayIds: [stay._id] }])}
            onDelete={() => deleteEntity('stay', stay._id)}
          />
        }
      />
    </TimelineRow>
  );
});

const TransitBoundaryNode = memo(function TransitBoundaryNode({
  item,
  date,
  dragHandle,
  selected,
  travel,
}: {
  item: TransitBoundaryRow;
  date: string;
  dragHandle?: ReactNode;
  selected?: boolean;
  travel?: ReactNode;
}) {
  const { transit, phase, event } = item;
  const isDepart = phase === 'depart';
  const endpointPlace = isDepart ? transit.from : transit.to;
  // The timeline event already resolved the selected route variant's time.
  const time = event.at;
  const clock = useClockSuffix(time ? { at: time, zone: event.zone } : null);
  const modeIconName = transitModeIconName(transit);
  const image = firstImage(transit, endpointPlace);
  const { openEdit, deleteEntity } = useEdit();
  const { requestMove } = useMoveToDay();
  const { booking, notes } = rowShows(item);
  const rowId = dragIdOf(item, date);
  const phaseLabel = isDepart ? 'Depart' : 'Arrive';

  return (
    <TimelineRow dragHandle={dragHandle} travel={travel} pinId={rowId}>
      <RowCard
        selected={selected}
        notes={notes}
        booking={booking}
        overline={time ? `${formatTime(time)}${clock} · ${phaseLabel}` : phaseLabel}
        name={endpointPlace.label}
        title={endpointPlace.label}
        conditions={<PlaceConditionsLine place={endpointPlace} date={date} />}
        photo={<AvatarOrDot image={image} icon={modeIconName} />}
        cardId={cardId(date, rowId)}
        details={
          isDepart
            ? {
                booking: transit.booking,
                notes: entryNotes(transit),
                lines: <TransitLines transit={transit} />,
                extras: <TransitExtras transit={transit} />,
                google: <TransitGoogle transit={transit} />,
              }
            : undefined
        }
        menu={
          isDepart && (
            <RowMenu
              entity="transit"
              id={transit._id}
              onEdit={() => openEdit('transit', transit._id)}
              onMove={() =>
                requestMove([{ activityIds: [], transitIds: [transit._id], stayIds: [] }])
              }
              onDelete={() => deleteEntity('transit', transit._id)}
            />
          )
        }
      >
        {isDepart && <RouteVariantTabs transit={transit} />}
      </RowCard>
    </TimelineRow>
  );
});

const TransitStageNode = memo(function TransitStageNode({
  item,
  date,
  travel,
}: {
  date: string;
  item: TransitStageRow;
  travel?: ReactNode;
}) {
  const { stage } = item;
  const clock = useClockSuffix({ at: stage.key, zone: stage.zone });
  const rowId = dragIdOf(item, date);
  return (
    <TimelineRow travel={travel} pinId={rowId}>
      <RowCard
        cardId={cardId(date, rowId)}
        // arrival and, for a stop, when the drive goes on, so the next leg adds up
        overline={`${formatTime(stage.key)}${
          stage.leavesAt === stage.key ? '' : `–${formatTime(stage.leavesAt)}`
        }${clock} ·\u00a0${STAGE_KIND_LABEL[stage.kind] ?? 'Via'}`}
        title={<span title={stage.note ?? undefined}>{stage.place.label}</span>}
        photo={<AvatarOrDot image={stage.place.images?.[0] ?? null} icon="signpost" />}
      />
    </TimelineRow>
  );
});

const ActivityNode = memo(function ActivityNode({
  activity,
  day,
  dragHandle,
  selected,
  travel,
}: {
  activity: EnrichedActivity;
  day: Day;
  dragHandle?: ReactNode;
  selected?: boolean;
  travel?: ReactNode;
}) {
  const { openEdit, deleteEntity } = useEdit();
  const { requestMove } = useMoveToDay();
  const { mealOptionIndex } = useMealOptionSelection();
  // One observer for the card's photo and its sun-anchored time.
  const { ref: cardRef, inView } = useInViewport<HTMLDivElement>();

  // A meal row's "add note" actions target whichever candidate is currently
  // selected, not the Activity as a whole — see EnrichedMealOption.notes and
  // mealOptions.ts's selectedMealOption. onEdit/onDelete below still act
  // on the Activity itself (there's no separate delete for a candidate; that
  // goes through ActivityEditForm's MealOptionList instead).
  let noteTarget: { entity: RefEntityKind; id: string } = { entity: 'activity', id: activity._id };
  const isMeal = isMealActivity(activity);
  if (isMeal) {
    const options = activeMealOptions(activity, day);
    const selected = selectedMealOption(options, mealOptionIndex, activity._id);
    if (selected) noteTarget = { entity: 'mealOption', id: selected._id };
  }
  // MealRow/ActivityRow take identical props — pick the component itself
  // rather than duplicating the JSX per branch.
  const RowComponent = isMeal ? MealRow : ActivityRow;

  return (
    <TimelineRow dragHandle={dragHandle} travel={travel} pinId={activityNodeKey(activity._id)}>
      <RowComponent
        activity={activity}
        day={day}
        inView={inView}
        cardRef={cardRef}
        selected={selected}
        menu={
          <RowMenu
            entity={noteTarget.entity}
            id={noteTarget.id}
            onEdit={() => openEdit('activity', activity._id)}
            onMove={() =>
              requestMove([{ activityIds: [activity._id], transitIds: [], stayIds: [] }])
            }
            onDelete={() => deleteEntity('activity', activity._id)}
          />
        }
      />
    </TimelineRow>
  );
});

const ScenarioTabsNode = memo(function ScenarioTabsNode({
  day,
  tracks,
  dragHandle,
  selected,
  travel,
}: {
  day: Day;
  tracks: ScenarioTrack[];
  dragHandle?: ReactNode;
  selected?: boolean;
  // The travel into this section. It's drawn inside the first group's list, above
  // the row it ends at.
  travel?: ReactNode;
}) {
  // Mirrors ScenarioTabsSection's own emptiness check — no active track (a
  // track list that's simply gone, e.g. right after the scenario it held was
  // deleted) has nothing to show. Bail before rendering any of the
  // row — otherwise an empty row renders.
  const groups = tracksByGroup(tracks).filter((group) => activeTrackOf(group));
  if (!groups.length) return null;
  return (
    <TimelineRow dragHandle={dragHandle} icon="alt_route" bare>
      <Box sx={selected ? SELECTED_SECTION_SX : undefined}>
        {groups.map((group, i) => (
          <ScenarioTabsSection
            key={group[0].groupKey}
            day={day}
            tracks={group}
            leadingTravel={i === 0 ? travel : undefined}
          />
        ))}
      </Box>
    </TimelineRow>
  );
});

// "to <destination>", opening Google Maps directions from where the leg starts, by
// the mode picked for it.
function DirectionsLink({
  origin,
  destination,
  mode,
}: {
  origin: Place;
  destination: Place;
  mode: TravelMode;
}) {
  const from = routeStop(origin);
  const to = routeStop(destination);
  const text = `to ${destination.label}`;
  return (
    <Typography variant="caption" color="text.secondary">
      <InfoLink
        href={from && to ? buildDirectionsUrl(from, to, [], mode) : null}
        label={`Directions from ${origin.label} to ${destination.label} in Google Maps`}
      >
        {text}
      </InfoLink>
    </Typography>
  );
}

// The picker lists TRAVEL_MODES in its own fixed order. No text label — the icon
// alone says which mode an option is, matching Google's own mode-picker convention.

// All four modes' info is fetched together, not just the currently-selected
// one — the dropdown itself shows each mode's own duration/distance (so a
// viewer can compare before switching), which means every option needs its
// figures ready the moment the menu opens rather than on pick.
async function fetchAllTravelInfo(
  originId: string,
  destinationId: string,
): Promise<Partial<Record<TravelMode, DriveInfo | null>>> {
  const entries = await Promise.all(
    TRAVEL_MODES.map(async (mode) => {
      const info = await lookupTravelInfo(originId, destinationId, mode).catch(() => null);
      return [mode, info] as const;
    }),
  );
  return Object.fromEntries(entries);
}

function useAllTravelInfo(originId: string, destinationId: string, active: boolean) {
  const key = active ? `${originId}:${destinationId}` : null;
  return useKeyedAsync(key, key !== null, () => fetchAllTravelInfo(originId, destinationId));
}

// The "icon, duration, then miles" treatment this row/dropdown-option pair
// both use — no text mode name, since the icon alone (drive/walk/bike/bus)
// already says which mode this is, the same way Google's own mode-picker
// reads.
function TravelModeSummary({
  mode,
  info,
  loading,
}: {
  mode: TravelMode;
  info: DriveInfo | null | undefined;
  loading: boolean;
}) {
  return (
    <IconCaption icon={TRAVEL_MODE_ICON[mode]}>
      {loading ? '…' : info ? formatTravel(info) : 'No route'}
    </IconCaption>
  );
}

// The travel line's icon and text, the drive's or the layover's.
function IconCaption({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
      {renderMaterialIcon(icon, { fontSize: 'small', sx: { color: 'text.secondary' } })}
      <Typography variant="caption" color="text.secondary" component="span">
        {children}
      </Typography>
    </Stack>
  );
}

// Above a connecting flight's Depart, in place of a drive: how long the connection is.
function Layover({ minutes }: { minutes: number }) {
  return <IconCaption icon="hourglass_empty">{formatMinutes(minutes)} layover</IconCaption>;
}

// The travel line above the card a leg ends at, when it starts at a different,
// actually-resolvable Place — never across a flight or ferry; see the
// travelBefore pass below. Mode is picked per segment, not once for the whole day —
// a traveler might walk from the hotel to breakfast but drive everywhere else —
// and defaults to DRIVE.
// Unlike the scenario/route-tone/meal-option selections (deliberately
// session-only, a fresh decision every visit), a non-default pick here is
// real trip content: it's stored in TripData.travelModeOverrides (see
// types.ts) and flows through the same setData/change-log/export path
// every other edit in this app uses, so once exported it round-trips through
// public/data/<slug>/travelModeOverrides.json and is shared by every viewer. Picking DRIVE back
// removes the segment's entry instead of storing it explicitly — see the
// onChange handler below.
const TravelInfoControl = memo(function TravelInfoControl({
  segmentKey: segKey,
  origin,
  destination,
}: {
  segmentKey: string;
  origin: Place;
  destination: Place;
}) {
  const { data, setData } = useTripData();
  const mode = resolveTravelMode(data?.travelModeOverrides ?? [], segKey);
  const { ref, inView } = useInViewport<HTMLDivElement>();
  const { value: allInfo, loading } = useAllTravelInfo(
    origin.id as string,
    destination.id as string,
    inView,
  );
  const showLoading = !inView || loading;

  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={{ xs: 0.25, sm: 0.5 }}
      ref={ref}
      sx={{ alignItems: { xs: 'flex-start', sm: 'center' } }}
    >
      <Select<TravelMode>
        size="small"
        variant="standard"
        value={mode}
        onChange={(e: SelectChangeEvent<TravelMode>) => {
          const nextMode = e.target.value as TravelMode;
          setData((prev) => ({
            ...prev,
            travelModeOverrides: applyTravelModeSelection(
              prev.travelModeOverrides,
              segKey,
              nextMode,
            ),
          }));
        }}
        renderValue={(value) => (
          <TravelModeSummary mode={value} info={allInfo?.[value]} loading={showLoading} />
        )}
        sx={{
          '&::before': { display: 'none' },
          '&::after': { display: 'none' },
          '& .MuiSelect-select': {
            display: 'flex',
            alignItems: 'center',
            py: 0,
            minHeight: 'auto',
          },
        }}
      >
        {TRAVEL_MODES.map((optionMode) => (
          <MenuItem key={optionMode} value={optionMode}>
            <TravelModeSummary
              mode={optionMode}
              info={allInfo?.[optionMode]}
              loading={showLoading}
            />
          </MenuItem>
        ))}
      </Select>
      <DirectionsLink origin={origin} destination={destination} mode={mode} />
    </Stack>
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
// deliberately doesn't render through TimelineRow — a full row made it read
// as a broken, content-less entry rather than "nothing here."
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
        ml: `${DRAG_HANDLE_WIDTH + STOP_NODE_SIZE}px`,
        height: isOver ? 8 : 0,
        borderRadius: 1,
        bgcolor: isOver ? 'primary.main' : 'transparent',
        transition: 'height 120ms, background-color 120ms',
      }}
    />
  );
});

// A scenario-tabs split's own first/last real, resolvable Place — walked
// through whichever track is active (activeTrackOf, the same one
// ScenarioTabsSection itself renders) is currently active, recursing into a
// nested scenario-tabs item's own active track when the branch's own
// leading/trailing item is itself another split. Lets the travel
// pass (below) still show a distance/duration for the row immediately
// before/after a scenario split, using whichever single endpoint is
// actually on screen right now, rather than treating every scenario
// boundary as unresolvable the way a bare `Place | null` on the split
// itself would have to. Never past a flight's or ferry's own Depart or
// Arrive, resolved or not — no drive crosses one (dayMap.ts's rowHop stops
// there too).
function edgeRealPlace(rows: DayRow[], fromStart: boolean): Place | null {
  return edgeStop(rows, fromStart) || null;
}

// edgeRealPlace's walk: the place, null when the rows have none, false when a
// scheduled transit's boundary ends the walk first.
function edgeStop(rows: DayRow[], fromStart: boolean): Place | null | false {
  const flattened = flattenStayBoundaries(rows);
  const ordered = fromStart ? flattened : [...flattened].reverse();
  for (const item of ordered) {
    if (item.type === 'stay') {
      const place = placeFromLodging(item.stay.lodging);
      if (place?.id) return place;
    } else if (item.type === 'transit') {
      const place = transitRowPlace(item);
      if (place?.id) return place;
      if (isBoundaryRow(item) && isScheduled(item.transit)) return false;
    } else if (item.type === 'activity') {
      // Already resolved for the reader's selections (a still-open meal's
      // currently-selected candidate) when the timeline was built.
      const place = item.event.place;
      if (place?.id) return place;
    } else {
      const active = activeTrackOf(item.tracks);
      const stop = active ? edgeStop(active.rows, fromStart) : null;
      if (stop !== null) return stop;
    }
  }
  return null;
}

// A 'section' item bundles several same-moment activities into one array —
// flatten it to one row per activity, matching every other node type.
// `dragId` mirrors buildDragMeta's own id scheme exactly (see reorder.ts)
// so a row and its DragMeta always resolve to the same dnd-kit id; null
// for scenario-tabs, which isn't a single point in time to drop against.
interface DayTimelineNode {
  key: string;
  dragId: string | null;
  draggable: boolean;
  droppable: boolean;
  // The real-world Place(s) this row represents, for the travel
  // pass below — null for anything that isn't a single point in space (a
  // drag spacer, or a non-active route variant's own stage row). Equal for
  // every ordinary row (a Stay/Transit-boundary/stage/Activity names one
  // Place, entered and exited at the same spot); a scenario-tabs split is
  // the one node where they differ, since it can enter at one real Place
  // and exit at a completely different one depending on which branch is
  // active — see edgeRealPlace above.
  entryPlace: Place | null;
  exitPlace: Place | null;
  // A transit's Depart or Arrive row — what the travel pass asks
  // scheduledHop about, since a flight's own hop is never a drive.
  boundary?: TransitBoundaryRow;
  // The drop spacer before a plan section draws no row on the line.
  spacer?: boolean;
  render: (props: {
    dragHandle?: ReactNode;
    selected?: boolean;
    isOver?: boolean;
    travel?: ReactNode;
  }) => ReactElement;
}

export const DayTimeline = memo(function DayTimeline({
  day,
  rows,
  containerId,
  scenarioId = null,
  leadingTravel,
}: {
  day: Day;
  rows: DayRow[];
  // Distinct per rendered timeline — the top-level day passes its own date,
  // a scenario tab passes `${date}::${scenarioId}` — so dnd-kit can tell
  // which of this day's (possibly several) sortable lists a drop landed in.
  containerId: string;
  // null for the top-level (scenario-less) list; a scenario tab passes its
  // own scenario._id, so a dropped Activity picks it up as its new
  // scenarioId.
  scenarioId?: string | null;
  // The travel that ends inside this list but starts before it — handed down by
  // ScenarioTabsNode/ScenarioTabsSection for a plan's own list, and drawn above
  // its first row with a real place. Undefined for the top-level day.
  leadingTravel?: ReactNode;
}) {
  const { activeFilterTokens } = useFilterSelection();
  const filtered = useMemo(
    () => filterRows(rows, day, activeFilterTokens),
    [rows, day, activeFilterTokens],
  );
  const { selection, toggleRowSelection } = useRowSelection();
  // Safe to run unconditionally at every level — a scenario track whose own
  // branch carries no scenario-scoped Stay has nothing for this to touch, so
  // it's a no-op there, same as the top-level day.rows case; a branch
  // that does carry one (Stay.scenarioId) gets its own Check-in/Check-out
  // pulled to the front/back of that branch's own timeline exactly like the
  // top level's. A scenario box whose active branch is nothing but Stay
  // boundaries is treated as a bare Stay boundary too (see
  // splitOutStayBoundaries) — pulled to the same front/back position a plain
  // Stay row would get, alongside (not ahead of/behind) any real top-level
  // Stay boundary already there.
  const flattened = useMemo(() => flattenStayBoundaries(filtered), [filtered]);
  const dayStart = `${day.date}T00:00`;

  // Kept a stable reference across renders the filter/selection/scenario
  // contexts trigger elsewhere in the (unvirtualized, ~28-day) list — every
  // DayTimeline instance shares those contexts, so without this a toggle on
  // one day recomputes every other day's buildDragMeta (including its own
  // scenario-group members walk) for nothing.
  const dragMeta = useMemo(
    () => containerDragMeta(day, filtered, scenarioId),
    [day, filtered, scenarioId],
  );
  const dragMetaById = useMemo(() => new Map(dragMeta.map((d) => [d.id, d])), [dragMeta]);

  // Where the clock moves, by the drag id of the row it moves before, among the
  // rows the filter shows.
  const clockChanges = useMemo(
    () =>
      (activeFilterTokens.size
        ? dayClocks(day, (list) => filterRows(list, day, activeFilterTokens))
        : dayClocksOf(day)
      ).changes,
    [day, activeFilterTokens],
  );
  // The day map's own pin numbers and line color, so a card and its pin agree. They
  // come from every visit of the day, so filtering the list never renumbers.
  const { palette } = useTheme();
  const pinColor = planColor(palette.routeVariants, day.scenarioTracks);
  const pins = useMemo(
    () => ({ numbers: mapPinNumbers(day.visits), color: pinColor }),
    [day.visits, pinColor],
  );
  const clockSuffixOf = useMemo(() => (time: ZonedTime) => clockSuffix(day, time), [day]);

  // Rebuilt only when this list's own rows change — an unrelated tab/meal/
  // route selection elsewhere in the trip hands this day back as the very
  // same object (see buildLiveDays' per-date cache) — since each rebuild
  // re-walks every row's edge Place (edgeRealPlace) across an unvirtualized
  // ~28-day list. Every row's Place was already resolved for the reader's
  // selections when the timeline was built (event.place).
  const allNodes = useMemo((): DayTimelineNode[] => {
    const nodes: DayTimelineNode[] = flattened.flatMap((item): DayTimelineNode[] => {
      if (item.type === 'stay') {
        const dragId = dragIdOf(item, day.date);
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
            entryPlace: placeFromLodging(item.stay.lodging),
            exitPlace: placeFromLodging(item.stay.lodging),
            render: ({ dragHandle, selected, travel }) => (
              <StayNode
                item={item}
                date={day.date}
                dragHandle={draggable ? dragHandle : undefined}
                selected={draggable ? selected : undefined}
                travel={travel}
              />
            ),
          },
        ];
      }
      if (isBoundaryRow(item)) {
        const dragId = dragIdOf(item, day.date);
        const boundaryPlace = transitRowPlace(item);
        return [
          {
            key: dragId,
            dragId,
            draggable: item.phase === 'depart',
            droppable: true,
            entryPlace: boundaryPlace,
            exitPlace: boundaryPlace,
            boundary: item,
            render: ({ dragHandle, selected, travel }) => (
              <TransitBoundaryNode
                item={item}
                date={day.date}
                dragHandle={item.phase === 'depart' ? dragHandle : undefined}
                selected={item.phase === 'depart' ? selected : undefined}
                travel={travel}
              />
            ),
          },
        ];
      }
      if (item.type === 'transit') {
        const dragId = dragIdOf(item, day.date);
        // The stage's own already-resolved Place (with its image, alongside
        // its id/label) — a live day only carries the selected variant's stages.
        const stagePlace = transitRowPlace(item);
        return [
          {
            key: dragId,
            dragId,
            draggable: false,
            droppable: true,
            entryPlace: stagePlace,
            exitPlace: stagePlace,
            render: ({ travel }) => (
              <TransitStageNode item={item} date={day.date} travel={travel} />
            ),
          },
        ];
      }
      if (item.type === 'activity') {
        const { activity } = item;
        const dragId = dragIdOf(item, day.date);
        return [
          {
            key: dragId,
            dragId,
            draggable: true,
            droppable: true,
            entryPlace: item.event.place,
            exitPlace: item.event.place,
            render: ({ dragHandle, selected, travel }) => (
              <ActivityNode
                activity={activity}
                day={day}
                dragHandle={dragHandle}
                selected={selected}
                travel={travel}
              />
            ),
          },
        ];
      }
      // scenario box — the id comes from dragIdOf, the same function
      // buildDragMeta uses, so a rendered row and its DragMeta always agree.
      const scenarioDragId = dragIdOf(item, day.date);
      // A branch point, not a single place — the entry/exit Place depends on
      // which track is active, so it's resolved from whichever one actually is
      // (activeTrackOf, same as ScenarioTabsSection's own tab) rather than
      // left null. A track with no visible branch (nothing active, e.g. every
      // tab gated out) still gets no travel on either side.
      const activeScenarioTrack = activeTrackOf(item.tracks);
      const resolveScenarioEdgePlace = (fromStart: boolean) =>
        activeScenarioTrack ? edgeRealPlace(activeScenarioTrack.rows, fromStart) : null;
      const scenarioEntryPlace = resolveScenarioEdgePlace(true);
      const scenarioExitPlace = resolveScenarioEdgePlace(false);
      const scenarioNode: DayTimelineNode = {
        key: scenarioDragId,
        dragId: scenarioDragId,
        draggable: true,
        droppable: false,
        entryPlace: scenarioEntryPlace,
        exitPlace: scenarioExitPlace,
        render: ({ dragHandle, selected, travel }) => (
          <ScenarioTabsNode
            day={day}
            tracks={item.tracks}
            dragHandle={dragHandle}
            selected={selected}
            travel={travel}
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
            spacer: true,
            dragId: spacerId,
            draggable: false,
            droppable: true,
            entryPlace: null,
            exitPlace: null,
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
      .filter((item): item is StayRow => item.type === 'stay' && item.relation === 'Staying')
      .map((item) => ({
        key: `${stayNodeKey(item.stay._id, day.date)}-morning`,
        dragId: null,
        draggable: false,
        droppable: false,
        entryPlace: placeFromLodging(item.stay.lodging),
        exitPlace: placeFromLodging(item.stay.lodging),
        render: ({ travel }) => <StayNode item={item} date={day.date} morning travel={travel} />,
      }));
    return [...morningStayNodes, ...nodes];
  }, [flattened, day, dragMetaById]);

  // The travel into each row, by that row's key: drawn directly above its card, so
  // rows with no place of their own (a meal not yet placed) come before the drive,
  // not between it and where it ends. Only between two rows that each name a
  // different, actually resolvable (real Google Place id) Place — same-place
  // neighbors (e.g. two activities at the same lodging) get none. A scenario-tabs
  // split's entryPlace/exitPlace (edgeRealPlace above) resolves to whichever branch
  // is active. Travel ending at the split is handed into that branch's own list as
  // leadingTravel.
  //
  // A row whose own Place has no real id (a whole city like "Fairbanks" as a
  // Transit's arrival endpoint, or a park like "Denali National Park") can't be
  // either end of a segment, but it doesn't dead-end its resolvable neighbors:
  // dayMap.ts's rowHop skips forward past it, stopping at a flight's or ferry's own
  // Depart or Arrive, resolved or not, since no drive crosses one. That lands on the
  // same pairs of places as dayMap.ts's travelSegments (the day header's total) and
  // the map.
  //
  // A scheduled transit's own hops aren't driven (dayMap.ts's scheduledHop): a
  // connection gets the layover above the next Depart instead.
  // Memoized so each element keeps its identity across unrelated re-renders.
  const travelBefore = useMemo((): ReadonlyMap<string, ReactNode> => {
    const before = new Map<string, ReactNode>();
    const first = allNodes.find((node) => node.entryPlace?.id);
    if (first && leadingTravel) before.set(first.key, leadingTravel);
    allNodes.forEach((node, i) => {
      const hop = rowHop(allNodes, i);
      if (!hop || hop.kind === 'aboard') return;
      if (hop.kind === 'connection') {
        before.set(hop.next.key, <Layover minutes={hop.minutes} />);
        return;
      }
      const segKey = segmentKey(node.key, hop.next.key);
      before.set(
        hop.next.key,
        <TravelInfoControl
          key={segKey}
          segmentKey={segKey}
          origin={hop.from}
          destination={hop.to}
        />,
      );
    });
    return before;
  }, [allNodes, leadingTravel]);

  const firstRow = allNodes.findIndex((node) => !node.spacer);

  if (!flattened.length) {
    // Filtering everything out of an otherwise non-empty sequence renders
    // nothing at all here — DaysView's own dayHasVisibleContent check is
    // what hides the day-block itself; "Nothing scheduled yet" stays
    // reserved for a day that's genuinely empty, filters aside.
    if (rows.length && activeFilterTokens.size) return null;
    // Still wrapped in a SortableContext, same as the non-empty branch below
    // — a freshly-added, still-empty scenario (DaysView's "Add to this day"
    // > Scenario) needs somewhere to catch a drop, and a bare early-return
    // here would leave it with no registered droppable at all.
    const placeholderId = `empty-${containerId}`;
    const placeholderMeta: DragMeta = {
      id: placeholderId,
      index: 0,
      endAt: null,
      endZone: null,
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

  return (
    <ClockSuffixContext.Provider value={clockSuffixOf}>
      <DayPinsContext.Provider value={pins}>
        <SortableContext
          items={dragMeta.map((d) => d.id)}
          strategy={verticalListSortingStrategy}
          id={containerId}
        >
          <Timeline
            sx={{
              p: 0,
              m: 0,
              // MUI reserves a flex-basis gutter on TimelineItem's own ::before for
              // the "opposite content" column even when nothing ever supplies one —
              // kill it so the line's column sits flush against the day block's left
              // edge instead of floating in the middle.
              '& .MuiTimelineItem-root::before': { display: 'none !important' },
              // TimelineContent is a flex item whose content-based minimum width
              // would otherwise win over its flex basis (a clamped note reports its
              // unwrapped width), pushing the day wider than the viewport.
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
              const clockChange = node.dragId ? clockChanges.get(node.dragId) : undefined;
              const ends = ROW_ENDS[Number(i === firstRow)][Number(i === allNodes.length - 1)];
              return (
                <RowEndsContext.Provider key={node.key} value={ends}>
                  {clockChange && <ClockChangeMarker change={clockChange} />}
                  {node.dragId ? (
                    <SortableRow
                      dragId={node.dragId}
                      disabled={!node.draggable}
                      droppable={node.droppable}
                      dragMeta={meta}
                    >
                      {(dragHandleProps, isOver) =>
                        node.render({
                          travel: travelBefore.get(node.key),
                          dragHandle: dragHandleProps ? (
                            <Tooltip
                              title={
                                isSelected ? 'Selected — drag to move group' : 'Drag to reorder'
                              }
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
                    node.render({ travel: travelBefore.get(node.key) })
                  )}
                </RowEndsContext.Provider>
              );
            })}
          </Timeline>
        </SortableContext>
      </DayPinsContext.Provider>
    </ClockSuffixContext.Provider>
  );
});
