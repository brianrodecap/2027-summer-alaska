// `npm run check:import` — the real document import (proposalImport.ts), run on
// every booking document listed in attachments/expected.json, judged against
// what a person entered from it (see goldenCheck.ts). Live Claude and Google
// Places calls, so it needs ANTHROPIC_API_KEY and GOOGLE_API_KEY in the
// environment, costs about a quarter per document, and never runs in `npm test`.
// The keys live in gitignored files at the repo root:
//   ANTHROPIC_API_KEY="$(cat trippin-api-key-claude.txt)" \
//   GOOGLE_API_KEY="$(cat trippin-api-key-google.txt)" npm run check:import
//   IMPORT_CHECK_ONLY=<part of a file name>[,<another>] runs just those documents
//   IMPORT_MODEL / IMPORT_EFFORT read with another model or effort, to compare
//
// Writes, next to the private documents (gitignored, never published):
//   attachments/import-check/<document>.json — what Claude proposed, what the
//     checks turned down, the notes it offered, and every finding
//   attachments/import-check/report.md — the summary of the last run
//   attachments/import-check/runs.csv — one row per run: when, which approach
//     (STRATEGIES.md beside it), documents passed, time, tokens and cost
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { MODEL_ID } from '../model/anthropicClient';
import { importByProposals } from '../model/proposalImport';
import { buildTripView, todayDateStr, TRIP_FILES } from '../model/tripModel';
import type { TripData } from '../model/types';
import {
  checkDocument,
  type Finding,
  type GoldenDocument,
  placeholderData,
  saveQueue,
} from './goldenCheck';

const ROOT = process.cwd();
const ATTACHMENTS = join(ROOT, 'attachments');
const OUTPUT = join(ATTACHMENTS, 'import-check');
const DEFAULT_TRIP = '2027-summer-alaska';
const MEDIA_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.rtf': 'text/rtf',
  '.txt': 'text/plain',
  '.eml': 'message/rfc822',
};

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// A trip from the site's data, or a private test trip kept beside the
// documents (attachments/trips/<slug>/) for bookings no real trip holds yet.
function loadTrip(slug: string): TripData {
  const testTrip = join(ATTACHMENTS, 'trips', slug);
  const dir = existsSync(testTrip) ? testTrip : join(ROOT, 'public', 'data', slug);
  const files = Object.fromEntries(
    TRIP_FILES.map((name) => [name, readJson(join(dir, `${name}.json`))]),
  );
  return { ...files, routes: readJson(join(ROOT, 'public', 'data', 'routes.json')) } as TripData;
}

function describeFinding(f: Finding): string {
  return `- **${f.where}** — expected \`${JSON.stringify(f.expected)}\`, got \`${JSON.stringify(f.actual)}\``;
}

const golden = readJson(join(ATTACHMENTS, 'expected.json')) as Record<string, GoldenDocument>;
const hasKeys = Boolean(process.env.ANTHROPIC_API_KEY && process.env.GOOGLE_API_KEY);
// IMPORT_CHECK_ONLY=<part of a file name>[,<another>] runs just those documents.
const only = process.env.IMPORT_CHECK_ONLY?.toLowerCase().split(',').filter(Boolean) ?? [];
const documents = Object.entries(golden).filter(
  ([name]) => !only.length || only.some((part) => name.toLowerCase().includes(part)),
);
const results: { name: string; findings: Finding[]; seconds: number }[] = [];
// IMPORT_MODEL picks the model the proposals import reads with (default: the
// app's own, MODEL_ID) — see PRICES for the ones a run can price.
const MODEL = process.env.IMPORT_MODEL ?? MODEL_ID;
// IMPORT_EFFORT sets the effort (default low, the app's own).
const EFFORT = (process.env.IMPORT_EFFORT ?? 'low') as 'low' | 'medium' | 'high';
// The approach this run measures — see STRATEGIES.md.
const STRATEGY = `S4 proposals (${MODEL}, effort ${EFFORT})`;
const usage = { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

// US$ per million tokens: input, output, cache read; a cache write costs
// 1.25× input. Opus 5.5 and Sonnet 5.5 from the API docs' model list; Haiku
// 4.5 isn't listed there, so its figures are the published $1/$5.
// takesEffort: whether the model accepts the effort setting (the Models API's
// capabilities; Haiku 4.5 doesn't).
const PRICES: Record<
  string,
  { input: number; output: number; cacheRead: number; takesEffort: boolean }
> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, takesEffort: true },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, takesEffort: true },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, takesEffort: false },
};
const TAKES_EFFORT = PRICES[MODEL]?.takesEffort ?? true;

