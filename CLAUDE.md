# CLAUDE.md

A read-only itinerary site for upcoming trips (currently one: 2027 Alaska). React + TypeScript + MUI, bundled with Vite, deployed to GitHub Pages by `.github/workflows/deploy.yml` on every push to `main`. No staging environment, no committed build output.

## Where truth lives

- **Content** is JSON under `public/data/<trip-slug>/`, shaped like a document database (`trips.json` indexes the trips; `routes.json` is shared reference data). There is no `Day` entity: days are computed from Stay/Transit/Activity/Note timestamps. Schema reference: `docs/data-model.html`. Data layout and migration history: `docs/README.md`.
- **Logic** is in `src/model/` (pure, no React). `tripModel.ts` loads and derives; `timeline.ts` → `liveDays.ts` builds the live day list from the reader's selections. Find things with LSP/grep, not this file.
- **Decisions that reviews keep contesting** are comments at the code they govern. If a review finding contradicts a nearby comment, the comment wins.
- Real booking documents live in the gitignored `attachments/` at the repo root. Never put anything there under `public/`: it is served publicly.

## Commands

`npm run dev`, `npm test`, `npm run validate` (lint + format:check + test + `tsc -b`; run it after any code change). If `node` is missing, `source ~/.nvm/nvm.sh`. After AI-import changes, recommend the paid `npm run check:import`.

## Rules

- Never run `git commit` or `git push` unless the user's message says to. "Ship it", "make sure it's in" and "wrap up" are not asking; stop with the change in the working tree. Ask before deleting anything.
- Use MUI components and `src/theme.ts` tokens; add icons through `materialIcon()`, never ad hoc. Lato only.
- Tests use synthetic in-memory fixtures, never real trip data or `attachments/`.
- Never pick among candidate entities by JSON array position; use a semantic field (e.g. a scenario's `tone === 'ideal'`).
- No migrations for old data shapes, and don't flag their absence. Example: the pre-split `pricing: { kind: 'total' | 'perTraveler' }` form and `withCurrentPricing` were deleted on purpose, so never add replay or load-time support for them (`docs/README.md` has the history). When a shape changes, migrate `public/data/` in the same change and record it there.
- AI tool input is untrusted: check its shape before reading it (`shapeErrors` in `src/model/proposals.ts`) and return errors the AI can fix, never throw. A new proposal field gets a shape check and a sample in the mutation test in `proposals.test.ts`.
- A rule about what a change may do lives in one shared check that every entry point (import, chat edit, day plan, apply) goes through, and its hostile case goes in the `entry point parity` test in `proposals.test.ts`. A rule added to one path only is the bug.
- Large refactors land in slices of one concern, each with `npm run validate` passing and its own review. Never review (or let a review run on) a whole multi-concern working tree.
- Comments describe the code as it is. A removed feature leaves no trace: no "earlier version", no "not persisted on purpose".
- Don't write implementation detail into this file while a design is still being iterated.

## Gotchas

- Two secret strategies coexist on purpose: the Google Places key (`src/config/places.ts`) is committed and protected by referrer/quota restriction; the Anthropic key is never committed, and is pasted once per browser into `localStorage`.
- `vite.config.ts` `base` must equal the repo name exactly (`/2027-summer-alaska/`). `npm run preview` doesn't reproduce the sub-path; smoke-test the live URL after a deploy.
- Pages source must be "GitHub Actions", not "Deploy from a branch".
- Vite Fast Refresh can silently fail after editing a file that exports both components and constants. If a UI fix doesn't show, reload the page before concluding it failed.
- After a font change, run `npm run wordmark` to rebuild `public/trippin-wordmark.svg`.
