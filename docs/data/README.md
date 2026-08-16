# docs/data/

The document-database-shaped trip data model that `docs/index.html` renders directly — this is the single source of truth for the itinerary's content. It started as a from-scratch migration of an earlier hand-authored, one-file-per-day version of the site (see the Migration notes below), but that older presentation is gone now; `docs/js/trip-model.js` reads these JSON files at runtime and computes everything the presentation tier needs from them.

This directory lives under `docs/` (rather than a repo-root `data/`) only because GitHub Pages serves `docs/` and nothing outside it — see the note on `attachments/` below for the one thing that was deliberately kept out.

See **[data-model.html](./data-model.html)** for the full entity-by-entity reference (open it in a browser — it's a standalone page). This README is just orientation.

## Guiding principles

1. **Owned vs. referenced.** Most entities exist only because this trip exists (Trip, Leg, Stay, Transit, Activity, Scenario, Note). Two don't — `Place` and `Route` are reusable knowledge a trip merely points at, never owns.
2. **Declare your own bounds.** Every trip-owned entity states its own date or time range and points *up* to its parent by id (`legId`, `tripId`). Nothing stores a list of its children, and nothing stores a back-reference either.
3. **Derive, don't store.** Anything computable from stored facts stays uncomputed until read. The clearest example: there is no `Day` collection here at all — "what's happening on a date" is a query over `Stay`/`Transit`/`Activity`/`Note`, not a document.
4. **Plan status and booking status are independent.** Every trip-owned entity carries its own `status` (`planning`/`active`/`completed`/`cancelled`) regardless of money. A separate, optional `booking` (`status`/`cost`/`confirmationNumber`) exists only when an actual reservation applies — absent for a free campsite or a drive in your own car.
5. **`Ref` generalizes annotation.** `Note` attaches to whatever it concerns — an entity, a date, or a date range — through a small polymorphic `Ref`, rather than living inside the thing it annotates. It's also how the current site's footnotes and inline warning callouts unify into one mechanism.
6. **Every entity carries its own `images` list.** A flat `images: Image[]` (`{ uri, credit, caption }`) on every entity, including `Place` — the live Google Places lookup this site uses deliberately skips photos (that's an Enterprise+Atmosphere-tier field), so a stored image is the only way a Place gets one at all. A list rather than one field, so a hand-sourced reference photo and later personal trip photos can sit side by side without a schema change. Deliberately not derived through a Place reference: an Activity or Stay can carry photos different from its Place's, and entities with no Place at all (Trip, Leg, Scenario, Note) still get a home for their own.

## Layout

```
docs/data/
  README.md            — this file
  data-model.html       — full entity reference (open in a browser)
  trips.json             — the trips index: just [{ slug }, ...], one entry per
                            sibling directory below. The site's landing screen
                            reads this, then each trip's own trip.json for the
                            name/dates/status shown on that trip's list card —
                            nothing about a trip is duplicated into the index.
  routes.json           — reference data: reusable named routes (empty here — nothing
                           in the source itinerary describes a genuine route alternative)
  2027-summer-alaska/    — this trip's own data, one JSON file per collection
    trip.json            — single Trip document
    legs.json            — the parks leg and the cruise leg
    stays.json            — lodging reservations
    transits.json          — point-to-point movement (drives, flights)
    activities.json         — the individual things that happen
    scenarios.json           — named ideal/alternate weather contingencies
    notes.json                — warnings, footnotes, and asides, each pointing at
                                 whatever it concerns via `concerns: Ref[]`
```

A second trip gets its own sibling directory next to `2027-summer-alaska/`, plus one more `{ slug }` entry in `trips.json` so it shows up on the landing screen; `routes.json` stays shared, since routes aren't owned by any one trip.

Real booking documents (names, confirmation numbers, passenger tables) are kept in a separate `attachments/` at the **repo root** — deliberately outside `docs/`, so they're never served by GitHub Pages, and gitignored so they're never committed to this public repo either. Only the facts already hydrated from them into the JSON collections here are public; see "Cruise booking documents" below for exactly what was pulled and what was left out.

## Migration notes

This started as a faithful migration of an earlier hand-authored `docs/days/*.js` (one file per day) and the footnotes in `docs/index.html` — every activity, note, and stay traces back to that original itinerary, not a content redesign. That older per-day presentation has since been replaced entirely by the computed views `docs/js/trip-model.js` derives from this data, but the migration record below is kept as-is since it documents real decisions made about the data, not the presentation. A few things were necessarily synthesized rather than sourced, since the original data only ever had dates and prose, not a document schema:

- **Check-in/checkout times** on `Stay` use a `15:00` in / `11:00` out convention where the source only gave a date.
- **Consecutive days at the same named hotel** were collapsed into one `Stay` spanning the full range; a repeat visit to the same hotel later in the trip (Hotel Captain Cook, visited twice) became two separate `Stay` documents, since they aren't a contiguous occupancy.
- **`Transit` was created only where the source explicitly describes movement between two named places with an approximate clock time** — most days don't get one. Two drives were deliberately left unmodeled (the Jun 26 arrival drive and the Jul 1 Coldfoot→Fairbanks drive) because either no clock time was given, or the timing is scenario-dependent and `Transit` has no field for that yet — see the full migration report for detail.
- **`routes.json` is empty.** Nothing in the source describes more than one way to get somewhere, so no `Route` documents were fabricated to demonstrate the entity.

### Cruise booking documents (Aug 2026)

`leg_cruise`, `stay_cruise`, `trip.travelers`, and two `Activity` timestamps were hydrated from the real Princess booking confirmation and deposit confirmation in `attachments/` at the repo root (booking `MWVV6Q`) — see the note above on why those PDFs themselves live outside `docs/`. Everything from those PDFs mapped onto existing fields except:

- **`Trip.travelers[].age`** — the booking confirmation's passenger table was the first source with ages at all; added as a lightweight extension of the existing name-only stub, not the fuller per-traveler identity floated in `data-model.html`'s Open threads.
- **`Leg.booking.depositPaidAt` / `finalPaymentDueAt` / `passengers[]`** — the deposit/final-payment split and per-passenger fare breakdown had no home in the existing three-field `booking` shape, so those fields were added there. Only `leg_cruise` uses them; every other booking on the site is unaffected.
- **`Stay.lodging.bedConfiguration` / `deckGroup` / `shipZone`** — cabin-specific facts a hotel or campsite `Stay` never needs, added alongside the existing `roomType`/`roomNumber` using the same "type-specific detail a Place can't carry" rationale.
- **Cancellation schedule, payment terms, and the Princess Premier package inclusions** didn't fit any stored field at all and became three new `notes.json` entries (`note_cruise_payment_schedule`, `note_cruise_cancellation_schedule`, `note_cruise_premier_package`), all concerning `leg_cruise` — the same `Ref`-based annotation mechanism already used for warnings and footnotes elsewhere.
- **Deliberately left out**: Princess Captain's Circle member numbers and the on-file phone number. Both are account identifiers with no itinerary value, and `data/` is committed to a git repo that backs a public GitHub Pages site — not worth the exposure for data nothing here would ever display.

### Third-party hotel booking (Aug 2026)

A Capital One Travel reservation confirmation for Hotel Pacific (Monterey, CA — a different trip, parsed to pressure-test this schema, deliberately not migrated into this repo's data) was tested against `Stay`. Most of it landed on existing fields — room type onto `lodging.roomType`, the "no check-in after 1am"/18+ policy onto `lodging.checkInInstructions`, the tiered cancellation schedule onto a `Note` concerning the `Stay`, same mechanism as the cruise's and the campsite's cancellation schedules. One gap surfaced and one field was added:

- **`Stay.booking.bookedThrough`** — this reservation's only confirmation number (`H-MR3H7GQVN49P`) belongs to Capital One Travel, the booking agent, not to Hotel Pacific itself; the existing `confirmationNumber` field implicitly assumed a vendor-issued code. Added as a flat optional string, present only when a reservation went through a third-party agent, absent for a direct booking. *Retroactively updated by the flight test below*: once a real booking showed up with two live confirmation codes at once, `bookedThrough` was promoted from a bare string to `{ name, confirmationNumber }`, and this example's own code moved into it — `confirmationNumber` at the top level is now `null` here, since no separate hotel-native code was ever given.
- **Cost stayed a flat total, not a line-item breakdown.** The confirmation itemizes room cost, taxes & fees, and a travel-credit adjustment down to the Due Today total — tested against `booking.cost` and confirmed the existing flat `{ amount, currency }` shape is sufficient; no change needed.
- **Deliberately left out**: the payment card used (masked number, expiry). Same reasoning as the cruise test's Captain's Circle numbers — an account identifier with no itinerary value, not worth storing in a public repo.
- Property-level policies that aren't specific to this reservation — the age-18 check-in requirement, parking/pet fee schedules — were left unmodeled entirely rather than forced onto `Stay` or `lodging`. They're facts about the hotel, not the booking, and fit the same "resolved live, never stored" territory `Place` already claims for hours/address/website — not worth a schema change to prove that on a property this model doesn't otherwise reference.

### Ferry reservation (Aug 2026)

A Catalina Express order confirmation — two one-way ferry sailings, Long Beach↔Avalon, order `FPLZAS` (a different trip, parsed to pressure-test this schema, deliberately not migrated into this repo's data) — was tested against `Transit`. Most of it confirmed the existing shape rather than changing it: each sailing's own confirmation number (`345607334`/`345607341`) maps onto `booking.confirmationNumber`, the same order-vs-item split already seen in the campsite test — the order-level code is never a stored field. The 4-passenger fare split reused `booking.passengers[]` unmodified, the first proof that the extension added for the cruise isn't cruise-specific. `mode: 'ferry'` needed no schema change, since `mode` was always a free string, not a closed enum. And the tiered cancellation-fee schedule (free outside 48h, a per-ticket fee inside it, no refund on a no-show) mapped onto a `Note` concerning the `Transit` — the first populated use of `transit` in `Ref`'s entity union, which existed in the type already but had nothing using it. One real gap surfaced:

- **`Transit.from`/`to` gained `placeId`**, matching `Route.from`/`to`'s existing shape. The two ferry terminals (Long Beach Landing, Avalon Landing) are genuinely resolvable points, unlike the original Transit example's city-level `Anchorage`/`Whittier` — `placeId` stays `null` for an endpoint that really is a whole city or highway junction with no one correct pin. `Place`'s "reused everywhere a real point is needed" list in `data-model.html` now includes Transit's `from`/`to` alongside Activity's `place`, Stay's `lodging`, and Route's `from`/`to`/`waypoints`.
- **Deliberately left out**: a one-off intake-form question from the booking flow ("Is anyone in your party a scuba diver?"). It's specific to this operator's reservation form, not a fact that generalizes across bookings — if it ever mattered, it would be a `Note` concerning the `Transit` like any other booking-specific aside, not a new typed field.

### Flight reservation (Aug 2026)

A Capital One Travel flight confirmation — Delta DL479, Boston→Los Angeles, June 6 2026, 4 named passengers (a different trip, parsed to pressure-test this schema, deliberately not migrated into this repo's data) — was tested against `Transit`. Several already-established extensions covered it unchanged: `from`/`to`'s `placeId` (added for the ferry) pins BOS/LAX exactly as designed, and `booking.passengers[]` (added for the cruise) covered the fare split across all 4 travelers. The "cancel by 11:59pm ET the next business day or it's non-refundable" policy mapped onto a `Note` concerning the `Transit`, same as every other cancellation schedule so far. Three real gaps surfaced:

- **`Transit.carrier`/`flightNumber`** — mode-specific facts about which flight actually moved you, added directly on `Transit` rather than `booking`, since you could know a flight number without ever booking through this record. Same "detail the shared shape can't carry" reasoning already used for `Stay.lodging.bedConfiguration`/`campsite`, just gated by `mode` instead of a lodging type.
- **`booking.passengers[].ticketNumber`/`seat`** — a flight, unlike the ferry, hands each passenger their own e-ticket number and (when selected) a seat assignment. Both extend the per-passenger entry as optional fields, populated only when actually known.
- **`booking.bookedThrough` promoted from a flat string to `{ name, confirmationNumber }`** — this is the first booking with two live confirmation codes at once: Delta's own PNR (`F7AJLC`, what the airline needs for check-in) and Capital One Travel's separate order code (`H-IPMCIF`, what manages the booking through the agent). A single `confirmationNumber` field couldn't hold both, so `bookedThrough` gained its own; `confirmationNumber` now consistently means the vendor's own code. The Hotel Pacific example above was retroactively updated to the same shape.

### images, for usability (Aug 2026)

Every entity gained a flat `images: Image[]` — Trip, Leg, Stay, Transit, Route, Place, Activity, Scenario, and Note all carry one now. Two things drove the design:

- **Flat and per-entity, not derived through a Place reference.** Several entities already point at a `Place` (`Stay.lodging.placeId`, `Transit.from`/`to`, `Activity.place`, `Route.from`/`to`/`waypoints`), which could in principle be the one place an image lives. Rejected in favor of duplication: an `Activity` should be able to show a photo different from its `Place`'s (a specific dish vs. the restaurant's storefront), and `Trip`/`Leg`/`Scenario`/`Note` reference no `Place` at all, so they'd have nowhere to hang an image on otherwise.
- **`Place` needed one too.** The live Google Places lookup this site already uses (`docs/js/places.js`) deliberately excludes photos — that field sits behind the paid Enterprise+Atmosphere tier — so a stored `images` list is the only way a `Place` ever gets a picture at all, live-fetched or not.
- **A list, not a single field.** Started as a single `imageUri: string | null`; changed to `images: Image[]` (`{ uri, credit, caption }`) before any photo had been hydrated, once it was clear this needed to hold both a hand-sourced reference photo *now* and real personal photos taken on the trip itself *later* — the same entity ends up with both over time, not a replacement of one by the other.
- **`Activity.place`, the one embedded Place shape with real data in this trip**, got `images` added to each populated `place: { id, label }` object alongside the top-level Activity field, matching the extended `Place` shape in `data-model.html`. `Route`'s `from`/`to`/`waypoints` use the same shape but weren't touched, since `routes.json` is still empty.

### Hydrating images (Aug 2026)

The `images` fields added above were then actually populated — real, verified photo URLs, not placeholders. 67 distinct real-world subjects cover the whole trip once repeats collapse (every "check into Westmark Fairbanks" activity reuses that one hotel photo, every Dalton Highway drive reuses that one highway photo, etc.); 61 of the 67 were found and verified, landing on 145 of the 204 `images` fields across the JSON files.

- **Wikimedia Commons first, business site as fallback** — per the sourcing approach agreed on: national parks, glaciers, highways, and well-known landmarks came from Commons (`Special:FilePath` links, mostly NPS/USFWS public domain or CC BY/BY-SA requiring the credited photographer's name in `credit`); small local businesses with no Commons presence (most of the Talkeetna restaurants, tour operators, a few of the lodges) fell back to a direct photo from the business's own official website, credited `"Courtesy of <Business Name>"`.
- **Every URL was fetched and confirmed to return real image bytes before being stored** — nothing here is a guessed Commons filename or an unverified link.
- **6 subjects stayed unhydrated** (`images: []`, same as before): Talkeetna Alaskan Lodge, Hotel Captain Cook, Nullaqvik Hotel, Flying Squirrel Bakery Cafe, AK Sled Dog Tours, and the George I. Ashby Memorial Museum. None had a Commons presence, and their official sites either had no usable photo, redirected to a domain-parking page, or couldn't be confirmed as the right business. These are exactly the kind of gap the `images: Image[]` list (rather than a single required field) is meant to absorb later — a personal trip photo slots in the same way a sourced one would.
- **Applying 204 field updates without disturbing the rest of each file's hand-tuned formatting** (this repo keeps small value-objects like `booking`/`lodging` on one compact line rather than one-key-per-line) ruled out a full JSON parse-mutate-reserialize — a general formatter reintroduces exactly the kind of reflow a normal pretty-printer does. Instead, each `"images": []` occurrence was replaced in place, in document order, by walking the parsed structure depth-first — which also turned out to matter for a reason beyond formatting: activities.json picked up an unrelated concurrent schema change (a breakfast `options[]` structure with its own nested `place.images`) partway through this work, and a naive "assume N images fields per entity" script silently misaligned two entries against it. The depth-first walk fixed that by construction — it finds every `images` key wherever it actually appears, rather than assuming a shape — and a hard check (parsed occurrences must equal literal-text occurrences, or the file is skipped rather than written) guards against the same class of bug recurring unnoticed.
