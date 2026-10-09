// AI-assisted document import: reads an uploaded booking document (PDF or photo) via
// the Anthropic API, called directly from the browser with a user-supplied key (see
// src/config/aiKey.ts for why this key is never hardcoded like config/places.ts's Google
// key). Goes through anthropicClient.ts's shared SDK wrapper, with structured output.
import { createMessage, responseText } from './anthropicClient';
import {
  bookingCost,
  bookingFares,
  bookingFixedCharges,
  bookingOf,
  fixedPricing,
  sameMoney,
  uniqueBookings,
} from './bookings';
import {
  blankActivity,
  blankPackage,
  blankStay,
  blankTransit,
  COLLECTION_FOR_KIND,
  decideMeal,
  DINING_FORMATS_WITH_INCLUDED_IN,
  type EditKind,
  TRANSIT_DETAIL_KEYS,
} from './editForms';
import { DINING_FORMAT_LABEL, MEAL_TYPES, NOTE_KINDS } from './formatting';
import {
  fetchFirstPlaceImage,
  isPlacesApiKeyConfigured,
  type PlaceSearchResult,
  searchPlaces,
} from './places';
import {
  addDaysStr,
  addMinutesIso,
  dateOnly,
  diffMinutesIso,
  formatMoney,
  wallClockMs,
} from './tripModel';
import type {
  Activity,
  Booking,
  DayFrame,
  DiningFormat,
  FixedCharge,
  MealType,
  Money,
  NoteKind,
  Package,
  PassengerFare,
  Place,
  Ref,
  SeatAssignment,
  Stay,
  Transit,
  Traveler,
  TripData,
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

// The message an import UI shows for a failed extraction — a
// DocumentImportError's own text is already user-facing; anything else
// (network, unexpected shape) gets the generic line.
export function importErrorMessage(err: unknown): string {
  return err instanceof DocumentImportError
    ? err.message
    : 'Something went wrong reading that document.';
}

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

// ---------- 2. Structured-output extraction ----------

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

// A meal a transit's own price covers — the "light lunch at the lodge" a
// fly-out bear-viewing tour includes. See planIncludedMeals, which drafts it
// as a meal Activity included with that transit, queued for review after it.
export interface ExtractedMeal {
  mealType: MealType;
  placeLabel?: string; // where it's served, when that isn't the transit's own destination
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

// One traveler's seat on one specific flight/sailing — per entry, since the
// same ticket usually seats a traveler differently on each leg of a trip.
export interface ExtractedSeat {
  travelerName: string;
  seat: string;
  cabin?: string;
  fareClass?: string;
}

// One traveler's own line of a document that itemizes its price per person
// (an airline's per-ticket fare breakdown). Document-level rather than per
// entry, because a fare covers every flight on its ticket — see
// draftBookings, which turns these into a Booking's perTraveler pricing.
export interface ExtractedFare {
  travelerName: string;
  amount: number;
  currency?: string;
  ticketNumber?: string;
  confirmationNumber?: string;
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
  operatedBy?: string; // transit: codeshare operator, when another airline flies it
  aircraft?: string; // transit
  seats?: ExtractedSeat[]; // transit: this entry's own seat per traveler
  travelerNames?: string[]; // who this entry is for, when the document names them
  travelerCount?: number; // how many travelers it covers ("4 Adults"), named or not
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
  unitPrice?: number; // one same-for-everyone per-person rate ("Adults $1,145.00 × 4")
  fixedCharges?: ExtractedFee[]; // the part of costAmount that doesn't change with headcount
  includedMeals?: ExtractedMeal[]; // transit: meals its price covers
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
        enum: NOTE_KINDS,
        description:
          "'warning' for a real financial or logistical risk (nonrefundable, a steep cancellation fee, an access constraint); 'info' for a useful but lower-stakes heads-up (an extra fee due at the property, a reservation requirement, a choice the traveler needs to make); 'footnote' for minor color.",
      },
      text: { type: 'string' },
    },
    required: ['kind', 'text'],
    additionalProperties: false,
  },
});

// Shared by both the single-entity extraction (below) and the multi-entity one
// (see extractTripEntitiesFromDocument) — one document-derived entry's shape
// either way, just extracted one-at-a-time vs. all-at-once. Every object sets
// additionalProperties: false, which structured outputs require.
export const ENTITY_SCHEMA = {
  type: 'object',
  properties: {
    kind: {
      type: 'string',
      enum: ['activity', 'stay', 'transit'],
      description:
        "Which kind of trip entry this describes. A tour or excursion sold as a fly-out (floatplane, air taxi, bush plane — e.g. a bear-viewing or lodge day trip that flies from the operator's base to a remote destination and back) is transit, not activity: the flights are what's booked.",
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
    carrier: { type: 'string', description: 'The marketing airline/operator name.' },
    flightNumber: {
      type: 'string',
      description:
        "As printed, e.g. 'AS 273'. For a codeshare printed as 'AS 2000 / QX 2000', give the first (marketing) number only.",
    },
    operatedBy: {
      type: 'string',
      description:
        "For a transit flown by a different airline than the one it's sold under, the operating carrier, e.g. 'Horizon Air' for 'Horizon Air as AlaskaHorizon'.",
    },
    aircraft: { type: 'string', description: "For a flight, e.g. 'Boeing 737-800'." },
    travelerNames: {
      type: 'array',
      description:
        'Full names of the travelers this entry is for, exactly as printed, when the document lists them as passengers/guests/participants. Never the purchaser, contact person or account holder just because their name appears on the confirmation — only list them if the document lists them as a traveler.',
      items: { type: 'string' },
    },
    travelerCount: {
      type: 'integer',
      description:
        "How many travelers this entry covers when the document states it (e.g. '4 Adults' is 4), whether or not it names them.",
    },
    seats: {
      type: 'array',
      description:
        "For a transit: each traveler's seat on THIS flight/sailing only — a round trip's outbound and return each get their own list.",
      items: {
        type: 'object',
        properties: {
          travelerName: { type: 'string', description: 'Full name, exactly as printed.' },
          seat: { type: 'string', description: "e.g. '22A'." },
          cabin: { type: 'string', description: "e.g. 'Coach', 'First'." },
          fareClass: {
            type: 'string',
            description: "The single-letter booking class, e.g. 'N' from 'Class: N COACH'.",
          },
        },
        required: ['travelerName', 'seat'],
        additionalProperties: false,
      },
    },
    bookingStatus: { type: 'string', enum: ['planning', 'booked', 'cancelled'] },
    confirmationNumber: { type: 'string' },
    costAmount: {
      type: 'number',
      description:
        "The booking's total price. When one booking covers several entries (a round trip's two flights), give that same total on each of them.",
    },
    costCurrency: { type: 'string', description: "ISO 4217 currency code, e.g. 'USD'." },
    unitPrice: {
      type: 'number',
      description:
        "When every traveler is charged the same per-person rate (e.g. 'Adults $1,145.00 × 4' is 1145), that rate alone — fees charged per booking go in fixedCharges. Omit when rates differ by traveler (use passengerFares) or nothing is priced per person.",
    },
    fixedCharges: {
      type: 'array',
      description:
        "The lines of costAmount that don't change with the number of travelers, each as printed: a room or cabin rate, taxes and fees on it, a per-booking transportation or service fee. Per-person prices are never fixed charges (use unitPrice or passengerFares). Omit when the whole price is per person.",
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: "As printed, e.g. 'Transportation fee'." },
          amount: { type: 'number' },
          currency: { type: 'string' },
        },
        required: ['name', 'amount'],
        additionalProperties: false,
      },
    },
    includedMeals: {
      type: 'array',
      description:
        "For a transit whose price includes a meal (e.g. 'Light lunch at the lodge' on a fly-out tour): one line per meal, on the entry that takes the travelers to where it's served (a fly-out's outbound). Omit when no meal is included.",
      items: {
        type: 'object',
        properties: {
          mealType: { type: 'string', enum: MEAL_TYPES },
          placeLabel: {
            type: 'string',
            description:
              "Where it's served, only when that's somewhere other than this entry's toLabel.",
          },
        },
        required: ['mealType'],
        additionalProperties: false,
      },
    },
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
      enum: MEAL_TYPES,
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
        additionalProperties: false,
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
        additionalProperties: false,
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
  additionalProperties: false,
};

