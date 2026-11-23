// The assistant's "move to another day" proposal: whole entries (activities, drives,
// stays, a plan group, a whole day) moved onto one target date and leg. It is the same
// move the Move action makes, through the same applyMoveToDay, so the rules (what is
// refused, what time of day is kept, what happens to plans, titles and notes) cannot
// differ between the two. Like the other proposals it only queues for the user to review.
import type { BetaTool } from '@anthropic-ai/sdk/resources/beta/messages/messages';

import { ToolInputError } from './askAITools';
import { applyMoveToDay, movedFrom, type MoveMembers, moveNotes, wholeDays } from './moveToDay';
import type { TripData } from './types';

export interface ProposedMove {
  summary: string;
  date: string;
  legId: string;
  // Each one is a line the user can keep or drop.
  moves: MoveMembers[];
}

const ids = {
  type: 'array',
  items: { type: 'string' },
} as const;

export const PROPOSE_MOVE_PROPERTIES = {
  summary: {
    type: 'string',
    description: 'One short sentence describing the move, shown to the user for review.',
  },
  date: {
    type: 'string',
    description:
      'ISO date (YYYY-MM-DD) everything moves to. Any date is allowed, including one outside the trip.',
  },
  legId: { type: 'string', description: 'The _id of the Leg the moved entries join on that date.' },
  moves: {
    type: 'array',
    description:
      'Groups of entries to move, each one a line the user can keep or drop. Each entry keeps its time ' +
      'of day, and a drive or stay keeps its length.',
    items: {
      type: 'object',
      properties: {
        activityIds: { ...ids, description: 'Ids of Activities to move.' },
        transitIds: { ...ids, description: 'Ids of Transits to move.' },
        stayIds: { ...ids, description: 'Ids of Stays to move.' },
        groupFrom: {
          type: 'string',
          description:
            'Set to the date a weather-plan group sits on when these entries are that whole group ' +
            '(every plan on the date): they keep their plans and offsets. Omit for entries moved on their own.',
        },
        wholeDay: {
          type: 'string',
          description:
            'Set to a date when these entries are everything movable on it: the date’s written title and ' +
            'date notes move too.',
        },
      },
    },
  },
} as const;

export const PROPOSE_MOVE_TOOL: BetaTool = {
  name: 'propose_move',
  description:
    'Propose moving existing entries to another day — activities, drives, stays, a plan group or a whole day — ' +
    'each keeping its time of day. Use it instead of propose_edit or propose_day_plan whenever the entries ' +
    'themselves move and should keep everything else about them. The user reviews and applies it.',
  input_schema: {
    type: 'object',
    properties: PROPOSE_MOVE_PROPERTIES,
    required: ['summary', 'date', 'legId', 'moves'],
  },
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const idList = (value: unknown, field: string): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((id) => typeof id === 'string')) {
    throw new ToolInputError(`"${field}" must be a list of ids.`);
  }
  return value;
};

const optionalString = (value: unknown, field: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new ToolInputError(`"${field}" must be a date string.`);
  return value;
};

// The model's input, checked before anything reads it. Everything that can be wrong is
// reported in one error so the model can fix it in one go: the shape, ids that are not
// in the trip, and what applying it would refuse (applyMoveToDay).
export function parseMove(input: unknown, data: TripData): ProposedMove {
  const raw = isObject(input) ? input : {};
  if (typeof raw.summary !== 'string' || !raw.summary) {
    throw new ToolInputError('"summary" is required.');
  }
  if (typeof raw.date !== 'string' || typeof raw.legId !== 'string') {
    throw new ToolInputError('"date" and "legId" are required.');
  }
  if (!Array.isArray(raw.moves) || !raw.moves.every(isObject)) {
    throw new ToolInputError('"moves" must be a list of objects.');
  }
  const moves: MoveMembers[] = raw.moves.map((move) => ({
    activityIds: idList(move.activityIds, 'activityIds'),
    transitIds: idList(move.transitIds, 'transitIds'),
    stayIds: idList(move.stayIds, 'stayIds'),
    groupFrom: optionalString(move.groupFrom, 'groupFrom'),
    wholeDay: optionalString(move.wholeDay, 'wholeDay'),
  }));
  const known = {
    activityIds: new Set(data.activities.map((a) => a._id)),
    transitIds: new Set(data.transits.map((t) => t._id)),
    stayIds: new Set(data.stays.map((s) => s._id)),
  };
  const unknown = moves.flatMap((move) =>
    (['activityIds', 'transitIds', 'stayIds'] as const).flatMap((key) =>
      move[key].filter((id) => !known[key].has(id)),
    ),
  );
  if (unknown.length) {
    throw new ToolInputError(`Not in this trip: ${[...new Set(unknown)].join(', ')}.`);
  }
  const result = applyMoveToDay(data, moves, { date: raw.date, legId: raw.legId });
  if ('error' in result) throw new ToolInputError(result.error);
  return { summary: raw.summary, date: raw.date, legId: raw.legId, moves };
}

// Applies the kept lines through the same move the Move action makes.
export function applyMoveProposal(
  proposal: ProposedMove,
  data: TripData,
  kept: ReadonlySet<number>,
): { data: TripData } | { error: string } {
  const moves = proposal.moves.filter((_, index) => kept.has(index));
  return applyMoveToDay(data, moves, { date: proposal.date, legId: proposal.legId });
}

// What each line moves, in the reader's terms, and where it goes; anything worth
// knowing first (a booked entry, a plan left behind) follows the line.
export function describeMove(proposal: ProposedMove, data: TripData): string[] {
  const names = (move: MoveMembers) => [
    ...move.activityIds.map((id) => data.activities.find((a) => a._id === id)?.text ?? id),
    ...move.transitIds.map((id) => {
      const t = data.transits.find((x) => x._id === id);
      return t ? `${t.from.label ?? '?'} → ${t.to.label ?? '?'}` : id;
    }),
    ...move.stayIds.map((id) => {
      const s = data.stays.find((x) => x._id === id);
      return s?.lodging?.place?.label ?? 'Stay';
    }),
  ];
  return proposal.moves.map((move) => {
    const from = movedFrom(data, [move])?.date;
    const days = from ? wholeDays(from, proposal.date) : null;
    const shift = days === null || move.groupFrom ? '' : ` (${days >= 0 ? '+' : ''}${days} days)`;
    const notes = moveNotes(data, [move]);
    return `Move ${names(move).join(', ')} to ${proposal.date}${shift}${notes.length ? ` — ${notes.join(' ')}` : ''}`;
  });
}
