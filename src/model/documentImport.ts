// AI-assisted document import: reads an uploaded booking document (PDF or photo) via
// the Anthropic API, called directly from the browser with a user-supplied key (see
// src/config/aiKey.ts for why this key is never hardcoded like config/places.ts's Google
// key). Modeled on src/model/places.ts's style — a bare fetch() against the REST API, no
// SDK dependency.
import { type AnthropicTool, callAnthropicMessages, findToolUse } from './anthropicClient';
import {
  blankActivity,
  blankPackage,
  blankStay,
  blankTransit,
  DINING_FORMATS_WITH_INCLUDED_IN,
  type EditKind,
} from './editForms';
import { DINING_FORMAT_LABEL } from './formatting';
import { fetchFirstPlaceImage, isPlacesApiKeyConfigured, searchPlaces } from './places';
import { dateOnly, wallClockMs } from './tripModel';
import type {
  Activity,
  Booking,
  Day,
  DiningFormat,
  MealType,
  NoteKind,
  Place,
  Ref,
  Stay,
  Transit,
} from './types';

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
// One named fee due separately from the main booked cost (a resort fee, a
// parking fee, a pet fee — anything with its own name and amount that isn't
// already folded into costAmount) — becomes its own Package on the drafted
// Stay (see draftEntityFromExtraction) so it's counted in the Budget view
// like any other cost, not just mentioned in passing.
export interface ExtractedFee {
  name: string;
  amount: number;
  currency?: string;
}

// A short risk/policy callout worth surfacing as its own Note once the
// primary entity is drafted (a cancellation policy, an occupancy limit, an
// access constraint) — see notesFromExtraction, which turns each of these
// into a real Note concerning whatever entity this extraction produces.
export interface ExtractedNote {
  kind: NoteKind;
  text: string;
}

// A round-trip shuttle/transfer bundled into a stay's own rate, between a
// fixed meeting point and the property — common for remote lodges with no
// direct vehicle access (Kennicott Glacier Lodge's own McCarthy-footbridge
// shuttle is the case this was built for: no vehicle access to the lodge
// itself, so guests park at the footbridge and ride the lodge's own shuttle
// each way). See draftIncludedTransfers, which turns each of these into two
// real Transit drafts (one arriving at check-in, one departing at
// check-out) plus a Package on the Stay documenting it as already paid for.
export interface ExtractedTransfer {
  transferPointLabel: string;
  mode?: string; // e.g. 'shuttle', 'ferry' — defaults to 'shuttle'
  // Callouts specific to this transfer, not the stay as a whole — a fixed
  // pickup schedule, an after-hours fee, or (when the document describes
  // more than one way to reach the meeting point — Kennicott's own "Arriving
  // by Car" / "Arriving by Shuttle Van" / "Arriving by Plane", each meeting
  // the lodge shuttle at a different point) an explicit prompt asking the
  // traveler to confirm which applies. See notesFromIncludedTransfers, which
  // attaches each of these to both of this transfer's own Transit drafts.
  notes?: ExtractedNote[];
}

export interface ExtractedFields {
  kind: EditKind;
  text?: string; // activity description
  lodgingName?: string; // stay
  fromLabel?: string; // transit
  toLabel?: string; // transit
  placeLabel?: string; // activity place, as free text
  phone?: string; // the primary place's own contact number, if given
  email?: string; // the primary place's own contact email, if given
  website?: string; // the primary place's own website, if given
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
  bookedThrough?: string; // the travel agent/OTA the booking went through, if not direct
  roomType?: string; // stay
  bedConfiguration?: string; // stay, e.g. '2 Queen + 1 Rollaway'
  mealType?: MealType; // activity: set only when this document is a meal/dining booking
  diningFormat?: DiningFormat; // activity: one of EXTRACTABLE_DINING_FORMATS only
  extraFees?: ExtractedFee[]; // stay: fees due separately from costAmount
  noteworthy?: ExtractedNote[]; // any kind: cancellation terms, occupancy limits, access constraints, ...
  includedTransfers?: ExtractedTransfer[]; // stay: round-trip shuttle/transfer bundled into the rate
  includedPerks?: string[]; // stay: named benefits already covered by the rate, e.g. 'Breakfast buffet'
}