type JsonSchema = Record<string, unknown>;

// Structured outputs cap a schema at 24 optional properties and at 16 union-typed
// (nullable / anyOf) ones, each counted across every nested object — and
// ENTITY_SCHEMA alone has ~30 optional properties, so neither "leave them optional"
// nor "make them required-but-nullable" fits. Instead every optional string or
// array property is sent as required, with an empty value ('' or []) meaning "not
// in the document"; an optional enum gains '' as one more allowed value. Only
// non-string scalars (costAmount, unitPrice, travelerCount) stay optional. ENTITY_SCHEMA itself
// keeps the plain optional shape because askAI.ts's propose_edit tool reuses its
// properties, and a non-strict tool has neither cap.
export function requireWithEmptyDefaults(schema: JsonSchema): JsonSchema {
  if (schema.type === 'array' && schema.items) {
    return { ...schema, items: requireWithEmptyDefaults(schema.items as JsonSchema) };
  }
  if (schema.type !== 'object' || !schema.properties) return schema;
  const required = new Set((schema.required as string[] | undefined) ?? []);
  const properties = Object.fromEntries(
    Object.entries(schema.properties as Record<string, JsonSchema>).map(([key, prop]) => {
      const converted = requireWithEmptyDefaults(prop);
      if (required.has(key)) return [key, converted];
      if (converted.type === 'array') required.add(key);
      if (converted.type !== 'string') return [key, converted];
      required.add(key);
      const description = `${converted.description ?? ''} Empty string if not given.`.trim();
      return converted.enum
        ? [key, { ...converted, enum: [...(converted.enum as string[]), ''], description }]
        : [key, { ...converted, description }];
    }),
  );
  return { ...schema, properties, required: [...required] };
}

// The inverse on the reply side: drop the '' / [] placeholders requireWithEmptyDefaults
// made the model emit, so callers see absent fields exactly as ExtractedFields types them.
function stripEmpty(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripEmpty);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== '' && v !== null && !(Array.isArray(v) && v.length === 0))
      .map(([k, v]) => [k, stripEmpty(v)]),
  );
}

// Structured outputs (output_config.format) constrain the reply itself to `schema`,
// so the result is the response's JSON text — no tool call to force or look for.
async function extractWithSchema(
  file: File,
  apiKey: string,
  schema: Record<string, unknown>,
  instructions: string,
): Promise<unknown> {
  const data = await fileToBase64(file);
  const mediaType = file.type as SupportedType;
  const mediaBlock =
    mediaType === 'application/pdf'
      ? {
          type: 'document' as const,
          source: { type: 'base64' as const, media_type: mediaType, data },
        }
      : {
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: mediaType, data },
        };

  const message = await createMessage(
    {
      max_tokens: 16000,
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: requireWithEmptyDefaults(schema) },
      },
      messages: [{ role: 'user', content: [mediaBlock, { type: 'text', text: instructions }] }],
    },
    apiKey,
    (msg) => new DocumentImportError(msg),
    'Claude declined to process this document.',
  );
  if (message.stop_reason === 'max_tokens') {
    throw new DocumentImportError('That document produced more detail than fits in one reply.');
  }
  try {
    return stripEmpty(JSON.parse(responseText(message.content)));
  } catch {
    throw new DocumentImportError('Claude did not return a structured result for this document.');
  }
}

// ---------- 2b. Multi-entry extraction ----------
//
// A single booking document often describes several entries at once — a
// round-trip confirmation is two flights, a cruise confirmation a cabin plus
// its transfers — so both entry points (the assistant's import, and Add
// Trip's "start from a document") extract every entry in one call, plus the
// document's own per-traveler fare lines. Add Trip also asks for a suggested
// trip name and summary in that same call rather than a second document read.

export interface DocumentExtraction {
  entities: ExtractedFields[];
  passengerFares?: ExtractedFare[];
}

export interface TripExtraction extends DocumentExtraction {
  tripName?: string;
  tripSummary?: string;
}

const DOCUMENT_PROPERTIES = {
  entities: {
    type: 'array',
    items: ENTITY_SCHEMA,
    description:
      'One entry per distinct booked segment — a round-trip flight is two transit entries, one per flight.',
  },
  passengerFares: {
    type: 'array',
    description:
      "When the document itemizes its price per traveler (an airline's per-ticket fare breakdown, a cruise fare per guest), one line per traveler with that traveler's own total. Omit when only a single overall price is given.",
    items: {
      type: 'object',
      properties: {
        travelerName: { type: 'string', description: 'Full name, exactly as printed.' },
        amount: {
          type: 'number',
          description: "That traveler's own total including taxes and fees.",
        },
        currency: { type: 'string', description: "ISO 4217 currency code, e.g. 'USD'." },
        ticketNumber: { type: 'string' },
        confirmationNumber: {
          type: 'string',
          description: 'The confirmation number this fare belongs to, if the document has several.',
        },
      },
      required: ['travelerName', 'amount'],
      additionalProperties: false,
    },
  },
};

const DOCUMENT_SCHEMA = {
  type: 'object',
  properties: DOCUMENT_PROPERTIES,
  required: ['entities'],
  additionalProperties: false,
};

const TRIP_SCHEMA = {
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
    ...DOCUMENT_PROPERTIES,
  },
  required: ['entities'],
  additionalProperties: false,
};

