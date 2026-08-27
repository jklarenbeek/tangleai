/* eslint-disable no-console */
/**
 * LoCoMo answer path — order 16's instrument, with order 17's baselines
 * in the same table: the ceiling and the F1, published together, for
 * Tangle and for every rival.
 *
 * The keyless tier always runs and is the committed report: the
 * scorer's gate, and per row the ingest census, the evidence-recall
 * ceiling at k and the model-free verbatim floor, over every scorable
 * question and over the seeded sample the live tier answers. `--live`
 * adds a real model over the same sample for the rows named by
 * `--rows` (order 16's pair when unnamed), through the desktop's
 * provider settings read from `.env` (see `.env.example`); no key is a
 * stated skip, and a plan that would exceed `TANGLE_AI_MAX_CALLS` is
 * skipped up front without a request. Six rows do not fit one ceiling,
 * so a live run MERGES into the report at `--live-json`: its rows
 * replace the rows of the same key, its run is appended, and a run
 * that would put a different model in the same table is refused.
 *
 *   node --env-file-if-exists=.env benchmark/locomo-qa.ts                  # keyless Markdown to stdout
 *   node --env-file-if-exists=.env benchmark/locomo-qa.ts --live           # + near-raw and near
 *   node --env-file-if-exists=.env benchmark/locomo-qa.ts --live --rows long-context,rag-summary
 *   node --env-file-if-exists=.env benchmark/locomo-qa.ts --live --rows long-horizon --horizon-questions 3
 *   node benchmark/locomo-qa.ts --json PATH --live-json PATH --md PATH     # write the reports and the rendering
 *   node benchmark/locomo-qa.ts --questions 16 --adversarial 6 --k 10 --seed 17753
 *   node benchmark/locomo-qa.ts --samples conv-26,conv-30 --dims 128
 *   node benchmark/locomo-qa.ts --require                                  # exit 1 if the submodule is absent
 *
 * `--live-json PATH` is written when `--live` runs (merged into what is
 * there), and READ otherwise (when the file exists), so the Markdown
 * can be re-rendered from a committed live report without spending a
 * call. `--thinking off|default` is the run's thinking control (off:
 * `reasoning.effort: none` on every answer, judgment and sub-call, the
 * measured setting for short answers; default: no control sent — the
 * only setting for a model whose endpoint refuses to disable reasoning).
 * The long-horizon row's bounds: `--horizon-questions` per category,
 * `--horizon-depth`, `--horizon-turns` per question,
 * `--horizon-subcalls`, `--call-timeout` ms, `--author-thinking`
 * default|off. The wire cache (`benchmark/cache/wire.sqlite`,
 * gitignored) remembers every embedding and every completion a live
 * run buys, so a re-run replays what it holds and spends only on the
 * rest — `--cache PATH` moves it, `--cache none` runs without one,
 * `--fresh` ignores what it holds (and still remembers what is bought),
 * and deleting the directory starts over.
 *
 * Exit 1 with the reason when the gate fails, a report does not
 * validate against its schema, or a live run cannot be merged; nothing
 * is written in any of those cases. Elapsed time goes to stderr; the
 * keyless report carries no timing.
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';

import { JarenValidator } from '@jarenjs/validate';

import { DEFAULT_SETTINGS, chatClientFor, embedderFor } from '../apps/desktop/src/settings.ts';
import { chatSettingsOf, describeAiEnv, embedSettingsOf, readAiEnv } from './lib/ai-env.ts';
import { parseArgs } from './lib/args.ts';
import { loadLocomo } from './lib/locomo.ts';
import {
  DEFAULT_LIVE_ROWS,
  HORIZON_DEFAULTS,
  mergeLiveReports,
  renderMarkdown,
  runLocomoQa,
  runLocomoQaLive,
  type HorizonOptions,
  type LiveReport,
} from './lib/locomo-qa.ts';
import { WIRE_CACHE_PATH, cachedChatClient, openWireCache, type WireCache } from './lib/wire-cache.ts';
import RECALL_SCHEMA from './schemas/locomo-recall.schema.json' with { type: 'json' };
import QA_SCHEMA from './schemas/locomo-qa.schema.json' with { type: 'json' };
import LIVE_SCHEMA from './schemas/locomo-qa-live.schema.json' with { type: 'json' };

const args = parseArgs(process.argv.slice(2), {
  flags: ['require', 'live', 'fresh'],
  values: [
    'k', 'seed', 'questions', 'adversarial', 'samples', 'dims', 'json', 'live-json', 'md', 'rows',
    'thinking', 'horizon-questions', 'horizon-depth', 'horizon-turns', 'horizon-subcalls', 'call-timeout', 'author-thinking', 'cache',
  ],
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
const list = (name: string): string[] | undefined => args.values.get(name)?.split(',').map((s) => s.trim()).filter((s) => s !== '');
const samples = list('samples');
const knobs = { k: number('k'), seed: number('seed'), perCategory: number('questions'), adversarial: number('adversarial'), samples };
const thinking = args.values.get('thinking') ?? 'off';
if (thinking !== 'default' && thinking !== 'off') throw new Error(`--thinking is off or default, got '${thinking}'`);
const authorThinking = args.values.get('author-thinking') ?? HORIZON_DEFAULTS.authorThinking;
if (authorThinking !== 'default' && authorThinking !== 'off') throw new Error(`--author-thinking is default or off, got '${authorThinking}'`);
const horizon: Partial<HorizonOptions> = {
  ...(number('horizon-questions') === undefined ? {} : { perCategory: number('horizon-questions') }),
  ...(number('horizon-depth') === undefined ? {} : { depth: number('horizon-depth') }),
  ...(number('horizon-turns') === undefined ? {} : { turnsPerQuestion: number('horizon-turns') }),
  ...(number('horizon-subcalls') === undefined ? {} : { maxSubcalls: number('horizon-subcalls') }),
  ...(number('call-timeout') === undefined ? {} : { callTimeoutMs: number('call-timeout') }),
  authorThinking,
};

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

const livePath = args.values.get('live-json');
let existing: LiveReport | null = null;
if (livePath !== undefined && existsSync(livePath)) {
  existing = JSON.parse(await readFile(livePath, 'utf8')) as LiveReport;
  mustValidate('locomo-qa-live.schema.json', validateLive, existing);
}

let live: LiveReport | null = existing;
let liveSkipped: string | null = null;
if (args.flags.has('live')) {
  const env = readAiEnv();
  if (!env.live) {
    liveSkipped = env.reason;
    console.error(`live tier skipped: ${env.reason}`);
  } else {
    const rows = list('rows') ?? [...DEFAULT_LIVE_ROWS];
    console.error(`live tier: ${describeAiEnv(env)} · rows ${rows.join(', ')}`);
    // a rate-limited call is not a wrong answer: retry it for minutes, not
    // seconds; and a short phrase needs no thinking — the README's measured
    // case, where `effort: 'none'` took a one-line answer from 140
    // completion tokens and 28.8 s to 2 tokens and 0.5 s — unless the run
    // says `--thinking default`, for a model whose endpoint refuses the
    // control (a 400, not a slower answer)
    const retry = { attempts: 8, baseMs: 3000, maxMs: 60000 };
    const wire = { retry, ...(thinking === 'off' ? { reasoning: { effort: 'none' as const } } : {}) };
    // the wire cache: what an earlier run bought under the same model and
    // thinking control is replayed, counted and never spent
    const cachePath = args.values.get('cache') ?? WIRE_CACHE_PATH;
    const freshRun = args.flags.has('fresh');
    const cache: WireCache | undefined = cachePath === 'none' ? undefined : await openWireCache({ path: cachePath });
    if (cache === undefined) console.error('wire cache: none — every call is bought');
    else {
      const stats = await cache.stats();
      console.error(`wire cache: ${cache.path} — ${stats.embeddings} embeddings, ${stats.completions} completions remembered${freshRun ? ' and ignored (--fresh)' : ''}`);
    }
    const remembered = <C extends { endpoint: { provider: string, base?: string, model: string } & Record<string, unknown>, complete: (request: any) => Promise<any> }>(client: C, defaults?: { reasoning?: unknown }): C =>
      (cache === undefined ? client : cachedChatClient<C>(client, cache, { fresh: freshRun, defaults }));
    const chat = remembered(chatClientFor(chatSettingsOf(env), wire), { reasoning: wire.reasoning });
    const judge = remembered(chatClientFor(chatSettingsOf(env, env.modelStrong), wire), { reasoning: wire.reasoning });
    // the long-horizon agent PLANS in its authoring call, and the suite's
    // measured finding is that thinking off wrecks planning — so its client
    // keeps the model's default there; sub-calls are extraction and the
    // harness sets the run's thinking control on them per request
    const horizonClient = remembered(chatClientFor(chatSettingsOf(env), { retry }));
    const embedder = embedderFor({ ...DEFAULT_SETTINGS, embed: embedSettingsOf(env) });
    const liveStarted = performance.now();
    let fresh: LiveReport;
    try {
      fresh = await runLocomoQaLive(dataset, { env, chat, judge, embedder, horizonClient, cache, fresh: freshRun, thinking, rows, horizon, ...knobs, onProgress });
    } finally {
      if (cache !== undefined) {
        const stats = await cache.stats();
        console.error(`wire cache: ${stats.embeddings} embeddings, ${stats.completions} completions remembered now`);
        await cache.close();
      }
    }
    console.error(`  live tier ${(performance.now() - liveStarted).toFixed(0)} ms`);
    mustValidate('locomo-qa-live.schema.json', validateLive, fresh);
    const skipped = fresh.runs[0]?.plan.skipped ?? null;
    if (skipped !== null) {
      console.error(`live tier skipped up front: ${skipped}`);
      // nothing was spent and nothing is merged; the rendering says so when there is no earlier table to show
      if (existing === null) live = fresh;
    } else {
      try {
        live = mergeLiveReports(existing, fresh);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
      mustValidate('locomo-qa-live.schema.json', validateLive, live);
      if (livePath !== undefined) await writeFile(livePath, `${JSON.stringify(live, null, 2)}\n`);
    }
  }
} else if (existing === null) {
  liveSkipped = '`--live` was not requested' + (livePath === undefined ? '' : ` and ${livePath} does not exist`);
}

const markdown = renderMarkdown(report, live, liveSkipped);
console.log(markdown);

const jsonPath = args.values.get('json');
if (jsonPath !== undefined) await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
const mdPath = args.values.get('md');
if (mdPath !== undefined) await writeFile(mdPath, `${markdown}\n`);
