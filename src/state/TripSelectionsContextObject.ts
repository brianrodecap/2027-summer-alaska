import { createContext } from 'react';

import type { ReorderMembers } from '../model/reorder';

// Four independent contexts rather than one combined value: with a single
// context, picking a meal option anywhere recreates one shared value object,
// which re-renders every consumer of *any* selection everywhere in the
// (unvirtualized, ~28-day) list — including DayTimeline's own top-level
// activeFilterTokens read, which forces every day to rebuild its whole node
// list. Splitting by concern means a route-tone pick only re-renders the
// handful of components that actually read route tones.

export interface ScenarioSelectionValue {
  scenarioTone: Map<string, string>; // date -> tone
  selectScenario: (date: string, tone: string) => void;
}

export interface RouteToneSelectionValue {
  routeTones: Map<string, string>; // transitId -> tone
  selectRouteTone: (transitId: string, tone: string) => void;
}

export interface MealOptionSelectionValue {
  mealOptionIndex: Map<string, number>; // activityId -> chosen option index
  selectMealOption: (activityId: string, index: number) => void;
}

export interface FilterSelectionValue {
  activeFilterTokens: Set<string>; // the day list's own filter-nav selection
  toggleFilterToken: (token: string) => void;
  clearFilterTokens: () => void;
}

// A multi-select of drag handles — a plain Activity row, a Transit's own
// Depart row, or a whole scenario-tabs bundle — that can span more than one
// rendered DayTimeline — picking a handle on one day, then another on a
// different day (or a different scenario branch), adds to the same
// selection rather than resetting it, so a group drag can move rows from
// several different days/branches at once. Each selected row's own resolved
// membership (`members`: which Activity/Transit ids it actually contributes
// — a single id for a plain Activity/Transit row, the whole bundle for a
// scenario-tabs row) is captured at selection time via `toggleRowSelection`,
// rather than re-derived at drop time — a scenario-tabs row's own DragMeta
// only exists while its owning DayTimeline is rendered, so there'd be
// nothing to look back up for a member selected on a day that isn't the one
// a later drag actually starts from. `containerId` is kept per row for the
// same reason the old Activity-only selection kept it: DaysView.tsx's
// handleDragEnd needs each member's own origin container to decide, for a
// pure-Activity group drag, whether that particular member's drop is
// crossing into a different container (see applyGroupActivityReorder in
// reorder.ts).
export type RowSelectionMembers = ReorderMembers;

export interface SelectedRow {
  containerId: string;
  members: RowSelectionMembers;
}

export interface RowSelection {
  rows: Map<string, SelectedRow>; // dragId -> selected row
}

export interface RowSelectionValue {
  selection: RowSelection | null;
  toggleRowSelection: (dragId: string, containerId: string, members: RowSelectionMembers) => void;
  clearRowSelection: () => void;
}

// Shared by DayTimeline.tsx (per-row highlight) and DaysView.tsx (deciding
// whether a drag is a group drag) so both read "is this row part of the
// active selection" the same way — selection membership no longer depends
// on which container is asking, since a selection can now span several.
export function isRowSelected(selection: RowSelection | null, dragId: string): boolean {
  return selection !== null && selection.rows.has(dragId);
}

export const ScenarioSelectionContext = createContext<ScenarioSelectionValue | null>(null);
export const RouteToneSelectionContext = createContext<RouteToneSelectionValue | null>(null);
export const MealOptionSelectionContext = createContext<MealOptionSelectionValue | null>(null);
export const FilterSelectionContext = createContext<FilterSelectionValue | null>(null);
export const RowSelectionContext = createContext<RowSelectionValue | null>(null);
