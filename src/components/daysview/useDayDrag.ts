import {
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useState } from 'react';

import { applyGroupDragEnd, applySingleRowDragEnd, type DragMeta } from '../../model/reorder';
import type { Activity, Transit, TripData } from '../../model/types';
import type { CollectionName } from '../../state/TripDataContextObject';
import type { RowSelection } from '../../state/TripSelectionsContextObject';
import { useTripData } from '../../state/useTripData';
import { useRowSelection } from '../../state/useTripSelections';

// dnd-kit's own `data.current` is typed `unknown` — this just unwraps the
// `sortable.containerId` it stamps on every row alongside our own DragMeta
// fields (see SortableData); call sites normalize the result to
// `string | null` before handing it to reorder.ts. The same-day-vs-cross-day
// resolution that used to live here (dayOfContainer/preserveOwnTiming) has
// moved into reorder.ts's own resolveDragEndPlacement, since it's business
// logic, not dnd-kit wiring — see that function's own comment for the
// reasoning.
function containerIdOf(dndData: unknown): string | null {
  const id = (dndData as { sortable?: { containerId: unknown } } | undefined)?.sortable
    ?.containerId;
  return typeof id === 'string' ? id : null;
}

// Whether a drag of `meta` moves a real (>1) multi-select together — takes
// priority over the single-row case. Dragging some other, unselected row while
// a selection exists elsewhere is a normal single-row drag.
const movesSelection = (
  selection: RowSelection | null,
  meta: DragMeta,
): selection is RowSelection =>
  Boolean(selection && selection.rows.has(meta.id) && selection.rows.size > 1);

// The DragOverlay's own "N items" chip count — a multi-select of more
// than one row (of any kind: a plain Activity, a Transit's Depart row, or
// a whole scenario box; see RowSelectionValue) takes priority
// when active (selection is untouched for the whole drag, only cleared
// once handleDragEnd's group branch commits, so this can be derived
// straight from current state rather than snapshotted at drag-start);
// otherwise a lone scenario box drag shows its own bundle size.
// meta.source is a tagged union naming exactly one kind, so
// falling back to its 'scenario-group' case here never masks a single
// Activity/Transit drag.
function dragItemCount(meta: DragMeta | null, selection: RowSelection | null): number | null {
  if (meta?.id && movesSelection(selection, meta)) return selection.rows.size;
  if (meta?.source?.kind === 'scenario-group') {
    return meta.source.members.activityIds.length + meta.source.members.transitIds.length;
  }
  return null;
}

// What the drag overlay shows: a multi-row count, a single Activity, or a
// single Transit.
export interface DragOverlayModel {
  itemCount: number | null;
  activity: Activity | null;
  transit: Transit | null;
}

// What the overlay shows for the drag in flight (nothing, when none).
function overlayFor(
  meta: DragMeta | null,
  selection: RowSelection | null,
  data: TripData | null,
): DragOverlayModel {
  const source = meta?.source ?? null;
  const entity = <T extends { _id: string }>(list: T[] | undefined, id: string) =>
    list?.find((item) => item._id === id) ?? null;
  return {
    itemCount: dragItemCount(meta, selection),
    activity: source?.kind === 'activity' ? entity(data?.activities, source.id) : null,
    transit: source?.kind === 'transit' ? entity(data?.transits, source.id) : null,
  };
}

// Reordering — see src/model/reorder.ts. Owns the sensors, the in-flight drag,
// and the start/end handlers; DayListDnd wires them into a DndContext.
export function useDayDrag() {
  const { data, setData } = useTripData();
  const { selection, clearRowSelection } = useRowSelection();
  // A distance threshold on the pointer sensor is what lets a plain tap still
  // open a row's detail sheet instead of every click starting a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [draggingMeta, setDraggingMeta] = useState<DragMeta | null>(null);
  const overlay = overlayFor(draggingMeta, selection, data);

  const handleDragStart = (event: DragStartEvent) => {
    setDraggingMeta((event.active.data.current as DragMeta | undefined) ?? null);
  };

  const commit = (result: { data: NonNullable<typeof data>; collections: string[] }) =>
    setData(() => result.data, result.collections as CollectionName[]);

  // A thin dispatcher — the actual drag/direction/timing resolution
  // (movingUp, preserveOwnTiming, dropMeta) and the dispatch onto the right
  // applyXReorder live in reorder.ts's own applySingleRowDragEnd/
  // applyGroupDragEnd (see their own comments for the Homer-Spit/same-day-
  // vs-cross-day reasoning); this just unwraps dnd-kit's event, decides
  // single-row vs. multi-select, and commits the result via setData.
  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingMeta(null);
    const { active, over } = event;
    if (!over || active.id === over.id || !data) return;
    const activeMeta = active.data.current as DragMeta | undefined;
    const overMeta = over.data.current as DragMeta | undefined;
    if (!activeMeta || !overMeta) return;
    const activeContainerId = containerIdOf(active.data.current);
    const overContainerId = containerIdOf(over.data.current);

    if (movesSelection(selection, activeMeta)) {
      const rows = [...selection.rows.values()];
      commit(
        applyGroupDragEnd(data, activeMeta, overMeta, activeContainerId, overContainerId, rows),
      );
      clearRowSelection();
      return;
    }
    const result = applySingleRowDragEnd(
      data,
      activeMeta,
      overMeta,
      activeContainerId,
      overContainerId,
    );
    if (result) commit(result);
  };

  return { sensors, overlay, handleDragStart, handleDragEnd };
}
