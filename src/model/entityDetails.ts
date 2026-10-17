// The detail sheets' own lines for what an entity records beyond its booking:
// when it runs, its status, the lodging extras, its packages' costs, a
// cruise's port calls, and what a meal is included in. Pure — the sheets in
// components/detail render these. Day/location/scenario context stays in the
// day row the sheet opened from and is never restated here.
import { countLabel } from './formatting';
import { allPackages } from './packages';
import {
  activityHeadline,
  dateOnly,
  formatDateLabel,
  formatMoney,
  formatTime,
  packageTotal,
  packageUnits,
  stayNights,
  transitRouteLabel,
} from './tripModel';
import type {
  Package,
  PlanStatus,
  PortCall,
  Priority,
  Ref,
  Stay,
  Transit,
  TripData,
} from './types';

export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  planning: 'Planning',
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  high: 'High priority',
  medium: 'Medium priority',
  low: 'Low priority',
};

// "3:00pm in · 11:00am out" on one day; once the two ends fall on different
// days each gets its date: "Sat Jul 17, 3:00pm in → Sat Jul 24, 7:30am out".
export function spanLabel(
  start: string,
  end: string | null,
  words: { start: string; end: string; endMissing?: string },
): string {
  const multiDay = end !== null && dateOnly(end) !== dateOnly(start);
  const at = (iso: string) =>
    multiDay ? `${formatDateLabel(dateOnly(iso))}, ${formatTime(iso)}` : formatTime(iso);
  const tail = end ? `${at(end)} ${words.end}` : (words.endMissing ?? '');
  return `${at(start)} ${words.start}${multiDay ? ' → ' : ' · '}${tail}`;
}

// "Sat Jul 17, 3:00pm in → Sat Jul 24, 7:30am out · 7 nights".
export function stayWhenLabel(stay: Pick<Stay, 'checkInAt' | 'checkOutAt'>): string {
  const span = spanLabel(stay.checkInAt, stay.checkOutAt, { start: 'in', end: 'out' });
  const nights = stayNights(stay);
  return nights > 0 ? `${span} · ${countLabel(nights, 'night')}` : span;
}

// "8:55am depart · 10:33am arrive".
export function transitWhenLabel(
  transit: Pick<Transit, 'departsAt'> & { arrivesAt: string | null },
): string {
  // No duration: times are stored as local wall-clock times with no zone, so
  // the difference is wrong for any trip that crosses a time zone.
  return spanLabel(transit.departsAt, transit.arrivesAt, {
    start: 'depart',
    end: 'arrive',
    endMissing: 'arrival time TBD',
  });
}

// "$100.00", or for a nightly rate on a Stay "$25.00 / night · $150.00 for 6
// nights" — the same units the budget charges (packageUnits). null when unpriced.
export function packageCostLabel(pkg: Package, nights: number | null): string | null {
  // A Transit's or Activity's packages (nights null) are charged once, as in the budget.
  if (!pkg.cost || pkg.per !== 'night' || nights === null) return formatMoney(pkg.cost);
  const units = packageUnits(pkg, nights);
  return `${formatMoney(pkg.cost)} / night · ${formatMoney(packageTotal(pkg, units))} for ${countLabel(units, 'night')}`;
}

// "Sun Jul 18 · 3:00pm–8:00pm", "Mon Jul 19, 8:00pm → Tue Jul 20, 6:00am"
// for an overnight call, or whichever end was printed.
export function portCallWhenLabel(call: PortCall): string {
  const { arrivesAt, departsAt } = call;
  const day = (iso: string) => formatDateLabel(dateOnly(iso));
  if (arrivesAt && departsAt) {
    return dateOnly(arrivesAt) === dateOnly(departsAt)
      ? `${day(arrivesAt)} · ${formatTime(arrivesAt)}–${formatTime(departsAt)}`
      : `${day(arrivesAt)}, ${formatTime(arrivesAt)} → ${day(departsAt)}, ${formatTime(departsAt)}`;
  }
  if (arrivesAt) return `${day(arrivesAt)} · arrives ${formatTime(arrivesAt)}`;
  if (departsAt) return `${day(departsAt)} · leaves ${formatTime(departsAt)}`;
  return 'Times not printed';
}

// Port calls in the order the ship makes them; a call with neither time
// printed keeps its place at the end.
export function portCallsInOrder(calls: PortCall[] | null | undefined): PortCall[] {
  const key = (c: PortCall) => c.arrivesAt ?? c.departsAt;
  return [...(calls ?? [])].sort((a, b) => {
    const [ka, kb] = [key(a), key(b)];
    if (ka === kb) return 0;
    if (ka === null) return 1;
    if (kb === null) return -1;
    return ka < kb ? -1 : 1;
  });
}

// What a meal (or a meal candidate) is included in: "Included in Princess
// Premier" for a Package, "Included with <stay/activity/transit>" otherwise.
// null when it isn't included in anything, or the target no longer exists.
export function includedInLabel(
  data: Pick<TripData, 'stays' | 'transits' | 'activities'>,
  includedIn: Ref | null | undefined,
): string | null {
  if (!includedIn || !('entity' in includedIn)) return null;
  const { entity, id } = includedIn;
  if (entity === 'package') {
    const pkg = allPackages(data).find((p) => p._id === id);
    return pkg ? `Included in ${pkg.name}` : null;
  }
  const target = (() => {
    switch (entity) {
      case 'stay':
        return data.stays.find((s) => s._id === id)?.lodging?.place.label;
      case 'activity': {
        const activity = data.activities.find((a) => a._id === id);
        return activity && activityHeadline(activity);
      }
      case 'transit': {
        const transit = data.transits.find((t) => t._id === id);
        return transit && transitRouteLabel(transit);
      }
    }
  })();
  return target ? `Included with ${target}` : null;
}
