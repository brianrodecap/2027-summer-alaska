import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import { useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import { useEffect, useRef, useState } from 'react';

import { formatTravel } from '../../model/formatting';
import { withStopKind, withStopMinutes } from '../../model/routePlanner';
import { routePlaceStopMinutes } from '../../model/tripModel';
import type { Place, RoutePlaceEntry, RouteTravel } from '../../model/types';
import { materialIcon } from '../shared/materialIcon';
import { WarningBadge } from '../shared/WarningBadge';
import { ChoiceChip } from './ChoiceChip';
import { CommitField } from './CommitField';
import { PlacePickerField } from './PlacePickerField';

const AddIcon = materialIcon('add');
const CloseIcon = materialIcon('close');
const DeleteIcon = materialIcon('delete');
const DragIndicatorIcon = materialIcon('drag_indicator');
const ExpandMoreIcon = materialIcon('expand_more');

const NODE = 26;

// A round marker on the spine: a letter for an end, a number for a waypoint, nothing
// (an open ring) for a via.
function Node({ glyph, color, filled }: { glyph: string; color: string; filled?: boolean }) {
  const { palette } = useTheme();
  return (
    <Box
      sx={{
        width: NODE,
        height: NODE,
        borderRadius: '50%',
        boxSizing: 'border-box',
        display: 'grid',
        placeItems: 'center',
        fontSize: 12,
        fontWeight: 700,
        border: 3,
        borderStyle: 'solid',
        borderColor: color,
        bgcolor: filled ? color : 'background.paper',
        color: filled ? palette.getContrastText(color) : 'text.primary',
        position: 'relative',
        zIndex: 1,
      }}
    >
      {glyph}
    </Box>
  );
}

// A leg's drive time and distance, with a flag where it heads away from the end.
function LegCaption({ travel, back }: { travel: RouteTravel; back: boolean }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pl: `${NODE + 12}px`, py: 0.75 }}>
      <Typography variant="caption" color="text.secondary">
        {formatTravel(travel)}
      </Typography>
      {back && <WarningBadge title="Doubles back" />}
    </Box>
  );
}

// One end of the drive: where it starts or finishes, and the example clock time.
function EndRow({
  glyph,
  name,
  clock,
  color,
}: {
  glyph: string;
  name: string;
  clock: string;
  color: string;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <Node glyph={glyph} color={color} filled />
      <Typography variant="body1" sx={{ fontWeight: 700, flex: 1, minWidth: 0 }} noWrap>
        {name}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {clock}
      </Typography>
    </Box>
  );
}

// A variant's drive as a timeline: the start, then each place in driving order with a
// handle to drag it to a new spot (or the keyboard: focus the handle, space, arrows,
// space), then the end. The ids are positions, which is all a drop needs to say where a
// place moved from and to.
export function StopList({
  places,
  from,
  to,
  finalTravel,
  backs,
  clocks,
  disabled,
  viaAllowed,
  activeStop,
  color,
  onMove,
  onEdit,
  onRemove,
  onAdd,
}: {
  places: RoutePlaceEntry[];
  from: string;
  to: string;
  finalTravel: RouteTravel;
  // Which legs head away from the end: one for each place, then the last leg.
  backs: boolean[];
  // Example clock times: the start, each place, the end.
  clocks: { start: string; places: string[]; end: string };
  disabled: boolean;
  // The direct variant takes no vias.
  viaAllowed: boolean;
  // The place a preview is stopped at.
  activeStop: number | null;
  // The variant's map color, for the markers, the spine and the stopped row.
  color: string;
  onMove: (from: number, to: number) => void;
  onEdit: (index: number, entry: RoutePlaceEntry) => boolean | void;
  onRemove: (index: number) => void;
  onAdd: (place: Place) => void;
}) {
  // A distance threshold on the pointer sensor, as in the day list, keeps a
  // plain tap from starting a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) onMove(Number(active.id), Number(over.id));
  };
  // Waypoints are numbered in order; a via is not.
  let number = 0;
  const glyphs = places.map((p) => (p.kind === 'waypoint' ? String(++number) : ''));
  return (
    <Box>
      <Box sx={{ position: 'relative' }}>
        {/* the spine the nodes sit on, from the start to the end and no further */}
        <Box
          sx={{
            position: 'absolute',
            left: NODE / 2 - 1.5,
            top: NODE / 2,
            bottom: NODE / 2,
            width: 3,
            bgcolor: color,
            opacity: 0.5,
          }}
        />
        <EndRow glyph="A" name={from} clock={clocks.start} color={color} />
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext
            items={places.map((_, i) => String(i))}
            strategy={verticalListSortingStrategy}
          >
            {places.map((place, i) => (
              // a place that moves or goes starts over, closed, rather than lending its open panel
              <Box key={`${i}:${place.place?.id ?? ''}`}>
                <LegCaption travel={place.travel} back={backs[i]} />
                <StopRow
                  id={String(i)}
                  place={place}
                  glyph={glyphs[i]}
                  clock={clocks.places[i]}
                  disabled={disabled}
                  viaAllowed={viaAllowed}
                  active={i === activeStop}
                  color={color}
                  onEdit={(entry) => onEdit(i, entry)}
                  onRemove={() => onRemove(i)}
                />
              </Box>
            ))}
          </SortableContext>
        </DndContext>
        <LegCaption travel={finalTravel} back={backs[places.length]} />
        <EndRow glyph="B" name={to} clock={clocks.end} color={color} />
      </Box>
      <AddStop disabled={disabled} onAdd={onAdd} />
    </Box>
  );
}