// Shared by ENTITY_SCHEMA's own top-level `noteworthy` and each
// includedTransfers entry's `notes` — same shape, same kind guidance,
// either way just attached to a different entity once drafted (see
// notesFromExtraction / notesFromIncludedTransfers).
const NOTE_ARRAY_SCHEMA = (subject: string) => ({
  type: 'array',
  description: `Short risk/policy callouts worth flagging to a traveler, about ${subject}. Each becomes its own note. Don't restate routine boilerplate (standard ID/check-in requirements, generic safety disclaimers) — only genuinely actionable or risky terms, or a genuine ambiguity the traveler needs to resolve (see includedTransfers' own note on arrival-mode choices).`,
  items: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        enum: ['warning', 'info', 'footnote'],
        description:
          "'warning' for a real financial or logistical risk (nonrefundable, a steep cancellation fee, an access constraint); 'info' for a useful but lower-stakes heads-up (an extra fee due at the property, a reservation requirement, a choice the traveler needs to make); 'footnote' for minor color.",
      },
      text: { type: 'string' },
    },
    required: ['kind', 'text'],
  },
});

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
    phone: {
      type: 'string',
      description:
        "The primary place's own contact phone number, if the document gives one — check near the property/carrier's name and address even on a plain booking confirmation, not just on a dedicated contact page. Don't confuse this with a booking site's own support number.",
    },
    email: {
      type: 'string',
      description:
        "The primary place's own contact email address, if the document gives one — often printed right next to its phone number and address.",
    },
    website: {
      type: 'string',
      description: "The primary place's own website URL, if the document gives one.",
    },
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
    bookedThrough: {
      type: 'string',
      description:
        "The travel agent or online travel agency the booking went through (e.g. 'Capital One Travel', 'Expedia'), if any — omit for a booking made directly with the property/carrier.",
    },
    roomType: {
      type: 'string',
      description:
        "The named room/cabin type only, for a stay — e.g. 'Standard Cabin', not 'Standard Cabin, 2 Double'. If the document states the type and bed layout together as one field (a common pattern, e.g. 'Room Type: Standard Cabin, 2 Double'), split them: the type-name part goes here, the bed-layout part goes in bedConfiguration instead — never repeat the bed layout in both.",
    },
    bedConfiguration: {
      type: 'string',
      description:
        "The room's bed layout only, for a stay, e.g. '2 Queen + 1 Rollaway' or '2 Double' — see roomType's own note on splitting a combined 'type, beds' field rather than repeating the bed layout in both.",
    },
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
    extraFees: {
      type: 'array',
      description:
        "For a stay: any named fee due separately from the main room cost (a resort fee, a parking fee, a pet fee, ...) — not a fee already folded into costAmount. Omit entirely if there's none, don't invent one.",
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: "e.g. 'Resort fee', 'Uncovered self parking'." },
          amount: { type: 'number' },
          currency: { type: 'string', description: "ISO 4217 currency code, e.g. 'USD'." },
        },
        required: ['name', 'amount'],
      },
    },
    noteworthy: NOTE_ARRAY_SCHEMA(
      'this entry as a whole — a cancellation policy, an occupancy limit that conflicts with the party size, a reservation requirement, or similar',
    ),
    includedTransfers: {
      type: 'array',
      description:
        "For a stay: set this when the rate includes round-trip shuttle/transfer transportation between a fixed meeting point and the property — common for remote lodges with no direct vehicle access (e.g. 'this rate includes your room and transportation between McCarthy and Kennicott when you arrive and depart'). One entry per such transfer relationship; two Transit entries get created from each, one arriving at check-in and one departing at check-out. Omit entirely if the stay has ordinary direct vehicle/pedestrian access.",
      items: {
        type: 'object',
        properties: {
          transferPointLabel: {
            type: 'string',
            description:
              "Name of the fixed meeting point, e.g. 'McCarthy Road footbridge'. If the document describes more than one way to reach it (e.g. separate 'Arriving by Car' / 'Arriving by Shuttle Van' / 'Arriving by Plane' sections, each meeting the property's own shuttle at a different point), pick whichever meeting point goes with a road/car arrival as the default here — that's the common case for a road-trip itinerary — and use `notes` below to flag the other options so the traveler can confirm and adjust if a different one actually applies.",
          },
          mode: {
            type: 'string',
            description: "Transit mode, e.g. 'shuttle', 'ferry'. Defaults to 'shuttle'.",
          },
          notes: NOTE_ARRAY_SCHEMA(
            "this specific transfer — its own pickup schedule, an after-hours fee, or (per transferPointLabel's own note) a prompt naming the other arrival-mode options (car/shuttle van/plane, or whatever the document actually lists) and their own meeting points, so the traveler can confirm which applies and adjust the drafted Transit's From/To if needed",
          ),
        },
        required: ['transferPointLabel'],
      },
    },
    includedPerks: {
      type: 'array',
      description:
        "For a stay: named benefits already covered by the room rate, worth recording as their own zero-cost package rather than just a note — e.g. 'Round-trip shuttle between the McCarthy Road footbridge and the lodge', 'Breakfast buffet'. Concrete, named inclusions only — not vague marketing language.",
      items: { type: 'string' },
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
  'If this document is a meal/restaurant reservation or dining booking, also set mealType and, if the format is clear, diningFormat. ' +
  'For a stay, also capture roomType, bedConfiguration, bookedThrough, and any extraFees due separately from the main cost. ' +
  "Always check for the property/carrier's own phone, email, and website too — commonly printed together near its name and address block, easy to overlook among the booking details. " +
  'Also set noteworthy for any real cancellation/refund risk, occupancy limit, access constraint, or reservation requirement the document states. ' +
  'For a stay, also set includedTransfers if the rate includes round-trip shuttle/transfer transportation to a fixed meeting point (a remote lodge with no direct vehicle access is the classic case), and includedPerks for any other named benefit already covered by the rate.';

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
  const toolUse = findToolUse(body.content, tool.name);
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
  'For any entry that is a meal/restaurant reservation or dining booking, also set mealType and, if the format is clear, diningFormat. ' +
  'For a stay entry, also capture roomType, bedConfiguration, bookedThrough, and any extraFees due separately from the main cost. ' +
  "Always check for the property/carrier's own phone, email, and website too — commonly printed together near its name and address block, easy to overlook among the booking details. " +
  'Also set noteworthy on any entry with a real cancellation/refund risk, occupancy limit, access constraint, or reservation requirement. ' +
  'For a stay entry, also set includedTransfers if the rate includes round-trip shuttle/transfer transportation to a fixed meeting point (a remote lodge with no direct vehicle access is the classic case), and includedPerks for any other named benefit already covered by the rate.';

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
    .map(dateOnly);
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
    if (fields.kind === 'stay') {
      staged.stays.push(entity as Stay);
      staged.transits.push(
        ...draftIncludedTransfers(fields, entity as Stay, legId).map((d) => d.transit),
      );
    } else if (fields.kind === 'transit') {
      staged.transits.push(entity as Transit);
    } else {
      staged.activities.push(entity as Activity);
    }
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
    const date = dateOnly(candidate);
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
  if (
    !fields.bookingStatus &&
    !fields.confirmationNumber &&
    fields.costAmount == null &&
    !fields.bookedThrough
  ) {
    return base;
  }
  return {
    status: fields.bookingStatus ?? base?.status ?? 'booked',
    cost: fields.costAmount != null ? moneyFrom(fields) : (base?.cost ?? null),
    confirmationNumber: fields.confirmationNumber ?? base?.confirmationNumber ?? null,
    bookedThrough: fields.bookedThrough ?? base?.bookedThrough,
  };
}

