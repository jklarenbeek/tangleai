/* eslint-disable no-console */
/**
 * LoCoMo answer path — order 16's instrument: the ceiling and the F1,
 * published together.
 *
 * The keyless tier always runs and is the committed report: the
 * scorer's gate, and per configuration the ingest census, the
 * evidence-recall ceiling at k and the model-free verbatim floor, over
 * every scorable question and over the seeded sample the live tier
 * answers. `--live` adds a real model over the same sample, through the
 * desktop's provider settings read from `.env` (see `.env.example`);
 * no key is a stated skip, and a plan that would exceed
 * `TANGLE_AI_MAX_CALLS` is skipped up front without a request.
 *
 *   node --env-file-if-exists=.env benchmark/locomo-qa.ts                  # keyless Markdown to stdout
 *   node --env-file-if-exists=.env benchmark/locomo-qa.ts --live           # + the model tier
 *   node benchmark/locomo-qa.ts --json PATH --live-json PATH --md PATH     # write the reports and the rendering
 *   node benchmark/locomo-qa.ts --questions 16 --adversarial 6 --k 10 --seed 17753
 *   node benchmark/locomo-qa.ts --samples conv-26,conv-30 --dims 128
 *   node benchmark/locomo-qa.ts --require                                  # exit 1 if the submodule is absent
 *
 * `--live-json PATH` is written when `--live` runs, and READ otherwise
 * (when the file exists), so the Markdown can be re-rendered from a
 * committed live report without spending a call.
 *
 * Exit 1 with the reason when the gate fails or a report does not
 * validate against its schema; nothing is written in either case.
 * Elapsed time goes to stderr; the keyless report carries no timing.
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';

import { JarenValidator } from '@jarenjs/validate';

import { DEFAULT_SETTINGS, chatClientFor, embedderFor } from '../apps/desktop/src/settings.ts';
import { chatSettingsOf, describeAiEnv, embedSettingsOf, readAiEnv } from './lib/ai-env.ts';
import { parseArgs } from './lib/args.ts';
import { loadLocomo } from './lib/locomo.ts';
import { renderMarkdown, runLocomoQa, runLocomoQaLive, type LiveReport } from './lib/locomo-qa.ts';
import RECALL_SCHEMA from './schemas/locomo-recall.schema.json' with { type: 'json' };
import QA_SCHEMA from './schemas/locomo-qa.schema.json' with { type: 'json' };
import LIVE_SCHEMA from './schemas/locomo-qa-live.schema.json' with { type: 'json' };

const args = parseArgs(process.argv.slice(2), {
  flags: ['require', 'live'],
  values: ['k', 'seed', 'questions', 'adversarial', 'samples', 'dims', 'json', 'live-json', 'md'],
});

const dataset = await loadLocomo();
if (!dataset.available) {
  console.log(`# LoCoMo benchmark\n\n**Skipped** — ${dataset.reason}.\n`);
  console.log('The dataset is a git submodule and is not vendored here (it is CC BY-NC 4.0).');
  console.log(`Fetch it with:\n\n    ${dataset.hint}\n`);
  process.exit(args.flags.has('require') ? 1 : 0);
}
if (!dataset.valid) {
  console.error('the release no longer matches benchmark/schemas/locomo10.schema.json — run the census; nothing is scored against a dataset that moved');
  for (const error of dataset.errors) console.error(`  ${error}`);
  process.exit(1);
}

const number = (name: string): number | undefined => {
  const raw = args.values.get(name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} needs a number, got '${raw}'`);
  return value;
};
const samples = args.values.get('samples')?.split(',').map((s) => s.trim()).filter((s) => s !== '');
const knobs = { k: number('k'), seed: number('seed'), perCategory: number('questions'), adversarial: number('adversarial'), samples };

// one validator per compiled document: a schema registered for `$ref`
// cannot also be the one compiled on the same instance
const validateKeyless = new JarenValidator({ skipErrors: false, collectErrors: true, unknownFormats: 'ignore' })
  .addSchema(RECALL_SCHEMA as Record<string, unknown>)
  .compile(QA_SCHEMA as Record<string, unknown>);
const validateLive = new JarenValidator({ skipErrors: false, collectErrors: true, unknownFormats: 'ignore' })
  .addSchema([RECALL_SCHEMA as Record<string, unknown>, QA_SCHEMA as Record<string, unknown>])
  .compile(LIVE_SCHEMA as Record<string, unknown>);

function mustValidate(name: string, validate: (value: unknown) => { valid: boolean, errors?: unknown[] }, value: unknown): void {
  const outcome = validate(value);
  if (outcome.valid) return;
  console.error(`the report does not validate against benchmark/schemas/${name}:`);
  for (const error of (outcome.errors ?? []).slice(0, 20)) console.error(`  ${JSON.stringify(error)}`);
  process.exit(1);
}

const started = performance.now();
let last = started;
const onProgress = (message: string): void => {
  const now = performance.now();
  console.error(`  ${message} — ${(now - last).toFixed(0)} ms`);
  last = now;
};

const report = await runLocomoQa(dataset, { ...knobs, dims: number('dims'), onProgress });
console.error(`  keyless tier ${(performance.now() - started).toFixed(0)} ms (diagnostic only; the report carries no timing)`);
mustValidate('locomo-qa.schema.json', validateKeyless, report);
if (!report.gate.passed) {
  console.error('GATE FAILED — the scorer is not proven, so no number is published:');
  for (const failure of report.gate.failures) console.error(`  ${failure}`);
  process.exit(1);
}

let live: LiveReport | null = null;
let liveSkipped: string | null = null;
const livePath = args.values.get('live-json');
if (args.flags.has('live')) {
  const env = readAiEnv();
  if (!env.live) {
    liveSkipped = env.reason;
    console.error(`live tier skipped: ${env.reason}`);
  } else {
    console.error(`live tier: ${describeAiEnv(env)}`);
    // a rate-limited call is not a wrong answer: retry it for minutes, not
    // seconds; and a short phrase needs no thinking — the README's measured
    // case, where `effort: 'none'` took a one-line answer from 140
    // completion tokens and 28.8 s to 2 tokens and 0.5 s
    const wire = { retry: { attempts: 6, baseMs: 2000, maxMs: 30000 }, reasoning: { effort: 'none' as const } };
    const chat = chatClientFor(chatSettingsOf(env), wire);
    const judge = chatClientFor(chatSettingsOf(env, env.modelStrong), wire);
    const embedder = embedderFor({ ...DEFAULT_SETTINGS, embed: embedSettingsOf(env) });
    const liveStarted = performance.now();
    live = await runLocomoQaLive(dataset, { env, chat, judge, embedder, thinking: 'off', ...knobs, onProgress });
    console.error(`  live tier ${(performance.now() - liveStarted).toFixed(0)} ms`);
    mustValidate('locomo-qa-live.schema.json', validateLive, live);
    if (live.plan.skipped !== null) console.error(`live tier skipped up front: ${live.plan.skipped}`);
    if (livePath !== undefined) await writeFile(livePath, `${JSON.stringify(live, null, 2)}\n`);
  }
} else if (livePath !== undefined && existsSync(livePath)) {
  live = JSON.parse(await readFile(livePath, 'utf8')) as LiveReport;
  mustValidate('locomo-qa-live.schema.json', validateLive, live);
} else {
  liveSkipped = '`--live` was not requested' + (livePath === undefined ? '' : ` and ${livePath} does not exist`);
}

const markdown = renderMarkdown(report, live, liveSkipped);
console.log(markdown);

const jsonPath = args.values.get('json');
if (jsonPath !== undefined) await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
const mdPath = args.values.get('md');
if (mdPath !== undefined) await writeFile(mdPath, `${markdown}\n`);