const MULTI_ENTRY_INSTRUCTIONS =
  'Extract every distinct booking/itinerary entry from this document. ' +
  'A round-trip flight confirmation is two transit entries, one for the outbound flight and one for the return, each with its own times, flight number, aircraft and seats. ' +
  'A cruise confirmation is usually one stay entry for the cabin. ' +
  "A fly-out excursion (a floatplane/air-taxi/bush-plane day trip such as bear viewing at a remote lodge, even when it is sold as a tour with a meeting location and a start/end time) is two transit entries with mode 'flight': the outbound from the operator's base (fromLabel) to the destination (toLabel) departing at the start time, and the return from the destination back to the base arriving at the end time — leave the outbound's endAt and the return's startAt empty unless the document states them. Both share the same confirmationNumber and costAmount. A meal the tour includes (e.g. 'Light lunch at the lodge') goes in the outbound's includedMeals. " +
  "Split every price by what it scales with, on every entry the booking covers, with the overall total as costAmount: a per-person rate times a headcount (e.g. 'Adults $1,145.00 × 4') is unitPrice and travelerCount; anything charged per booking or per room — a room rate, its taxes, a transportation fee — is a fixedCharges line. " +
  'Use the field names exactly as given and leave any field you cannot determine from the document empty — do not guess. ' +
  'placeLabel, lodgingName, fromLabel and toLabel must be plain text only; never invent an id. For an airport, include its code, e.g. "Anchorage (ANC)". When the document names a meeting location, check-in point or operator base (e.g. a floatplane company\'s office/dock), use that exact place name for fromLabel/toLabel — never substitute the nearest airport or city. ' +
  "When the document lists each traveler's seat, set seats on each transit entry for that flight only. " +
  "When the document breaks the price down per traveler, set passengerFares with each traveler's own total, and still give the overall total as costAmount on every entry it covers. " +
  'For any entry that is a meal/restaurant reservation or dining booking, also set mealType and, if the format is clear, diningFormat. ' +
  'For a stay entry, also capture roomType, bedConfiguration, bookedThrough, and any extraFees due separately from the main cost. ' +
  "Always check for the property/carrier's own phone, email, and website too — commonly printed together near its name and address block, easy to overlook among the booking details. " +
  'Also set noteworthy on any entry with a real cancellation/refund risk, occupancy limit, access constraint, or reservation requirement. ' +
  'For a stay entry, also set includedTransfers if the rate includes round-trip shuttle/transfer transportation to a fixed meeting point (a remote lodge with no direct vehicle access is the classic case), and includedPerks for any other named benefit already covered by the rate.';

const TRIP_EXTRACTION_INSTRUCTIONS =
  'Also suggest a short trip name and a one or two sentence trip summary. ' +
  MULTI_ENTRY_INSTRUCTIONS;

export async function extractDocumentEntries(
  file: File,
  apiKey: string,
): Promise<DocumentExtraction> {
  const result = (await extractWithSchema(
    file,
    apiKey,
    DOCUMENT_SCHEMA,
    MULTI_ENTRY_INSTRUCTIONS,
  )) as DocumentExtraction;
  if (!result.entities?.length) {
    throw new DocumentImportError('Could not find any booking details in that document.');
  }
  return result;
}