// One extractEntityFromDocument/extractTripEntitiesFromDocument result's
// worth of live Places lookups, resolved separately from extraction itself
// (see resolvePlacesForFields) — a real Google Place id/image the human can
// still correct via the review form's own PlacePickerField, never invented
// by the AI (see the top-of-file note on placeLabel/lodgingName).
export interface ResolvedPlaces {
  lodging?: Place | null;
  place?: Place | null;
  from?: Place | null;
  to?: Place | null;
  // Parallel to fields.includedTransfers — the transfer point each entry
  // names, resolved the same best-effort way as every other place here.
  includedTransfers?: (Place | null)[];
}

export function draftEntityFromExtraction(
  fields: ExtractedFields,
  legId: string,
  date: string,
  resolved: ResolvedPlaces = {},
): Activity | Stay | Transit {
  const booking = mergeBooking(fields);

  if (fields.kind === 'stay') {
    const stay = blankStay(legId, date);
    if (fields.checkInAt) stay.checkInAt = fields.checkInAt;
    if (fields.checkOutAt) stay.checkOutAt = fields.checkOutAt;
    if (stay.lodging) {
      // phone/website have a live Places equivalent once resolved (see
      // PlacePanel), so the extracted fallback only matters pre-resolution;
      // email has no such equivalent at all and must survive either way, or
      // it's lost for good the moment a lookup happens to succeed.
      stay.lodging.place = resolved.lodging
        ? { ...resolved.lodging, email: fields.email }
        : {
            id: null,
            label: fields.lodgingName ?? stay.lodging.place.label,
            phone: fields.phone,
            email: fields.email,
            website: fields.website,
          };
      stay.lodging.roomType = fields.roomType ?? null;
      stay.lodging.bedConfiguration = fields.bedConfiguration;
    }
    stay.booking = booking;
    const packages = [
      ...(fields.extraFees ?? []).map((fee) => ({
        ...blankPackage(),
        name: fee.name,
        cost: { amount: fee.amount, currency: fee.currency ?? 'USD' },
      })),
      ...(fields.includedPerks?.length
        ? [{ ...blankPackage(), name: 'Included with your stay', benefits: fields.includedPerks }]
        : []),
    ];
    if (packages.length) stay.packages = packages;
    return stay;
  }

  if (fields.kind === 'transit') {
    const transit = blankTransit(legId, date);
    if (fields.startAt) transit.departsAt = fields.startAt;
    if (fields.endAt) transit.arrivesAt = fields.endAt;
    transit.from = resolved.from ?? { id: null, label: fields.fromLabel ?? transit.from.label };
    transit.to = resolved.to ?? { id: null, label: fields.toLabel ?? transit.to.label };
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
  activity.text = fields.text ?? null;
  activity.place =
    resolved.place ?? (fields.placeLabel ? { id: null, label: fields.placeLabel } : null);
  activity.booking = booking;
  activity.mealType = fields.mealType ?? null;
  activity.diningFormat = fields.diningFormat ?? null;
  return activity;
}

// One Transit a stay's own `includedTransfers` implies, paired with whatever
// notes (a pickup schedule, an arrival-mode choice to confirm — see
// ExtractedTransfer's own note) concern that same transfer. Notes travel
// alongside their Transit directly, rather than being re-derived from it
// afterwards by array position, since "which meeting point applies" is a
// fact about the transfer/transit, not about the room the stay's own
// noteworthy would otherwise have to carry it as.
export interface IncludedTransferDraft {
  transit: Transit;
  // Already shaped like NoteEditContextObject.ts's own NoteDraft (see
  // notesFromExtraction's note on why this file names that shape inline
  // rather than importing it) and pointed at this same transit's real _id,
  // so a caller can hand these straight to openNoteDraftSequence without
  // re-deriving the ref itself.
  notes: { ref: Ref; kind: NoteKind; text: string }[];
}

// Turns a stay's own `includedTransfers` into the real Transit drafts they
// imply — one arriving at check-in, one departing at check-out, mirroring
// the round trip a bundled lodge shuttle actually runs (see
// ExtractedTransfer's own note on the Kennicott Glacier Lodge case this was
// built for: no direct vehicle access, so a stay there always needs both
// legs modeled, not just mentioned in a note). Both ends anchor to the
// stay's own real checkInAt/checkOutAt timestamps rather than a fuzzy time
// of day — Transit (unlike Activity) has no fuzzy-timeLabel concept, and
// "right when you check in/out" is the one anchor every such stay actually
// gives us without guessing at a duration the document never states.
// arrivesAt is deliberately left null (same as blankTransit's own default)
// rather than guessing a duration for the ride itself — the review form
// still requires a real one before Save, so the human fills in the one
// number this function has no basis to guess. `legId` is the stay's own
// leg; each transit's own date is derived from its own end of the stay, in
// case check-in and check-out somehow fall on different legs.
export function draftIncludedTransfers(
  fields: ExtractedFields,
  stay: Stay,
  legId: string,
  resolved: ResolvedPlaces = {},
): IncludedTransferDraft[] {
  if (!fields.includedTransfers?.length || !stay.lodging) return [];
  const lodgingPlace = stay.lodging.place;
  return fields.includedTransfers.flatMap((transfer, index) => {
    const transferPlace = resolved.includedTransfers?.[index] ?? {
      id: null,
      label: transfer.transferPointLabel,
    };
    const mode = transfer.mode ?? 'shuttle';
    const arrival = blankTransit(legId, dateOnly(stay.checkInAt));
    arrival.mode = mode;
    arrival.from = transferPlace;
    arrival.to = lodgingPlace;
    arrival.departsAt = stay.checkInAt;
    const departure = blankTransit(legId, dateOnly(stay.checkOutAt));
    departure.mode = mode;
    departure.from = lodgingPlace;
    departure.to = transferPlace;
    departure.departsAt = stay.checkOutAt;
    const notesFor = (transitId: string) =>
      (transfer.notes ?? []).map((n) => ({
        ref: { entity: 'transit' as const, id: transitId },
        kind: n.kind,
        text: n.text,
      }));
    return [
      { transit: arrival, notes: notesFor(arrival._id) },
      { transit: departure, notes: notesFor(departure._id) },
    ];
  });
}

// Resolves whichever place name(s) this extraction named to a real Google
// Place id + hero image via a live Text Search + Place Details lookup (the
// same API the manual PlacePickerField already searches, see
// components/edit/usePlaceSearch.ts) — never the model itself, which never
// invents an id (see the top-of-file note). Best-effort: a failed lookup, a
// missing/unconfigured API key, or no match at all all resolve to {}, which
// draftEntityFromExtraction reads the same as "nothing resolved yet" and
// falls back to the plain-text label a human can still fix in the review
// form's own picker.
export async function resolvePlacesForFields(fields: ExtractedFields): Promise<ResolvedPlaces> {
  if (!isPlacesApiKeyConfigured()) return {};
  // withImage: false skips the Place Details + photo fetch, keeping just the
  // cheap Text Search id/label match — used for includedTransfers, where a
  // hero image of a meeting point (a footbridge, a parking lot) isn't worth
  // an Enterprise-tier Place Details call for a value the traveler often
  // discards anyway (see draftIncludedTransfers' own note on ambiguity).
  const lookup = async (label: string | undefined, withImage = true): Promise<Place | null> => {
    if (!label?.trim()) return null;
    try {
      const [top] = await searchPlaces(label);
      if (!top) return null;
      const image = withImage ? await fetchFirstPlaceImage(top.id) : undefined;
      return { id: top.id, label: top.label || label, images: image ? [image] : [] };
    } catch {
      return null;
    }
  };
  if (fields.kind === 'stay') {
    const [lodging, includedTransfers] = await Promise.all([
      lookup(fields.lodgingName),
      Promise.all((fields.includedTransfers ?? []).map((t) => lookup(t.transferPointLabel, false))),
    ]);
    return { lodging, includedTransfers };
  }
  if (fields.kind === 'activity') return { place: await lookup(fields.placeLabel) };
  const [from, to] = await Promise.all([lookup(fields.fromLabel), lookup(fields.toLabel)]);
  return { from, to };
}

// Turns one extraction's `noteworthy` callouts into drafts for
// NoteEditContext's own openNoteDraftSequence (state/NoteEditContextObject.ts)
// to review one at a time, right after the primary entity's own draft saves
// — called once that entity's real _id is known (blank*'s
// crypto.randomUUID() is assigned at draft time and never changes before
// Save, so it's safe to reference here even before the entity itself has
// been saved). Structurally matches NoteDraft rather than importing it: this
// is pure model code and NoteEditContextObject.ts lives in state/, which
// pulls in React. Returns [] when there's nothing noteworthy, rather than an
// empty note nobody asked for.
export function notesFromExtraction(
  fields: ExtractedFields,
  entityId: string,
): { ref: Ref; kind: NoteKind; text: string }[] {
  return (fields.noteworthy ?? []).map((n) => ({
    ref: { entity: fields.kind, id: entityId },
    kind: n.kind,
    text: n.text,
  }));
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
