// "Select this day": the rows a day's own timeline lets you select, worked out from
// the same rows and drag metadata the timeline uses, so a day's selection and
// clicking each row's handle are the same thing.
//
// A day selects its Activities and Transits and its plan groups (each as one row,
// carrying every plan's entries). Stays are left out: a check-in or check-out is a
// booking's date, and a night's stay isn't "this day's plans". Pick a stay by its own
// handle to move it.
//
// Pure, like the rest of src/model.
import { filterRows } from './filters';
import { containerDragMeta, type ReorderMembers, rowMembersOf } from './reorder';
import type { Day } from './types';

export interface SelectableRow {
  dragId: string;
  containerId: string;
  members: ReorderMembers;
  isScenarioGroup: boolean;
}

export function daySelectionRows(day: Day, activeFilterTokens: Set<string>): SelectableRow[] {
  const rows = filterRows(day.rows, day, activeFilterTokens);
  return containerDragMeta(day, rows, null).flatMap((meta) =>
    meta.source && meta.source.kind !== 'stay'
      ? [
          {
            dragId: meta.id,
            containerId: day.date,
            members: rowMembersOf(meta),
            isScenarioGroup: meta.source.kind === 'scenario-group',
          },
        ]
      : [],
  );
}

// How much of a day is selected: all of its selectable rows, some, or none.
export function daySelectionState(
  rows: SelectableRow[],
  selectedIds: { has: (dragId: string) => boolean } | null | undefined,
): 'none' | 'some' | 'all' {
  const selected = rows.filter((row) => selectedIds?.has(row.dragId)).length;
  if (!selected) return 'none';
  return selected === rows.length ? 'all' : 'some';
}
