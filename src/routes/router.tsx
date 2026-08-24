import { createHashRouter } from 'react-router-dom';

import { BudgetView, DaysView, Overview } from './lazyRoutes';
import { TripLayout } from './TripLayout';
import { TripsHome } from './TripsHome';

// A hash router, not BrowserRouter: GitHub Pages project pages have no
// server-side rewrite, so a path-based router 404s on a deep link or hard
// refresh unless a 404.html SPA-fallback hack is added. A hash router also
// maps 1:1 onto the old app's existing #/, #/<slug>, #/<slug>/days/<date>,
// #/<slug>/budget scheme, and sidesteps Vite's `base` entirely (it only
// affects the pre-hash pathname, which a hash router never touches).
export const router = createHashRouter([
  { path: '/', element: <TripsHome /> },
  {
    path: '/:slug',
    element: <TripLayout />,
    children: [
      { index: true, element: <Overview /> },
      { path: 'days', element: <DaysView /> },
      { path: 'days/:date', element: <DaysView /> },
      { path: 'budget', element: <BudgetView /> },
    ],
  },
]);
