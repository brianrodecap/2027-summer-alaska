// AI-assisted document import: reads an uploaded booking document (PDF or photo) via
// the Anthropic API, called directly from the browser with a user-supplied key (see
// src/config/aiKey.ts for why this key is never hardcoded like config/places.ts's Google
// key). Modeled on src/model/places.ts's style — a bare fetch() against the REST API, no
// SDK dependency.
import { type AnthropicTool, callAnthropicMessages } from './anthropicClient';
import {
  blankActivity,
  blankStay,
  blankTransit,
  DINING_FORMATS_WITH_INCLUDED_IN,
  type EditKind,
} from './editForms';
import { DINING_FORMAT_LABEL } from './formatting';
import { wallClockMs } from './tripModel';
import type { Activity, Booking, Day, DiningFormat, MealType, Stay, Transit } from './types';

// The only DiningFormat values the AI is allowed to set — the ones that don't
// require an includedIn Ref pointing at a specific existing Stay/Package/
// Activity/Transit, which the model can't see and would otherwise have to
// invent (same reasoning as placeLabel/lodgingName never carrying an id) —
// a human still picks those via IncludedInField in the review form. Derived
// from DINING_FORMATS_WITH_INCLUDED_IN (editForms.ts), the same partition
// ActivityEditForm and MealOptionList already gate on, rather than a second
// hand-maintained list that could drift if a DiningFormat value is ever added.
export const EXTRACTABLE_DINING_FORMATS: DiningFormat[] = (
  Object.keys(DINING_FORMAT_LABEL) as DiningFormat[]
).filter((format) => !DINING_FORMATS_WITH_INCLUDED_IN.includes(format));

const SUPPORTED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'] as const;
type SupportedType = (typeof SUPPORTED_TYPES)[number];

export class DocumentImportError extends Error {}

// ---------- 1. File -> base64 ----------

export async function fileToBase64(file: File): Promise<string> {
  if (!SUPPORTED_TYPES.includes(file.type as SupportedType)) {
    throw new DocumentImportError(
      `Unsupported file type: ${file.type || 'unknown'} — please use PDF, PNG, JPEG, or WebP.`,
    );
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new DocumentImportError('Could not read the file.'));
    reader.readAsDataURL(file);
  });
  const comma = dataUrl.indexOf(',');
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}

// ---------- 2. Forced tool-call extraction ----------

// Flat across all three kinds rather than a nested union — the mapping layer below
// (draftEntityFromExtraction) picks only the fields relevant to fields.kind. placeLabel
// and lodgingName are plain text ONLY: there's no id/placeId property in this schema, so
// the model can't invent a Google Place ID — a human still resolves the real place via
// the existing PlacePickerField in the review form, exactly like any manual add today.
export interface ExtractedFields {
  kind: EditKind;
  text?: string; // activity description
  lodgingName?: string; // stay
  fromLabel?: string; // transit
  toLabel?: string; // transit
  placeLabel?: string; // activity place, as free text
  startAt?: string; // ISO date-time — activity start / transit departure
  endAt?: string; // ISO date-time — activity end / transit arrival
  checkInAt?: string; // stay
  checkOutAt?: string; // stay
  mode?: string; // transit: 'drive' | 'flight' | 'ferry' | ...
  carrier?: string;
  flightNumber?: string;
  bookingStatus?: 'planning' | 'booked' | 'cancelled';
  confirmationNumber?: string;
  costAmount?: number;
  costCurrency?: string;
  mealType?: MealType; // activity: set only when this document is a meal/dining booking
  diningFormat?: DiningFormat; // activity: one of EXTRACTABLE_DINING_FORMATS only
}

