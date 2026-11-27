import { dotted } from './formatting';
import type { SeatAssignment } from './types';

// Who an expanded card lists. Travelers with details of their own (seats) always
// show. Otherwise they show only when some of the party is going: listing everyone
// says nothing.

export interface CardTraveler {
  name: string;
  detail: string | null; // "22A · Main Cabin"
}

const firstName = (name: string) => name.split(' ')[0];

// A traveler's name by id; an id the trip doesn't know shows as it is.
export const travelerName = (names: ReadonlyMap<string, string>, id: string) => names.get(id) ?? id;

const seatLabel = ({ seat, cabin, fareClass }: SeatAssignment) =>
  dotted([seat, cabin && `${cabin}${fareClass ? ` (${fareClass})` : ''}`, !cabin && fareClass]);

// `going` is the names of those going, or null when the whole party is; `names` is
// every traveler's name by id, in the trip's order. A seat is listed even for
// someone `going` leaves out. Null when there is nothing worth listing.
export function cardTravelers({
  going,
  seats,
  names,
}: {
  going: readonly string[] | null | undefined;
  seats?: readonly SeatAssignment[];
  names: ReadonlyMap<string, string>;
}): CardTraveler[] | null {
  const party = [...names.values()];
  const aboard = going?.length ? going : party;
  if (seats?.length) {
    const bySeat = new Map(
      seats.map((s) => [travelerName(names, s.travelerId), seatLabel(s)] as const),
    );
    return [...new Set([...aboard, ...bySeat.keys()])].map((name) => ({
      name: firstName(name),
      detail: bySeat.get(name) ?? null,
    }));
  }
  const isSubset = Boolean(going?.length) && party.some((name) => !aboard.includes(name));
  return isSubset ? aboard.map((name) => ({ name: firstName(name), detail: null })) : null;
}
