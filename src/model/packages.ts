// The one list of "which entities can hold Packages": a Stay's extra fees or
// meal plan, a Transit's or Activity's inclusions or add-ons (a tour's
// shuttle and headset). Every reader that walks packages — budget rows,
// booking progress, note targets, traveler merges — goes through here, so a
// new holder is added once.
import type { Activity, Package, Stay, Transit, TripData } from './types';

export type PackageHolder =
  | { kind: 'stay'; entity: Stay }
  | { kind: 'transit'; entity: Transit }
  | { kind: 'activity'; entity: Activity };

type PackageCollections = Pick<TripData, 'stays' | 'transits' | 'activities'>;

export function* packageHolders(data: PackageCollections): Generator<PackageHolder> {
  for (const entity of data.stays) yield { kind: 'stay', entity };
  for (const entity of data.transits) yield { kind: 'transit', entity };
  for (const entity of data.activities) yield { kind: 'activity', entity };
}

export function allPackages(data: PackageCollections): Package[] {
  return [...packageHolders(data)].flatMap((h) => h.entity.packages ?? []);
}

// `data` with fn applied to every holder's packages; a holder whose packages
// fn returns unchanged (the same array) is kept as the same object, and a
// collection with no changed holder is kept as the same array.
export function mapPackages<T extends PackageCollections>(
  data: T,
  fn: (packages: Package[]) => Package[],
): T {
  const each = <E extends Stay | Transit | Activity>(entity: E): E => {
    if (!entity.packages?.length) return entity;
    const packages = fn(entity.packages);
    return packages === entity.packages ? entity : { ...entity, packages };
  };
  const eachIn = <E extends Stay | Transit | Activity>(list: E[]): E[] => {
    const mapped = list.map(each);
    return mapped.some((e, i) => e !== list[i]) ? mapped : list;
  };
  return {
    ...data,
    stays: eachIn(data.stays),
    transits: eachIn(data.transits),
    activities: eachIn(data.activities),
  };
}