// Shared by both the single-entity tool (below) and the multi-entity one
// (see extractTripEntitiesFromDocument) — one document-derived entry's shape
// either way, just extracted one-at-a-time vs. all-at-once.
export const ENTITY_SCHEMA = {
  type: 'object',
  properties: {
    kind: {
      type: 'string',
      enum: ['activity', 'stay', 'transit'],
      description: 'Which kind of trip entry this describes.',
    },
    text: { type: 'string', description: 'Short description, for an activity.' },
    lodgingName: { type: 'string', description: 'Hotel/lodging name, for a stay.' },
    fromLabel: { type: 'string', description: 'Departure place name, for a transit.' },
    toLabel: { type: 'string', description: 'Arrival place name, for a transit.' },
    placeLabel: { type: 'string', description: 'Place name, for an activity.' },
    startAt: { type: 'string', description: 'ISO 8601 local date-time, e.g. 2027-06-14T09:30.' },
    endAt: { type: 'string', description: 'ISO 8601 local date-time.' },
    checkInAt: { type: 'string', description: 'ISO 8601 local date-time, for a stay.' },
    checkOutAt: { type: 'string', description: 'ISO 8601 local date-time, for a stay.' },
    mode: { type: 'string', description: "Transit mode, e.g. 'drive', 'flight', 'ferry'." },
    carrier: { type: 'string' },
    flightNumber: { type: 'string' },
    bookingStatus: { type: 'string', enum: ['planning', 'booked', 'cancelled'] },
    confirmationNumber: { type: 'string' },
    costAmount: { type: 'number' },
    costCurrency: { type: 'string', description: "ISO 4217 currency code, e.g. 'USD'." },
    mealType: {
      type: 'string',
      enum: ['breakfast', 'lunch', 'dinner', 'snack'],
      description:
        'Only for an activity that is a meal/dining booking, e.g. a restaurant reservation.',
    },
    diningFormat: {
      type: 'string',
      enum: EXTRACTABLE_DINING_FORMATS,
      description:
        "Only for an activity that is a meal/dining booking. Never 'included', 'package', 'included-with-activity', or 'included-with-transit' — those require linking to an existing entity a human must pick, so omit diningFormat instead if the document says the meal is included/covered by something else.",
    },
  },
  required: ['kind'],
};

const RECORD_ENTITY_TOOL = {
  name: 'record_entity',
  description: 'Record the booking/activity details extracted from the uploaded document.',
  input_schema: ENTITY_SCHEMA,
};

const EXTRACTION_INSTRUCTIONS =
  'Extract the booking/itinerary details from this document into the record_entity tool. ' +
  'Use the field names exactly as given and omit any field you cannot determine from the document — do not guess. ' +
  'placeLabel and lodgingName must be plain text only; never invent an id. ' +
  'If this document is a meal/restaurant reservation or dining booking, also set mealType and, if the format is clear, diningFormat.';

async function callExtractionTool(
  file: File,
  apiKey: string,
  tool: AnthropicTool,
  instructions: string,
): Promise<unknown> {
  const data = await fileToBase64(file);
  const mediaBlock =
    file.type === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: file.type, data } }
      : { type: 'image', source: { type: 'base64', media_type: file.type, data } };

  const body = await callAnthropicMessages(
    {
      max_tokens: 4096,
      thinking: { type: 'disabled' },
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
      messages: [{ role: 'user', content: [mediaBlock, { type: 'text', text: instructions }] }],
    },
    apiKey,
    (message) => new DocumentImportError(message),
    'Claude declined to process this document.',
  );
  const toolUse = body.content.find(
    (block) => block.type === 'tool_use' && block.name === tool.name,
  );
  if (!toolUse) {
    throw new DocumentImportError('Claude did not return a structured result for this document.');
  }
  return toolUse.input;
}

export async function extractEntityFromDocument(
  file: File,
  apiKey: string,
): Promise<ExtractedFields> {
  return (await callExtractionTool(
    file,
    apiKey,
    RECORD_ENTITY_TOOL,
    EXTRACTION_INSTRUCTIONS,
  )) as ExtractedFields;
}

// ---------- 2b. Whole-trip extraction — Add Trip's "start from a document" ----------
//
// The per-day import above (extractEntityFromDocument) always yields exactly one
// entity, because it's attaching to an already-known day. Add Trip has no day yet —
// the document IS what determines the trip's shape — so a single booking document
// (a round-trip flight confirmation, a cruise confirmation) needs to become however
// many entities it actually describes: two Transits for a round trip, one Stay for a
// cruise cabin, etc. A suggested trip name comes along for the same call rather than
// a second document read.

export interface TripExtraction {
  tripName?: string;
  tripSummary?: string;
  entities: ExtractedFields[];
}

