---
name: add-trip-content
description: How to add or edit trip content (activities, meal options, weather-branch scenarios, notes, stays/transits/legs, or a whole second trip) in this itinerary site's public/data/*.json files.
---

# Adding or editing trip content

There are no per-day files to edit — add or change documents in `public/data/2027-summer-alaska/*.json` directly. See `docs/data-model.html` for the full schema; the common cases:

- **Add something happening on a date**: add a document to `activities.json` with `legId` and a real `startAt` timestamp, plus an optional `durationMinutes` (only fall back to `timeLabel` for genuinely fuzzy timing — Activity has no separate date field, so a timestamp is how it gets placed on a day). Optionally set `place` (a pinned Google Place ID, `{ id, label }`), `bookingId`, or `scenarioId`.
- **Add a still-undecided choice among a few candidates** (e.g. which restaurant for a meal): give the Activity an `options: MealOption[]` array instead of committing to one `place`/`text`. It renders as its own `MealRow` with MUI `Tabs` for switching between candidates inline, rather than as a normal single-choice `ActivityRow` — see `activeMealOptions` in `src/model/mealOptions.ts`.
- **Add a weather-branch (ideal/alternate) day**: add two documents to `scenarios.json`, then set that `scenarioId` on every `Activity`/`Transit` for that date on each branch. The day's Timeline automatically renders each distinct `scenarioId` present on a date as its own tab section (`ScenarioTabsSection`), in the JSON files' own array order (already narrative/chronological — nothing gets re-sorted by time).
- **Add a note, warning, or footnote**: add a document to `notes.json` with `concerns: Ref[]` pointing at whatever it's about. It surfaces automatically at the matching drill-down level — `entity: 'leg'` → the Leg dialog, a `date`/`dateRange`/`entity: 'stay'`/`entity: 'transit'` ref → that day's inline notes, `entity: 'scenario'` → that date's matching scenario section, `entity: 'activity'` → that activity's side sheet.
- **Add a new Stay/Transit/Leg**: add to `stays.json`/`transits.json`/`legs.json` following the existing shapes; nothing else needs updating — `tripModel.ts` picks it up automatically: a Stay for whichever dates it overlaps, a Transit for the single date it departs on (even one that arrives after midnight).
- **Add a booking/reservation**: add a document to `bookings.json` (`_id`, `status`, `confirmationNumber`, and `pricing` — either `{ kind: 'total', cost }` or, when the confirmation itemizes per traveler, `{ kind: 'perTraveler', fares: [{ travelerId, fare, ticketNumber? }] }`, never both) and set its `_id` as `bookingId` on every Leg/Stay/Transit/Activity/MealOption it pays for. One purchase covering several entries (a round-trip ticket's two flights) is ONE booking that each entry points at — never a copy per entry. Seats are per flight, so they go on each Transit's own `seats[]`, not on the booking. A booking nothing points at is dropped on the next in-app save.
- **Add a second trip**: give it its own sibling directory under `public/data/` (same file layout as `2027-summer-alaska/`) and add one `{ slug }` entry to `public/data/trips.json` so it shows up on the landing screen. `routes.json` stays shared across trips.

An Activity with only a fuzzy `timeLabel` (no `startAt` — see `data-model.html`) still needs somewhere to carry which date it's on: set its `date` field alongside `timeLabel` in that case (`tripModel.ts`'s `resolveActivityDate`).
