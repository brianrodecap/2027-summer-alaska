import type { Place, Route, RouteVariant } from './types';

type Ends = { from: Pick<Place, 'id'>; to: Pick<Place, 'id'> };

// The same road driven the other way: places in the opposite order, and each
// leg's stored drive time carried to the stretch it now belongs to (the
// last-to-destination leg becomes the first, and the first-from-origin leg
// the last). The same road takes about as long both ways.
export function reverseVariant(variant: RouteVariant): RouteVariant {
  const { places, finalTravel } = variant;
  if (!places.length) return variant;
  return {
    ...variant,
    places: [...places]
      .reverse()
      .map((p, j) => ({ ...p, travel: j === 0 ? finalTravel : places[places.length - j].travel })),
    finalTravel: places[0].travel,
  };
}

export function reverseRoute(route: Route): Route {
  return { ...route, from: route.to, to: route.from, variants: route.variants.map(reverseVariant) };
}

// Whether a drive runs this route backwards: it starts where the route ends and
// ends where it starts. Derived from the two places, never stored, so there is
// nothing to keep in step. An unresolved place never matches, and a route that
// returns to its start has no backwards.
export function isReverseDrive(route: Pick<Route, 'from' | 'to'>, drive: Ends): boolean {
  const { from, to } = route;
  return (
    from.id !== null &&
    to.id !== null &&
    from.id === drive.to.id &&
    to.id === drive.from.id &&
    from.id !== to.id
  );
}

// The route a drive uses: one running the same way, else one running the other
// way. Of several for one pair, the lowest id, so the choice doesn't hang on
// the order of the file.
export function routeForDrive(routes: Route[], drive: Ends): Route | null {
  const ordered = [...routes].sort((a, b) => a._id.localeCompare(b._id));
  const forward = ordered.find(
    (r) =>
      r.from.id !== null &&
      r.to.id !== null &&
      r.from.id === drive.from.id &&
      r.to.id === drive.to.id,
  );
  return forward ?? ordered.find((r) => isReverseDrive(r, drive)) ?? null;
}