const RECORD_TRIP_TOOL = {
  name: 'record_trip_entities',
  description:
    'Record every distinct booking/itinerary entry found in this document, plus a short suggested trip name and summary.',
  input_schema: {
    type: 'object',
    properties: {
      tripName: {
        type: 'string',
        description:
          'A short suggested name for the whole trip, e.g. "Alaska Cruise" or "Tokyo Flights".',
      },
      tripSummary: {
        type: 'string',
        description:
          'A one or two sentence suggested summary of the trip, e.g. what it is and its overall span — for display under the trip name.',
      },
      entities: {
        type: 'array',
        items: ENTITY_SCHEMA,
        description: 'One entry per distinct booking segment.',
      },
    },
    required: ['entities'],
  },
};

const TRIP_EXTRACTION_INSTRUCTIONS =
  'Extract every distinct booking/itinerary entry from this document into the record_trip_entities tool, plus a short suggested trip name and a ' +
  'one or two sentence suggested trip summary. ' +
  'A round-trip flight confirmation is two transit entries, one for the outbound flight and one for the return. ' +
  'A cruise confirmation is usually one stay entry for the cabin. ' +
  'Use the field names exactly as given and omit any field you cannot determine from the document — do not guess. ' +
  'placeLabel and lodgingName must be plain text only; never invent an id. ' +
  'For any entry that is a meal/restaurant reservation or dining booking, also set mealType and, if the format is clear, diningFormat.';

export async function extractTripEntitiesFromDocument(
  file: File,
  apiKey: string,
): Promise<TripExtraction> {
  const result = (await callExtractionTool(
    file,
    apiKey,
    RECORD_TRIP_TOOL,
    TRIP_EXTRACTION_INSTRUCTIONS,
  )) as TripExtraction;
  if (!result.entities?.length) {
    throw new DocumentImportError('Could not find any booking details in that document.');
  }
  return result;
}

// The default Leg an Add-Trip-from-a-document flow creates needs a real date
// range before any of these entities can be drafted onto it — pulled from
// whichever date-ish field each raw extraction actually carries, since
// draftEntityFromExtraction hasn't turned them into real entities yet.
export function dateRangeFromExtractedEntities(
  entities: ExtractedFields[],
): { startDate: string; endDate: string } | null {
  const dates = entities
    .flatMap((f) => [f.startAt, f.endAt, f.checkInAt, f.checkOutAt])
    .filter((v): v is string => Boolean(v))
    .map((v) => v.slice(0, 10));
  if (!dates.length) return null;
  return {
    startDate: dates.reduce((a, b) => (a < b ? a : b)),
    endDate: dates.reduce((a, b) => (a > b ? a : b)),
  };
}

// What a multi-entity extraction becomes once every ExtractedFields is
// turned into a real entity (draftEntityFromExtraction) and sorted back out
// by kind — the shape TripEditDialog hands to TripsHome, and TripsHome hands
// straight to exportNewTrip as that new trip's stays/transits/activities.json.
export interface StagedTripEntities {
  activities: Activity[];
  stays: Stay[];
  transits: Transit[];
}

export function draftTripEntities(
  entities: ExtractedFields[],
  legId: string,
  date: string,
): StagedTripEntities {
  const staged: StagedTripEntities = { activities: [], stays: [], transits: [] };
  for (const fields of entities) {
    const entity = draftEntityFromExtraction(fields, legId, date);
    if (fields.kind === 'stay') staged.stays.push(entity as Stay);
    else if (fields.kind === 'transit') staged.transits.push(entity as Transit);
    else staged.activities.push(entity as Activity);
  }
  return staged;
}

// Resolves which day (and therefore which Leg) a single extracted entity belongs on,
// for the trip-wide "Import document" flow (AI menu, App Bar) — unlike the old per-day
// "Add to this day" entry point, there's no day already in hand here, so the document's
// own extracted date is what has to carry that instead. Tries every date-ish field in
// the order a document is likely to give a meaningful one; returns null if none of them
// landed on a real day of the trip (nothing extracted, or a date outside its range),
// leaving the caller to surface that as an error rather than guess.
export function resolveLegAndDateForFields(
  fields: ExtractedFields,
  days: Day[],
): { legId: string; date: string } | null {
  const candidates = [fields.startAt, fields.checkInAt, fields.endAt, fields.checkOutAt].filter(
    (v): v is string => Boolean(v),
  );
  for (const candidate of candidates) {
    const date = candidate.slice(0, 10);
    const day = days.find((d) => d.date === date);
    if (day) return { legId: day.leg._id, date: day.date };
  }
  return null;
}