function StopRow({
  id,
  place,
  glyph,
  clock,
  disabled,
  viaAllowed,
  active,
  color,
  onEdit,
  onRemove,
}: {
  id: string;
  place: RoutePlaceEntry;
  glyph: string;
  clock: string;
  disabled: boolean;
  viaAllowed: boolean;
  active: boolean;
  color: string;
  onEdit: (entry: RoutePlaceEntry) => boolean | void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const row = useRef<HTMLDivElement | null>(null);
  // A preview stopped here brings the row into view.
  useEffect(() => {
    if (active) row.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active]);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });
  const name = place.label ?? place.place?.label ?? 'Unnamed stop';
  return (
    <Box
      ref={(el: HTMLDivElement | null) => {
        row.current = el;
        setNodeRef(el);
      }}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}
    >
      <Box sx={{ pt: 1.25 }}>
        <Node glyph={glyph} color={color} />
      </Box>
      <Paper
        variant="outlined"
        sx={{
          flex: 1,
          minWidth: 0,
          opacity: isDragging ? 0.5 : 1,
          ...(active && { borderColor: color, bgcolor: 'action.selected' }),
        }}
      >
        <Box
          role="button"
          tabIndex={0}
          aria-expanded={open}
          aria-label={`${open ? 'Close' : 'Edit'} ${name}`}
          onClick={() => setOpen(!open)}
          onKeyDown={(e) => {
            // a key on the handle is the handle's, not the row's
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setOpen(!open);
            }
          }}
          sx={{ display: 'flex', alignItems: 'center', gap: 0.5, p: 0.75, cursor: 'pointer' }}
        >
          <IconButton
            size="small"
            aria-label={`Reorder ${name}`}
            disabled={disabled}
            onClick={(e) => e.stopPropagation()}
            {...attributes}
            {...listeners}
            sx={{ cursor: 'grab', touchAction: 'none' }}
          >
            <DragIndicatorIcon fontSize="small" />
          </IconButton>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 0 }} noWrap>
                {name}
              </Typography>
              <Chip
                size="small"
                variant="outlined"
                sx={{ flexShrink: 0 }}
                label={
                  place.kind === 'via' ? 'Via' : `Waypoint · ${routePlaceStopMinutes(place)} min`
                }
              />
            </Box>
            <Typography variant="caption" color="text.secondary">
              {clock}
            </Typography>
          </Box>
          <ExpandMoreIcon
            fontSize="small"
            sx={{ transform: open ? 'rotate(180deg)' : undefined, color: 'text.secondary' }}
          />
        </Box>
        <Collapse in={open} unmountOnExit>
          <Stack spacing={1.5} sx={{ p: 1.5, pt: 0.5 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <ChoiceChip
                label="Waypoint"
                selected={place.kind === 'waypoint'}
                disabled={disabled}
                onClick={() => onEdit(withStopKind(place, 'waypoint'))}
              />
              <ChoiceChip
                label="Via"
                selected={place.kind === 'via'}
                disabled={disabled || !viaAllowed}
                onClick={() => onEdit(withStopKind(place, 'via'))}
              />
              {place.kind === 'waypoint' && (
                <CommitField
                  key={place.durationMinutes ?? ''}
                  label="Minutes"
                  size="small"
                  placeholder="15"
                  disabled={disabled}
                  value={place.durationMinutes?.toString() ?? ''}
                  onCommit={(text) => onEdit(withStopMinutes(place, text))}
                  slotProps={{ htmlInput: { inputMode: 'numeric' } }}
                  sx={{ width: 96, ml: 'auto' }}
                />
              )}
            </Stack>
            <CommitField
              key={place.note ?? ''}
              label="Note"
              size="small"
              fullWidth
              disabled={disabled}
              value={place.note ?? ''}
              onCommit={(note) => onEdit({ ...place, note: note || null })}
            />
            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <IconButton
                size="small"
                aria-label={`Remove ${name}`}
                disabled={disabled}
                onClick={onRemove}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          </Stack>
        </Collapse>
      </Paper>
    </Box>
  );
}

// A waypoint added by searching for the place; it joins the end of the list, to be
// dragged where it belongs.
function AddStop({ disabled, onAdd }: { disabled: boolean; onAdd: (place: Place) => void }) {
  const [adding, setAdding] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  if (!adding) {
    return (
      <Button
        size="small"
        startIcon={<AddIcon />}
        disabled={disabled}
        onClick={() => setAdding(true)}
        sx={{ mt: 1, ml: `${NODE + 12}px` }}
      >
        Waypoint
      </Button>
    );
  }
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1, ml: `${NODE + 12}px` }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <PlacePickerField
          label="Add a waypoint"
          place={place}
          onChange={setPlace}
          onPicked={(picked) => {
            setAdding(false);
            setPlace(null);
            onAdd(picked);
          }}
        />
      </Box>
      <IconButton
        aria-label="Cancel adding a waypoint"
        onClick={() => {
          setAdding(false);
          setPlace(null);
        }}
      >
        <CloseIcon />
      </IconButton>
    </Stack>
  );
}
