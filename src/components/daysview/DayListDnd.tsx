import {
  closestCenter,
  type CollisionDetection,
  DndContext,
  DragOverlay,
  pointerWithin,
} from '@dnd-kit/core';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

import type { DragMeta } from '../../model/reorder';
import { activityHeadline, formatTime, transitRouteLabel } from '../../model/tripModel';
import { type DragOverlayModel, useDayDrag } from './useDayDrag';

// The shared chrome every DragOverlay body below renders — only the
// content (a plain label, or an Activity's text + time) actually varies
// per drag kind.
function DragOverlayChip({ children }: { children: ReactNode }) {
  return (
    <Paper elevation={3} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1 }}>
      <DragIndicatorIcon fontSize="small" color="action" />
      {children}
    </Paper>
  );
}

function DragOverlayBody({ overlay }: { overlay: DragOverlayModel }) {
  const { itemCount, activity, transit } = overlay;
  if (itemCount !== null) {
    return (
      <DragOverlayChip>
        <Typography variant="subtitle2">{itemCount} items</Typography>
      </DragOverlayChip>
    );
  }
  if (activity) {
    return (
      <DragOverlayChip>
        <Box>
          <Typography variant="subtitle2">{activityHeadline(activity)}</Typography>
          {activity.startAt && (
            <Typography variant="caption" color="text.secondary">
              {formatTime(activity.startAt)}
            </Typography>
          )}
        </Box>
      </DragOverlayChip>
    );
  }
  if (transit) {
    return (
      <DragOverlayChip>
        <Typography variant="subtitle2">{transitRouteLabel(transit)}</Typography>
      </DragOverlayChip>
    );
  }
  return null;
}

// What a drag is over. A plan section is taller than the screen, so its own middle
// says little about where the reader is aiming: it goes by what is under the
// pointer, which over its own rows, or a gap, drops it nowhere. A row goes by the
// nearest row.
const collisionDetection: CollisionDetection = (args) => {
  const dragged = args.active.data.current as DragMeta | undefined;
  return dragged?.source?.kind === 'scenario-group' ? pointerWithin(args) : closestCenter(args);
};

// Wraps the day list in its drag-and-drop context: sensors, the overlay chip,
// and the reorder handlers (see useDayDrag).
export function DayListDnd({ children }: { children: ReactNode }) {
  const { sensors, overlay, handleDragStart, handleDragEnd } = useDayDrag();
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {children}
      <DragOverlay>
        <DragOverlayBody overlay={overlay} />
      </DragOverlay>
    </DndContext>
  );
}