// ---------- 3. Overlay onto a blank entity ----------

function moneyFrom(fields: ExtractedFields): { amount: number; currency: string } | null {
  return fields.costAmount != null
    ? { amount: fields.costAmount, currency: fields.costCurrency ?? 'USD' }
    : null;
}

// Shared by draftEntityFromExtraction (below, `base` omitted — nothing to fall back to on a
// brand-new entity) and askAI.ts's draftEntityFromProposal (`base` is the real entity's
// existing booking, so a field the AI didn't mention survives instead of being reset).
export function mergeBooking(fields: ExtractedFields, base: Booking | null = null): Booking | null {
  if (!fields.bookingStatus && !fields.confirmationNumber && fields.costAmount == null) {
    return base;
  }
  return {
    status: fields.bookingStatus ?? base?.status ?? 'booked',
    cost: fields.costAmount != null ? moneyFrom(fields) : (base?.cost ?? null),
    confirmationNumber: fields.confirmationNumber ?? base?.confirmationNumber ?? null,
  };
}

export function draftEntityFromExtraction(
  fields: ExtractedFields,
  legId: string,
  date: string,
): Activity | Stay | Transit {
  const booking = mergeBooking(fields);

  if (fields.kind === 'stay') {
    const stay = blankStay(legId, date);
    if (fields.checkInAt) stay.checkInAt = fields.checkInAt;
    if (fields.checkOutAt) stay.checkOutAt = fields.checkOutAt;
    if (stay.lodging) {
      stay.lodging.name = fields.lodgingName ?? stay.lodging.name;
      stay.lodging.placeId = null;
    }
    stay.booking = booking;
    return stay;
  }

  if (fields.kind === 'transit') {
    const transit = blankTransit(legId, date);
    if (fields.startAt) transit.departsAt = fields.startAt;
    if (fields.endAt) transit.arrivesAt = fields.endAt;
    transit.from = { id: null, label: fields.fromLabel ?? transit.from.label };
    transit.to = { id: null, label: fields.toLabel ?? transit.to.label };
    if (fields.mode) transit.mode = fields.mode;
    transit.carrier = fields.carrier;
    transit.flightNumber = fields.flightNumber;
    transit.booking = booking;
    return transit;
  }

  const activity = blankActivity(legId, date);
  if (fields.startAt) activity.startAt = fields.startAt;
  // The AI still extracts a natural endAt from the document text — derive
  // durationMinutes from it locally (rounded to the dropdown's finest
  // granularity) rather than teaching the extraction schema a new shape.
  if (fields.startAt && fields.endAt) {
    const minutes =
      Math.round((wallClockMs(fields.endAt) - wallClockMs(fields.startAt)) / 60000 / 15) * 15;
    activity.durationMinutes = minutes > 0 ? minutes : null;
  }
  activity.text = fields.text ?? '';
  activity.place = fields.placeLabel ? { id: null, label: fields.placeLabel } : null;
  activity.booking = booking;
  activity.mealType = fields.mealType ?? null;
  activity.diningFormat = fields.diningFormat ?? null;
  return activity;
}

// ---------- 4. Conflict detection ----------
//
// Given a freshly-extracted draft (e.g. a booked Stay) and the trip's existing entities
// of that same kind, decide whether this draft is replacing something already on the
// itinerary — an overlapping still-`status: 'planning'` entry, say — or is a genuinely
// new addition, and return that existing entity's `_id` (so the import flow opens it as
// an override) or `null` (so it's added as new). There's no single right answer here:
// exact date-range overlap vs. fuzzy, whether to require the same leg, whether the
// existing side must be `'planning'`, whether to auto-decide vs. just narrow candidates
// for a human to pick from. `draft` always carries its own `legId`, so leg-scoping can
// happen in here without changing the signature.
export function findConflictCandidate(
  _kind: EditKind,
  _draft: Activity | Stay | Transit,
  _existingOfSameKind: (Activity | Stay | Transit)[],
): string | null {
  return null;
}
