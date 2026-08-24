import { lazy } from 'react';

// Lazy-loaded: TripsHome (the landing route) shouldn't have to pull in
// DaysView's dnd-kit/Timeline weight or BudgetView's chart code just to
// render the trips list. TripLayout wraps its <Outlet/> in a Suspense
// boundary these all share.
export const Overview = lazy(() => import('./Overview').then((m) => ({ default: m.Overview })));
export const DaysView = lazy(() => import('./DaysView').then((m) => ({ default: m.DaysView })));
export const BudgetView = lazy(() =>
  import('./BudgetView').then((m) => ({ default: m.BudgetView })),
);