export async function extractTripEntitiesFromDocument(
  file: File,
  apiKey: string,
): Promise<TripExtraction> {
  const result = (await extractWithSchema(
    file,
    apiKey,
    TRIP_SCHEMA,
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
  bookings: Booking[];
}

export function draftTripEntities(
  extraction: DocumentExtraction,
  legId: string,
  date: string,
  travelers: Traveler[],
): StagedTripEntities {
  const { bookingFor } = draftBookings(extraction, travelers);
  const staged: StagedTripEntities = {
    activities: [],
    stays: [],
    transits: [],
    bookings: uniqueBookings(bookingFor),
  };
  for (const [i, fields] of extraction.entities.entries()) {
    const entity = draftEntityFromExtraction(fields, legId, date, {}, travelers, bookingFor[i]);
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

// draftBookings' warnings for a whole extraction, in entry order — for a flow
// like TripEditDialog's that stages every entry at once rather than queueing
// each for review with its own notes.
export function bookingWarnings(
  extraction: DocumentExtraction,
  travelers: Traveler[],
): ExtractedNote[] {
  const { extraNotes } = draftBookings(extraction, travelers);
  return [...extraNotes.entries()].sort(([a], [b]) => a - b).flatMap(([, notes]) => notes);
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
  days: DayFrame[],
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

// Shared by draftBookings (below, `base` omitted — nothing to fall back to on a
// brand-new booking) and askAI.ts's draftEntityFromProposal (`base` is the real
// entity's existing booking, so a field the AI didn't mention survives instead
// of being reset). Keeps base's _id, so editing a booking a round trip's two
// flights share still updates that one shared document.
export function mergeBooking(fields: ExtractedFields, base: Booking | null = null): Booking | null {
  if (
    !fields.bookingStatus &&
    !fields.confirmationNumber &&
    fields.costAmount == null &&
    !fields.bookedThrough
  ) {
    return base;
  }
  const cost = moneyFrom(fields);
  // A stated total that matches base's own price is the same price, so its
  // split (and its ticket numbers) is kept rather than flattened. Otherwise
  // the document's fixed lines replace base's; with neither those nor a
  // per-person rate, the whole stated total is one fixed charge — what a
  // room booking is. Per-person fares are added by draftBookings, which
  // knows the travelers.
  const samePrice = sameMoney(cost, bookingCost(base));
  const fixed = fixedChargesFrom(fields);
  const pricing: Booking['pricing'] = samePrice
    ? (base?.pricing ?? null)
    : fixed.length
      ? { perTraveler: [], fixed }
      : cost && fields.unitPrice == null
        ? fixedPricing([{ label: 'Total', amount: cost }])
        : (base?.pricing ?? null);
  const booking: Booking = {
    ...base,
    _id: base?._id ?? crypto.randomUUID(),
    status: fields.bookingStatus ?? base?.status ?? 'booked',
    pricing,
    confirmationNumber: fields.confirmationNumber ?? base?.confirmationNumber ?? null,
  };
  const bookedThrough = fields.bookedThrough ?? base?.bookedThrough;
  if (bookedThrough) booking.bookedThrough = bookedThrough;
  return booking;
}

function fixedChargesFrom(fields: ExtractedFields): FixedCharge[] {
  return (fields.fixedCharges ?? []).map((c) => ({
    label: c.name,
    amount: { amount: c.amount, currency: c.currency || fields.costCurrency || 'USD' },
  }));
}

// Titles and suffixes a document prints around a name that aren't part of
// matching it — airline manifests add MR/MRS/MSTR, ticketing systems CHD/INF.
const NAME_AFFIXES = new Set(['mr', 'mrs', 'ms', 'miss', 'mstr', 'master', 'dr', 'chd', 'inf']);
const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);

// A printed name's words in reading order, original case kept, titles and
// punctuation dropped — "RODECAP/BRIAN MR" and "Rodecap, Brian" both read
// as BRIAN RODECAP / Brian Rodecap.
function nameWords(name: string): string[] {
  const words = (part: string) =>
    part
      .replace(/[.,]/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !NAME_AFFIXES.has(w.toLowerCase()));
  const slash = name.indexOf('/');
  if (slash >= 0) return [...words(name.slice(slash + 1)), ...words(name.slice(0, slash))];
  const comma = name.indexOf(',');
  if (comma >= 0) {
    const after = words(name.slice(comma + 1));
    // "Brian Rodecap, Jr." is already in reading order.
    if (after.some((w) => !NAME_SUFFIXES.has(w.toLowerCase()))) {
      return [...after, ...words(name.slice(0, comma))];
    }
  }
  return words(name);
}

// Matches a name as printed on a document to one of the trip's travelers —
// the full name first (ignoring case, spacing, titles and LAST/FIRST order),
// then a first and last name that only one traveler shares (a document may
// add or drop a middle name), then — for a document printing only a first
// name — a first name only one traveler has. null rather than a guess: a
// seat or fare credited to the wrong person is worse than a new traveler the
// reader can merge later (see withDocumentTravelers).
export function matchTraveler(name: string, travelers: Traveler[]): string | null {
  const target = nameWords(name).map((w) => w.toLowerCase());
  if (!target.length) return null;
  const known = travelers.map((t) => ({
    id: t.id,
    words: nameWords(t.name).map((w) => w.toLowerCase()),
  }));
  const exact = known.find((t) => t.words.join(' ') === target.join(' '));
  if (exact) return exact.id;
  const unique = (matches: typeof known) => (matches.length === 1 ? matches[0].id : null);
  if (target.length > 1) {
    return unique(
      known.filter((t) => t.words[0] === target[0] && t.words.at(-1) === target.at(-1)),
    );
  }
  return unique(known.filter((t) => t.words[0] === target[0]));
}

// How a traveler first met on a document is named on the trip: reading
// order, titles dropped, and an all-caps manifest name ("RODECAP/BRIAN MR")
// put in title case. Mixed case is kept as printed (McDonald, de la Cruz).
function travelerDisplayName(name: string): string {
  const words = nameWords(name);
  const joined = words.join(' ');
  if (joined !== joined.toUpperCase() && joined !== joined.toLowerCase()) return joined;
  return words
    .map((w) => w.toLowerCase().replace(/(^|[-'])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase()))
    .join(' ');
}

// Every traveler name an extraction mentions — who each entry is for, the
// names on its seats, and the per-traveler fares.
export function travelerNamesIn(extraction: DocumentExtraction): string[] {
  return [
    ...extraction.entities.flatMap((fields) => entryTravelerNames(fields)),
    ...(extraction.passengerFares ?? []).map((f) => f.travelerName),
  ];
}

function entryTravelerNames(fields: ExtractedFields): string[] {
  return [...listedTravelerNames(fields), ...(fields.seats ?? []).map((s) => s.travelerName)];
}

// An entry's travelerNames, unless the document's own headcount says the list
// is incomplete — a tour confirmation for "4 Adults" that prints only the
// purchaser's name under Contact Information names one person, not the party.
// Trusting that partial list would book the entry for one traveler only.
function listedTravelerNames(fields: ExtractedFields): string[] {
  const names = fields.travelerNames ?? [];
  return fields.travelerCount && names.length < fields.travelerCount ? [] : names;
}

// The trip's travelers plus a new one for each name a document gives that
// none of them matches — so a passenger the trip doesn't know yet still gets
// their seat, fare and place on the flight, rather than being dropped (or a
// flight naming only them being reset to the whole party). A name repeated
// across entries becomes one traveler. Nothing is written here: `added` is
// handed to the review queue alongside the draft (see DraftReview.travelers)
// and joins the trip only when that draft is saved. A new traveler who turns
// out to be someone the trip already has (a nickname, a maiden name) is
// merged afterwards rather than guessed at here.
export interface TravelerRoster {
  travelers: Traveler[];
  added: Traveler[];
}

export function withDocumentTravelers(names: string[], travelers: Traveler[]): TravelerRoster {
  const added: Traveler[] = [];
  for (const name of names) {
    if (!nameWords(name).length || matchTraveler(name, [...travelers, ...added])) continue;
    added.push({ id: `trav_${crypto.randomUUID()}`, name: travelerDisplayName(name) });
  }
  return { travelers: [...travelers, ...added], added };
}

// withDocumentTravelers for a single entry rather than a whole document.
export function entryRoster(fields: ExtractedFields, travelers: Traveler[]): TravelerRoster {
  return withDocumentTravelers(travelerNamesIn({ entities: [fields] }), travelers);
}

// The roster's new travelers an entry actually involves — named on it, or
// holding a fare on its booking — which is what its review carries.
function addedTravelersFor(
  fields: ExtractedFields,
  booking: Booking | null,
  roster: TravelerRoster,
): Traveler[] {
  const ids = new Set([
    ...entryTravelerNames(fields).map((n) => matchTraveler(n, roster.travelers)),
    ...(bookingFares(booking) ?? []).map((f) => f.travelerId),
  ]);
  return roster.added.filter((t) => ids.has(t.id));
}

// Entries sharing a confirmation number are one booking — a round trip's two
// flights, say — so they get one Booking document between them rather than
// one each, and the budget counts that fare once. Fares itemized per traveler
// become perTraveler pricing when every name matches a trip traveler (the
// total is then their sum, see bookingCost); otherwise the stated total is
// kept and a note names who couldn't be matched. A stated total that doesn't
// equal the itemized fares is flagged as a note too, never silently picked.
// bookingFor is parallel to extraction.entities; extraNotes holds those
// warnings, keyed by the index of the first entry on each booking.
// baseFor (also parallel) is the Booking each entry's matched existing entity
// already has: a group with one builds on it, keeping its _id and everything
// the document doesn't restate (payment dates, ticket numbers, ...), and
// unconfirmed entries sharing a base stay one booking.
export interface DraftedBookings {
  bookingFor: (Booking | null)[];
  extraNotes: Map<number, ExtractedNote[]>;
}

export function draftBookings(
  extraction: DocumentExtraction,
  travelers: Traveler[],
  baseFor: (Booking | null)[] = [],
): DraftedBookings {
  const { entities } = extraction;
  const fares = extraction.passengerFares ?? [];
  const bookingFor: (Booking | null)[] = entities.map(() => null);
  const extraNotes = new Map<number, ExtractedNote[]>();
  // Grouped by confirmation number, else by shared base booking; entries
  // with neither each stay their own booking.
  const groups = new Map<string, { confirmation: string | null; indexes: number[] }>();
  entities.forEach((fields, i) => {
    const confirmation = fields.confirmationNumber?.trim() || null;
    const key = confirmation
      ? `conf:${confirmation}`
      : baseFor[i]
        ? `base:${baseFor[i]._id}`
        : `entry:${i}`;
    const group = groups.get(key);
    if (group) group.indexes.push(i);
    else groups.set(key, { confirmation, indexes: [i] });
  });
  const confirmedCount = [...groups.values()].filter((g) => g.confirmation).length;

  for (const { confirmation, indexes } of groups.values()) {
    // A fare tagged with a confirmation number belongs to that booking; an
    // untagged one can only be attributed when the document has just one.
    const groupFares = fares.filter((f) =>
      f.confirmationNumber?.trim()
        ? f.confirmationNumber.trim() === confirmation
        : confirmation !== null && confirmedCount === 1,
    );
    const base = indexes.map((i) => baseFor[i]).find((b) => b) ?? null;
    const stated = indexes.reduce<Booking | null>(
      (booking, i) => mergeBooking(entities[i], booking),
      base,
    );
    const entries = indexes.map((i) => entities[i]);
    const docCost = entries.map(moneyFrom).find((c) => c) ?? null;
    const docFixed = entries.map(fixedChargesFrom).find((f) => f.length) ?? null;
    const { booking, notes } = withFares(
      stated,
      bookingFares(base) ?? [],
      docCost,
      groupFares.length ? groupFares : unitFares(entries, travelers),
      docFixed ?? bookingFixedCharges(base) ?? [],
      travelers,
      confirmation,
    );
    for (const i of indexes) bookingFor[i] = booking;
    if (notes.length) extraNotes.set(indexes[0], notes);
  }
  return { bookingFor, extraNotes };
}

// A document that prices everyone at one per-person rate without naming
// them ("Adults $1,145.00 × 4") still gives each traveler a fare when its
// headcount is the whole party. Anything charged per booking on top (a
// transportation fee) stays a fixed charge, never folded into the fares.
function unitFares(entries: ExtractedFields[], travelers: Traveler[]): ExtractedFare[] {
  const priced = entries.find((f) => f.unitPrice != null && f.travelerCount);
  if (!priced?.unitPrice || priced.travelerCount !== travelers.length) return [];
  const { unitPrice, costCurrency } = priced;
  return travelers.map((t) => ({
    travelerName: t.name,
    amount: unitPrice,
    currency: costCurrency,
  }));
}

// priorFares are the base booking's own (for ticket numbers the document
// leaves out); docCost is the total the document itself states — never a
// base booking's older price, which isn't the document's to contradict.
// `fixed` is the booking's fixed part, kept beside the fares. With no fares
// to give (none stated, or a name that matches no traveler), the stated
// booking keeps its own price — or, when that's empty, the document's total
// as one fixed charge, so a known price is never dropped.
function withFares(
  stated: Booking | null,
  priorFares: PassengerFare[],
  docCost: Money | null,
  fares: ExtractedFare[],
  fixed: FixedCharge[],
  travelers: Traveler[],
  confirmationNumber: string | null,
): { booking: Booking | null; notes: ExtractedNote[] } {
  const matched = fares.map((fare) => ({
    fare,
    travelerId: matchTraveler(fare.travelerName, travelers),
  }));
  const unmatched = matched.filter((m) => !m.travelerId).map((m) => m.fare.travelerName);
  if (!fares.length || unmatched.length) {
    const booking =
      stated && !stated.pricing && docCost
        ? { ...stated, pricing: fixedPricing([{ label: 'Total', amount: docCost }]) }
        : stated;
    const notes: ExtractedNote[] = unmatched.length
      ? [
          {
            kind: 'info',
            text: `Couldn't match ${unmatched.join(', ')} to a trip traveler, so this booking keeps its overall price instead of a per-traveler split.`,
          },
        ]
      : [];
    return { booking, notes };
  }
  // A fare the document gives no ticket number keeps the one already on file.
  const booking: Booking = {
    ...(stated ?? {
      _id: crypto.randomUUID(),
      status: 'booked',
      confirmationNumber,
    }),
    pricing: {
      perTraveler: matched.map(({ fare, travelerId }) => {
        const ticketNumber =
          fare.ticketNumber ?? priorFares.find((f) => f.travelerId === travelerId)?.ticketNumber;
        return {
          travelerId: travelerId as string,
          fare: { amount: fare.amount, currency: fare.currency || docCost?.currency || 'USD' },
          ...(ticketNumber ? { ticketNumber } : {}),
        };
      }),
      fixed,
    },
  };
  const itemized = bookingCost(booking);
  const notes: ExtractedNote[] =
    docCost && itemized && !sameMoney(docCost, itemized)
      ? [
          {
            kind: 'warning',
            text: `The per-traveler fares and fixed charges add up to ${formatMoney(itemized)}, but the document's stated total is ${formatMoney(docCost)}. Check which is right.`,
          },
        ]
      : [];
  return { booking, notes };
}

// The traveler-id form of an entry's own travelerNames (or, failing that,
// the names on its seats). A list naming every trip traveler collapses to
// null ("whole party"), the convention Activity/Transit.travelers already use;
// undefined when it names nobody `travelers` has — which, once the document's
// own new travelers are in it (withDocumentTravelers), means it names nobody.
// With no usable names, a stated headcount covering the whole trip party is
// also null; a smaller unnamed headcount can't say who, so it's undefined.
export function travelersFrom(
  fields: ExtractedFields,
  travelers: Traveler[],
): string[] | null | undefined {
  const listed = listedTravelerNames(fields);
  const names = listed.length ? listed : (fields.seats ?? []).map((s) => s.travelerName);
  if (!names.length && fields.travelerCount && fields.travelerCount >= travelers.length) {
    return null;
  }
  const ids = [
    ...new Set(
      names.map((n) => matchTraveler(n, travelers)).filter((id): id is string => id !== null),
    ),
  ];
  if (!ids.length) return undefined;
  return ids.length === travelers.length ? null : ids;
}

export function seatsFrom(fields: ExtractedFields, travelers: Traveler[]): SeatAssignment[] {
  return (fields.seats ?? []).flatMap((s) => {
    const travelerId = matchTraveler(s.travelerName, travelers);
    if (!travelerId || !s.seat.trim()) return [];
    const seat: SeatAssignment = { travelerId, seat: s.seat.trim() };
    if (s.cabin) seat.cabin = s.cabin;
    if (s.fareClass) seat.fareClass = s.fareClass;
    return [seat];
  });
}

// The flight/ticket details an extraction (or an AI proposal) fills on a
// Transit — shared by both drafting paths so a new field is added once. An
// entry naming nobody leaves the Transit's travelers as they were. `travelers`
// must already include the document's new ones (withDocumentTravelers).
export function applyTransitDetails(
  transit: Transit,
  fields: ExtractedFields,
  travelers: Traveler[],
): void {
  for (const key of TRANSIT_DETAIL_KEYS) {
    const value = fields[key];
    if (value) transit[key] = value;
  }
  const named = travelersFrom(fields, travelers);
  if (named !== undefined) transit.travelers = named;
  const seats = seatsFrom(fields, travelers);
  if (seats.length) transit.seats = seats;
}
// One extracted entry's worth of live Places lookups, resolved separately
// from extraction itself (see resolvePlacesForFields) — a real Google Place
// id/image the human can still correct via the review form's own
// PlacePickerField, never invented by the AI (see the top-of-file note on
// placeLabel/lodgingName).
export interface ResolvedPlaces {
  lodging?: Place | null;
  place?: Place | null;
  from?: Place | null;
  to?: Place | null;
  // Parallel to fields.includedTransfers — the transfer point each entry
  // names, resolved the same best-effort way as every other place here.
  includedTransfers?: (Place | null)[];
}

// `booking` is this entry's already-drafted Booking (see draftBookings —
// shared with any other entry on the same confirmation number); only its id
// is stored on the entity.
export function draftEntityFromExtraction(
  fields: ExtractedFields,
  legId: string,
  date: string,
  resolved: ResolvedPlaces = {},
  travelers: Traveler[] = [],
  booking: Booking | null = null,
): Activity | Stay | Transit {
  const bookingId = booking?._id ?? null;

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
    stay.bookingId = bookingId;
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
    applyTransitDetails(transit, fields, travelers);
    transit.bookingId = bookingId;
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
  activity.bookingId = bookingId;
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
  const lookup = async (
    label: string | undefined,
    withImage = true,
    endpointMode?: string,
  ): Promise<Place | null> => {
    if (!label?.trim()) return null;
    try {
      const search = endpointSearch(label, endpointMode);
      const results = await searchPlaces(search.query, search.includedType);
      const top = search.pick(results);
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
  const [from, to] = await Promise.all([
    lookup(fields.fromLabel, true, fields.mode),
    lookup(fields.toLabel, true, fields.mode),
  ]);
  return { from, to };
}

// How to look up one place by name. A flight's endpoint is an airport, but a
// plain text search for "Kotzebue (OTZ)" can rank a business whose name
// contains "OTZ" first — and even restricted to Google's 'airport' type, a
// radio beacon ("Kotzebue VOR-DME OTZ 115.7") can outrank the terminal. So a
// flight endpoint searches "<label> airport" within that type and only
// accepts a result actually named an airport/airfield; if none is, the
// endpoint stays unresolved for the reviewer's place picker rather than
// pinning the wrong place. That airport treatment only applies when the
// label itself names an airport (an IATA code in parens, or the word
// airport/airfield/aerodrome): a floatplane or air-taxi flight often departs
// a named operator base ("Rust's Flying Service" on Lake Hood), and forcing
// that through the airport-typed search resolves it to the nearest real
// airport (ANC) instead of the meeting location the booking names. Every
// other label/mode takes the top plain result.
export function endpointSearch(
  label: string,
  mode?: string,
): {
  query: string;
  includedType?: string;
  pick: (results: PlaceSearchResult[]) => PlaceSearchResult | null;
} {
  if (mode === 'flight' && labelNamesAirport(label)) {
    return {
      query: /\bairport\b/i.test(label) ? label : `${label} airport`,
      includedType: 'airport',
      pick: (results) => results.find((r) => /airport|airfield|aerodrome/i.test(r.label)) ?? null,
    };
  }
  return { query: label, pick: (results) => results[0] ?? null };
}

function labelNamesAirport(label: string): boolean {
  return /\([A-Z]{3}\)/.test(label) || /\b(airport|airfield|aerodrome)\b/i.test(label);
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
  notes: ExtractedNote[] = fields.noteworthy ?? [],
): { ref: Ref; kind: NoteKind; text: string }[] {
  return notes.map((n) => ({
    ref: { entity: fields.kind, id: entityId },
    kind: n.kind,
    text: n.text,
  }));
}

// ---------- 4. Matching an existing entry ----------
//
// A booking document usually confirms something already sketched on the
// itinerary — a placeholder flight to Kotzebue, a still-planning Stay — so
// each drafted entry looks for the existing one it should update instead of
// being added alongside it. Candidates are the same kind within one day either
// side of the draft's own date, and booked entries count too: a flight moved
// by a delay or a schedule change is the same flight, not a second one. The
// best match wins; when nothing qualifies, the entry is added as new.
//  - transit: same mode, and at least one endpoint in common (an airport
//    code like ANC, a shared word, or the same place id), so a same-day
//    return flight never claims the outbound placeholder. More endpoints in
//    common wins, then the closer departure time.
//  - stay: the same lodging, or the same check-in date.
//  - activity: the same place, or a word of its description in common.
// `exclude` holds ids another entry of the same import already claimed.
export function findConflictCandidate<E extends Activity | Stay | Transit>(
  kind: EditKind,
  draft: Activity | Stay | Transit,
  existingOfSameKind: E[],
  exclude: ReadonlySet<string> = new Set(),
): E | null {
  const draftAt = entityAnchor(kind, draft);
  if (!draftAt) return null;
  const draftDate = dateOnly(draftAt);
  const [earliest, latest] = [addDaysStr(draftDate, -1), addDaysStr(draftDate, 1)];
  let best: { entity: E; score: number; distance: number } | null = null;
  // Two candidates equally good is a coin toss, and the only thing left to
  // break it would be JSON array order — offer neither rather than guess.
  let tied = false;
  for (const existing of existingOfSameKind) {
    if (existing._id === draft._id || exclude.has(existing._id)) continue;
    const at = entityAnchor(kind, existing);
    if (!at || dateOnly(at) < earliest || dateOnly(at) > latest) continue;
    const score = matchScore(kind, draft, existing, dateOnly(at) === draftDate);
    if (score <= 0) continue;
    const distance = Math.abs(wallClockMs(at) - wallClockMs(draftAt));
    if (!best || score > best.score || (score === best.score && distance < best.distance)) {
      best = { entity: existing, score, distance };
      tied = false;
    } else if (score === best.score && distance === best.distance) {
      tied = true;
    }
  }
  return tied ? null : (best?.entity ?? null);
}

// When an entity starts: check-in, departure, or an Activity's own startAt
// (undefined for an untimed one).
export function entityStartAt(
  kind: EditKind,
  entity: Activity | Stay | Transit,
): string | null | undefined {
  if (kind === 'stay') return (entity as Stay).checkInAt;
  if (kind === 'transit') return (entity as Transit).departsAt;
  return (entity as Activity).startAt;
}

// entityStartAt, with an untimed Activity anchored at midday on its date so
// it can still be matched by day.
function entityAnchor(kind: EditKind, entity: Activity | Stay | Transit): string | null {
  const date = (entity as Activity).date;
  return entityStartAt(kind, entity) ?? (kind === 'activity' && date ? `${date}T12:00` : null);
}

// Words of four letters or more that name a kind of place or say nothing at
// all, so they'd pair any airport with any airport, or any dinner with any
// dinner, rather than one business with itself.
const GENERIC_WORDS = new Set(
  (
    'about after airport before breakfast brunch cabin cabins campground ' +
    'center dinner evening excursion from have hotel international into lodge ' +
    'lunch meal memorial morning motel municipal national near night onto ' +
    'over park regional resort restaurant state station suites terminal that ' +
    'their then this tour tours trip visit will with your'
  ).split(' '),
);

// Distinctive words of a label: an airport code in parentheses plus words of
// four letters or more that aren't GENERIC_WORDS, so "Ted Stevens Anchorage
// International (ANC)" and "Anchorage (ANC)" share both 'anc' and
// 'anchorage', but "Kotzebue Airport" and "Anchorage Airport" share nothing.
function labelTokens(label: string | null | undefined): Set<string> {
  const text = label ?? '';
  const codes = [...text.matchAll(/\(([A-Z0-9]{3,4})\)/g)].map((m) => m[1].toLowerCase());
  const words = (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (w) => w.length >= 4 && !GENERIC_WORDS.has(w),
  );
  return new Set([...codes, ...words]);
}

function sharedTokenCount(a: Set<string>, b: Set<string>): number {
  return [...a].filter((t) => b.has(t)).length;
}

// Lenient on purpose: a document spells a business however it likes ("The
// Salmon Bake Restaurant"), so one shared distinctive word is enough. The AI's
// own candidate matching (askAIDrafts.ts's sameCandidate) is exact instead.
function placesShare(a: Place | null | undefined, b: Place | null | undefined): boolean {
  if (!a || !b) return false;
  if (a.id && b.id) return a.id === b.id;
  return sharedTokenCount(labelTokens(a.label), labelTokens(b.label)) > 0;
}

function matchScore(
  kind: EditKind,
  draft: Activity | Stay | Transit,
  existing: Activity | Stay | Transit,
  sameDay: boolean,
): number {
  if (kind === 'transit') {
    const d = draft as Transit;
    const e = existing as Transit;
    if (d.mode !== e.mode) return 0;
    return (placesShare(d.from, e.from) ? 1 : 0) + (placesShare(d.to, e.to) ? 1 : 0);
  }
  if (kind === 'stay') {
    const existingPlace = (existing as Stay).lodging?.place;
    if (placesShare((draft as Stay).lodging?.place, existingPlace)) return sameDay ? 3 : 2;
    // Same night alone only pairs with a placeholder that names no lodging
    // yet — a named hotel that isn't this one is a different stay (another
    // scenario's, or a second room), not this booking's placeholder.
    const unnamed = !existingPlace?.id && !existingPlace?.label?.trim();
    return sameDay && unnamed ? 1 : 0;
  }
  const d = draft as Activity;
  const e = existing as Activity;
  if (placesShare(d.place, e.place)) return 2;
  // Free text rambles far more than a place label does, so it takes two
  // distinctive words in common ("Salmon Bake") to count, not just one.
  const shared = sharedTokenCount(
    labelTokens(`${d.text ?? ''} ${d.place?.label ?? ''}`),
    labelTokens(`${e.text ?? ''} ${e.place?.label ?? ''}`),
  );
  return shared >= 2 ? 1 : 0;
}

function namesAnyone(fields: ExtractedFields): boolean {
  return entryTravelerNames(fields).some((n) => nameWords(n).length > 0);
}

// A re-imported confirmation restates the packages it already added (the
// resort fee, "Included with your stay"), so one with a name already on the
// stay updates that package — its price and perks — instead of adding a copy.
function mergePackages(current: Package[], incoming: Package[]): Package[] {
  const key = (p: Package) => p.name.trim().toLowerCase();
  const merged = [...current];
  for (const pkg of incoming) {
    const i = merged.findIndex((p) => key(p) === key(pkg));
    if (i === -1) {
      merged.push(pkg);
    } else {
      merged[i] = {
        ...merged[i],
        cost: pkg.cost ?? merged[i].cost,
        benefits: pkg.benefits ?? merged[i].benefits,
      };
    }
  }
  return merged;
}

// Lays a drafted entry over the existing one it matched, so a placeholder
// keeps everything the document doesn't speak to — its images, resolved
// place ids, scenario, journey and route — while taking the document's own
// times, flight details, seats and booking. A place is only replaced while
// the existing one still has no resolved place id. A time is only taken when
// `fields` (what the document actually said) gives it — the draft fills
// unstated ones with blankStay/blankTransit's placeholder defaults. When the
// document gives only one end of a transit (a fly-out tour's end time for
// its return flight) and the placeholder's other end would then fall on the
// wrong side of it, that other end moves too, keeping the placeholder's own
// planned duration — a return planned 3:00–4:30pm, confirmed to land by
// 2:00pm, becomes 12:30–2:00pm rather than departing after it arrives. An
// other end that's still consistent is left alone.
export function mergeDraftIntoExisting(
  fields: ExtractedFields,
  existing: Activity | Stay | Transit,
  draft: Activity | Stay | Transit,
): Activity | Stay | Transit {
  const { kind } = fields;
  const merged = structuredClone(existing);
  const keepResolved = (current: Place, incoming: Place): Place =>
    current.id || !incoming.label ? current : incoming;
  if (kind === 'transit') {
    const t = merged as Transit;
    const d = draft as Transit;
    const planned = t.departsAt && t.arrivesAt ? diffMinutesIso(t.departsAt, t.arrivesAt) : 0;
    const takeDeparture = !!fields.startAt;
    const takeArrival = !!fields.endAt && !t.routeId;
    if (takeDeparture) t.departsAt = d.departsAt;
    if (takeArrival) t.arrivesAt = d.arrivesAt;
    const inverted = !!t.arrivesAt && diffMinutesIso(t.departsAt, t.arrivesAt) <= 0;
    if (inverted && planned > 0 && takeDeparture && !takeArrival && !t.routeId) {
      t.arrivesAt = addMinutesIso(t.departsAt, planned);
    } else if (inverted && planned > 0 && takeArrival && !takeDeparture && t.arrivesAt) {
      t.departsAt = addMinutesIso(t.arrivesAt, -planned);
    }
    t.from = keepResolved(t.from, d.from);
    t.to = keepResolved(t.to, d.to);
    for (const key of TRANSIT_DETAIL_KEYS) {
      if (d[key]) t[key] = d[key];
    }
    // The draft's travelers are what the document said once it names anyone,
    // including null for "every one of us" — which must replace an older
    // restriction, not be skipped as if the document were silent.
    if (namesAnyone(fields)) t.travelers = d.travelers;
    if (d.seats?.length) t.seats = d.seats;
    if (d.bookingId) t.bookingId = d.bookingId;
    return t;
  }
  if (kind === 'stay') {
    const st = merged as Stay;
    const d = draft as Stay;
    if (fields.checkInAt) st.checkInAt = d.checkInAt;
    if (fields.checkOutAt) st.checkOutAt = d.checkOutAt;
    if (d.lodging && st.lodging) {
      const { place, ...details } = d.lodging;
      const given = Object.fromEntries(Object.entries(details).filter(([, v]) => v != null));
      st.lodging = {
        ...st.lodging,
        ...given,
        place: keepResolved(st.lodging.place, place),
      };
    } else if (d.lodging) {
      st.lodging = d.lodging;
    }
    if (d.packages?.length) st.packages = mergePackages(st.packages ?? [], d.packages);
    if (d.bookingId) st.bookingId = d.bookingId;
    return st;
  }
  const a = merged as Activity;
  const d = draft as Activity;
  if (d.startAt) {
    a.startAt = d.startAt;
    a.date = null;
    a.timeLabel = null;
    if (d.durationMinutes) a.durationMinutes = d.durationMinutes;
  }
  if (!a.text && d.text) a.text = d.text;
  // A reservation decides a meal that was still choosing between candidates:
  // a meal with options has no place or booking of its own (see
  // applyActivityForm), so leaving them would drop the reservation on Save.
  // The candidate this document books keeps its resolved place and format.
  // With no place to say which candidate (a bare "mark dinner booked"), only
  // a lone candidate is unambiguous; otherwise the candidates stay for the
  // reviewer to decide rather than all being dropped for a placeless meal.
  const options = a.options ?? [];
  const booked =
    options.find((o) => placesShare(o.place, d.place)) ??
    (!d.place && options.length === 1 ? options[0] : undefined);
  if (options.length && (booked || d.place)) {
    decideMeal(a, {
      place: booked?.place ?? a.place,
      diningFormat: booked?.diningFormat ?? a.diningFormat,
      includedIn: booked?.includedIn ?? a.includedIn,
      bookingId: a.bookingId,
    });
  }
  if (d.place && !a.place?.id) a.place = d.place;
  if (d.mealType) a.mealType = d.mealType;
  if (d.diningFormat) a.diningFormat = d.diningFormat;
  if (d.bookingId) a.bookingId = d.bookingId;
  return a;
}

// ---------- 5. Planning a whole document's import ----------
//
// Everything the assistant's import panel shows and queues, worked out in
// one pure pass: where each extracted entry lands, which existing entry it
// updates (if any), the merged-or-new entity to review, the Booking it
// points at, the notes to follow it, and any travelers the trip doesn't
// have yet. The panel only renders this and hands it to the review queue,
// re-planning whenever the reader switches an entry between updating its
// match and being added as new, since that changes which booking it builds on.
export interface PlannedImportEntry {
  fields: ExtractedFields;
  placement: { legId: string; date: string } | null; // null: no date within the trip
  draft: Activity | Stay | Transit; // as a new entry
  // The existing entry it lines up with, and that entry with the draft laid
  // over it. Present even when the reader chose "add as new", so the switch
  // can still offer the update.
  existing: { entity: Activity | Stay | Transit; merged: Activity | Stay | Transit } | null;
  updating: boolean; // existing, and the reader didn't choose "add as new"
  booking: Booking | null;
  notes: ExtractedNote[];
  // New travelers this entry names (see withDocumentTravelers) — joining
  // the trip when its review is saved.
  travelers: Traveler[];
  // A stay's bundled shuttle legs (see planIncludedTransfers).
  transfers: PlannedTransfer[];
  // Meals a transit's price covers (see planIncludedMeals).
  meals: PlannedMeal[];
}

// `addAsNew` holds the indexes of matched entries the reader chose to add
// as new instead of updating.
export function planDocumentImport(
  extraction: DocumentExtraction,
  data: Pick<TripData, 'activities' | 'stays' | 'transits' | 'trip' | 'bookings'>,
  days: DayFrame[],
  resolvedPlaces: ResolvedPlaces[],
  addAsNew: ReadonlySet<number> = new Set(),
): PlannedImportEntry[] {
  const roster = withDocumentTravelers(travelerNamesIn(extraction), data.trip.travelers);
  const { travelers } = roster;
  // Matching only looks at places, times and kind, so it runs on booking-less
  // drafts first; the bookings are then drafted on top of whatever booking
  // each updated entry already has, so an update edits that booking in place.
  const claimed = new Set<string>();
  const located = extraction.entities.map((fields, i) => {
    const placement = resolveLegAndDateForFields(fields, days);
    const resolved = resolvedPlaces[i] ?? {};
    const draftWith = (booking: Booking | null) =>
      draftEntityFromExtraction(
        fields,
        placement?.legId ?? '',
        placement?.date ?? '',
        resolved,
        travelers,
        booking,
      );
    const bare = draftWith(null);
    const existing = data[COLLECTION_FOR_KIND[fields.kind]] as (Activity | Stay | Transit)[];
    const match = placement ? findConflictCandidate(fields.kind, bare, existing, claimed) : null;
    if (match) claimed.add(match._id);
    const updating = !!match && !addAsNew.has(i);
    // An undecided meal's booking lives on the candidate this document books.
    const option =
      updating && match && 'options' in match
        ? match.options?.find((o) => placesShare(o.place, (bare as Activity).place))
        : undefined;
    const base = updating ? (bookingOf(data, option) ?? bookingOf(data, match)) : null;
    return { fields, placement, resolved, match, updating, base, draftWith };
  });
  const { bookingFor, extraNotes } = draftBookings(
    extraction,
    travelers,
    // An entry added as new never builds on its match's booking — that's the
    // match's own, and the new entry would share and overwrite it. A document
    // naming a different confirmation number is a different booking too, even
    // when its entry lines up with an existing one.
    located.map(({ fields, base }) => {
      const stated = fields.confirmationNumber?.trim();
      return base && (!stated || !base.confirmationNumber || base.confirmationNumber === stated)
        ? base
        : null;
    }),
  );
  return located.map(({ fields, placement, resolved, match, updating, draftWith }, i) => {
    const booking = bookingFor[i];
    const draft = draftWith(booking);
    const merged = match ? mergeDraftIntoExisting(fields, match, draft) : null;
    const stay = fields.kind === 'stay' ? ((updating ? merged : draft) as Stay) : null;
    const transit = fields.kind === 'transit' ? ((updating ? merged : draft) as Transit) : null;
    return {
      fields,
      placement,
      draft,
      existing: match && merged ? { entity: match, merged } : null,
      updating,
      booking,
      notes: [...(fields.noteworthy ?? []), ...(extraNotes.get(i) ?? [])],
      travelers: addedTravelersFor(fields, booking, roster),
      transfers:
        stay && placement
          ? planIncludedTransfers(fields, stay, placement.legId, resolved, data.transits)
          : [],
      meals: transit ? planIncludedMeals(fields, transit, data.activities) : [],
    };
  });
}

// One of a stay's bundled shuttle legs, queued for review after the stay.
// A leg the itinerary already has (a re-imported confirmation) updates that
// Transit's time instead of adding a second shuttle — or isn't queued at all
// when nothing changed — and its notes, already attached to it, aren't
// repeated.
export interface PlannedTransfer {
  transit: Transit;
  notes: IncludedTransferDraft['notes'];
  overrideId?: string;
}

export function planIncludedTransfers(
  fields: ExtractedFields,
  stay: Stay,
  legId: string,
  resolved: ResolvedPlaces,
  transits: Transit[],
): PlannedTransfer[] {
  const claimed = new Set<string>();
  return draftIncludedTransfers(fields, stay, legId, resolved).flatMap(
    ({ transit, notes }): PlannedTransfer[] => {
      const match = findConflictCandidate('transit', transit, transits, claimed);
      if (!match) return [{ transit, notes }];
      claimed.add(match._id);
      if (match.departsAt === transit.departsAt) return [];
      return [
        { transit: { ...match, departsAt: transit.departsAt }, notes: [], overrideId: match._id },
      ];
    },
  );
}

// A meal a transit's price includes, as a meal Activity linked to that
// transit ('included-with-transit'), served at the transit's destination
// unless the document names somewhere else. The day's existing meal of the
// same type in the same scenario — a placeholder "packed lunch" — is updated
// rather than doubled, keeping its time; anything else is added new.
export interface PlannedMeal {
  activity: Activity;
  overrideId?: string; // the existing meal this updates
}

export function planIncludedMeals(
  fields: ExtractedFields,
  transit: Transit,
  activities: Activity[],
): PlannedMeal[] {
  const date = dateOnly(transit.arrivesAt ?? transit.departsAt);
  const claimed = new Set<string>();
  return (fields.includedMeals ?? []).map(({ mealType, placeLabel }): PlannedMeal => {
    const place: Place =
      placeLabel?.trim() && placeLabel.trim() !== transit.to.label
        ? { id: null, label: placeLabel.trim() }
        : transit.to;
    const match = activities.find(
      (a) =>
        !claimed.has(a._id) &&
        a.mealType === mealType &&
        a.legId === transit.legId &&
        a.scenarioId === transit.scenarioId &&
        (a.startAt ? dateOnly(a.startAt) : a.date) === date,
    );
    const included = {
      text: null,
      place,
      diningFormat: 'included-with-transit' as const,
      includedIn: { entity: 'transit' as const, id: transit._id },
      options: null,
      bookingId: null,
    };
    if (match) {
      claimed.add(match._id);
      return { activity: { ...structuredClone(match), ...included }, overrideId: match._id };
    }
    return {
      activity: {
        ...blankActivity(transit.legId, date, transit.scenarioId),
        mealType,
        ...included,
      },
    };
  });
}