function runCost(): string {
  const price = PRICES[MODEL];
  if (!price || !usage.input) return '';
  const dollars =
    (usage.input * price.input +
      usage.cacheWrite * price.input * 1.25 +
      usage.cacheRead * price.cacheRead +
      usage.output * price.output) /
    1e6;
  return dollars.toFixed(2);
}

describe('importing each booking document gives what a person entered', () => {
  it('has the Anthropic and Google API keys to import with', () => {
    expect(hasKeys, 'Set ANTHROPIC_API_KEY and GOOGLE_API_KEY to run the import check.').toBe(true);
  });

  for (const [name, doc] of documents) {
    it.skipIf(!hasKeys)(name, async () => {
      const started = Date.now();
      const data = placeholderData(loadTrip(doc.trip ?? DEFAULT_TRIP), doc);
      const view = buildTripView(data, todayDateStr());
      const file = new File([readFileSync(join(ATTACHMENTS, name))], name, {
        type: MEDIA_TYPES[extname(name).toLowerCase()] ?? '',
      });
      // An import that fails outright (an API error, no credit left) is still
      // a run, recorded as such rather than vanishing from runs.csv.
      let run: Awaited<ReturnType<typeof importByProposals>>;
      try {
        run = await importByProposals(file, data, view, {
          model: MODEL,
          effort: TAKES_EFFORT ? EFFORT : null,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({
          name,
          findings: [{ where: 'import', expected: 'a result', actual: message }],
          seconds: (Date.now() - started) / 1000,
        });
        throw err;
      }
      usage.requests += run.requests;
      usage.input += run.tokens.input;
      usage.output += run.tokens.output;
      usage.cacheRead += run.tokens.cacheRead;
      usage.cacheWrite += run.tokens.cacheWrite;
      const record = {
        proposals: run.proposals,
        notes: run.notes,
        rejected: run.rejected,
        requests: run.requests,
        tokens: run.tokens,
      };
      const { data: after, notes } = saveQueue(data, run.queue);
      const findings = checkDocument(data, after, notes, doc);

      results.push({ name, findings, seconds: (Date.now() - started) / 1000 });
      mkdirSync(OUTPUT, { recursive: true });
      writeFileSync(
        join(OUTPUT, `${name}.json`),
        `${JSON.stringify({ strategy: STRATEGY, ...record, savedNotes: notes, findings }, null, 2)}\n`,
      );
      expect(findings.map(describeFinding).join('\n')).toBe('');
    });
  }

  afterAll(() => {
    if (!results.length) return;
    const passed = results.filter((r) => !r.findings.length).length;
    const sections = results.map(({ name, findings }) =>
      findings.length
        ? `## ✗ ${name}\n\n${findings.map(describeFinding).join('\n')}`
        : `## ✓ ${name}`,
    );
    mkdirSync(OUTPUT, { recursive: true });
    writeFileSync(
      join(OUTPUT, 'report.md'),
      `# Import check — ${STRATEGY} — ${passed} of ${results.length} documents match\n\n${sections.join('\n\n')}\n`,
    );
    const runs = join(OUTPUT, 'runs.csv');
    if (!existsSync(runs)) {
      writeFileSync(
        runs,
        'when,strategy,passed,of,seconds per document,failed,requests,tokens in,tokens out,cache read,cache write,cost USD\n',
      );
    }
    const failed = results.filter((r) => r.findings.length).map((r) => r.name);
    const seconds = results.map((r) => `${r.name}=${r.seconds.toFixed(0)}`).join(' ');
    appendFileSync(
      runs,
      `${new Date().toISOString()},"${STRATEGY}",${passed},${results.length},"${seconds}","${failed.join(' ')}",${usage.requests},${usage.input || ''},${usage.output || ''},${usage.cacheRead || ''},${usage.cacheWrite || ''},${runCost()}\n`,
    );
  });
});
