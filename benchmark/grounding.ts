/* eslint-disable no-console */
/**
 * Document grounding — the keyless instrument, and the authorized
 * paired baseline.
 *
 * The keyless tier always runs and is the committed report: the fixture
 * is loaded and hash-verified, the claim scorer's oracle must reach
 * exact 1.000 ceilings BEFORE anything prints, every named bad answer
 * is scored to its one terminal reason, and the report is validated
 * against `benchmark/schemas/grounding.schema.json` before Markdown is
 * rendered from it. Keyless runs are clock-free and network-free.
 *
 *   node benchmark/grounding.ts                        # keyless Markdown to stdout
 *   node benchmark/grounding.ts --json PATH --md PATH  # write the artifacts
 *   node --env-file-if-exists=.env benchmark/grounding.ts --live
 *       # print the frozen credential-free dry plan and exit 0 — ZERO calls
 *   node --env-file-if-exists=.env benchmark/grounding.ts --live --authorize <plan-id> --live-json PATH
 *       # execute exactly that plan; a mismatched id refuses before any call
 *
 * `--thinking off|default` is the run's thinking control (default: off;
 * a model whose endpoint refuses to disable reasoning needs `default`).
 * The wire cache (`benchmark/cache/wire.sqlite`) remembers every
 * embedding and completion a live run buys; a re-run replays what it
 * holds and spends only on the rest — `--cache PATH` moves it,
 * `--cache none` disables it, `--fresh` ignores reads (and changes the
 * plan id, so a purchase is never laundered as replay). `--live-json`
 * is written by an executed run and READ otherwise, so the Markdown
 * re-renders a committed live report without spending a call.
 *
 * Exit 1 with the reason when the gate fails, a report does not
 * validate, the authorization does not match, or an executed attempt
 * cannot fill the recorded one; nothing is written in those cases.
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';

import { DEFAULT_SETTINGS, chatClientFor, embedderFor } from '../apps/desktop/src/settings.ts';
import { chatSettingsOf, describeAiEnv, embedSettingsOf, envConfigIdentity, readAiEnv } from './lib/ai-env.ts';
import { parseArgs } from './lib/args.ts';
import {
  createGroundingValidator,
  loadGroundingFixture,
  renderGroundingMarkdown,
  runGroundingKeyless,
} from './lib/grounding.ts';
import {
  authorizationOf,
  countingFetch,
  describePlan,
  executeGroundingLive,
  planGroundingLive,
  type GroundingLive,
} from './lib/grounding-run.ts';
import type { GroundingWeb } from './lib/grounding-web.ts';
import { loadLocomo } from './lib/locomo.ts';
import { describeErrors, type ReportValidator } from './lib/validate.ts';
import { WIRE_CACHE_PATH, openWireCache, type WireCache } from './lib/wire-cache.ts';

const args = parseArgs(process.argv.slice(2), {
  flags: ['live', 'fresh', 'web-live', 'fresh-http'],
  values: ['json', 'md', 'live-json', 'authorize', 'thinking', 'cache', 'web-json', 'authorize-web', 'searx', 'http-capture'],
});

const validate = createGroundingValidator();

function mustValidate(name: string, check: ReportValidator, value: unknown): void {
  const outcome = check(value);
  if (outcome.valid) return;
  console.error(`the report does not validate against benchmark/schemas/${name}:`);
  for (const line of describeErrors(outcome)) console.error(`  ${line}`);
  process.exit(1);
}

const loaded = await loadGroundingFixture();
const report = await runGroundingKeyless(loaded);

if (!report.gate.oracle.passed) {
  console.error('GATE FAILED — the claim scorer is not proven, so no number is published:');
  for (const failure of report.gate.oracle.failures) console.error(`  ${failure}`);
  process.exit(1);
}
mustValidate('grounding.schema.json', validate, report);

const thinking = args.values.get('thinking') ?? 'off';
if (thinking !== 'off' && thinking !== 'default') throw new Error(`--thinking is off or default, got '${thinking}'`);

const livePath = args.values.get('live-json');
let existing: GroundingLive | null = null;
if (livePath !== undefined && existsSync(livePath)) {
  existing = JSON.parse(await readFile(livePath, 'utf8')) as GroundingLive;
  mustValidate('grounding.schema.json', validate, existing);
}

let live: GroundingLive | null = existing;

if (args.flags.has('live')) {
  const env = readAiEnv();
  if (!env.live) {
    console.error(`live tier skipped: ${env.reason}`);
  } else {
    console.error(`live tier: ${describeAiEnv(env)} · thinking ${thinking}`);
    const cachePath = args.values.get('cache') ?? WIRE_CACHE_PATH;
    const fresh = args.flags.has('fresh');
    const cache: WireCache | undefined = cachePath === 'none' ? undefined : await openWireCache({ path: cachePath });
    if (cache !== undefined) {
      const stats = await cache.stats();
      console.error(`wire cache: ${cache.path} — ${stats.embeddings} embeddings, ${stats.completions} completions remembered${fresh ? ' and ignored (--fresh)' : ''}`);
    }
    try {
      const dataset = await loadLocomo();
      const locomo = dataset.available && dataset.valid
        ? { samples: dataset.samples, sha256: dataset.sha256 }
        : null;
      const locomoSkipReason = dataset.available
        ? (dataset.valid ? undefined : 'the LoCoMo release no longer matches its schema; the stratum is skipped rather than repaired')
        : `the LoCoMo submodule is absent (${dataset.available === false ? dataset.reason : ''}); the stratum is skipped with this stated reason`;
      const context = await planGroundingLive({ env, thinking, cache, fresh, locomo, locomoSkipReason });
      for (const line of describePlan(context)) console.error(line);

      const authorize = args.values.get('authorize');
      const authorization = authorizationOf(context.plan, authorize);
      if (authorization === 'skipped') {
        console.error(`live tier skipped up front: ${context.plan.skipped}`);
      } else if (authorization === 'dry-run') {
        console.error('dry plan only — nothing was spent. Re-run with --live --authorize <plan-id> to execute exactly this plan.');
      } else if (authorization === 'refused') {
        console.error(`--authorize ${authorize} does not match the printed plan ${context.plan.planId}; nothing was spent`);
        process.exit(1);
      } else {
        if (existing !== null && !fresh) {
          if (existing.registration.registrationId !== context.registration.registrationId) {
            console.error(`the recorded attempt at ${livePath} was registered under ${existing.registration.registrationId} and this plan under ${context.registration.registrationId}; a different registration cannot fill it — run --fresh for a new attempt`);
            process.exit(1);
          }
        }
        const counted = countingFetch();
        const replay = cache?.adapter({ fresh });
        // a rate-limited call is not a wrong answer: retry for minutes;
        // thinking off is the measured setting for short extraction — unless
        // the model's endpoint refuses the control
        const retry = { attempts: 8, baseMs: 3000, maxMs: 60000 };
        const wire = { retry, fetch: counted.fetch, cache: replay, ...(thinking === 'off' ? { reasoning: { effort: 'none' as const } } : {}) };
        const chat = chatClientFor(chatSettingsOf(env), wire);
        const embedder = embedderFor({ ...DEFAULT_SETTINGS, embed: embedSettingsOf(env) }, counted.fetch, replay);
        const started = performance.now();
        const fresh2 = await executeGroundingLive(context, {
          env,
          chat,
          embedder,
          fetchCounts: counted.counts,
          tier: 'paid',
          configIdentityFor: (observed) => envConfigIdentity(env, observed),
          onProgress: (message) => console.error(`  ${message}`),
        });
        console.error(`  live tier ${(performance.now() - started).toFixed(0)} ms`);
        mustValidate('grounding.schema.json', validate, fresh2);
        live = fresh2;
        if (livePath !== undefined) await writeFile(livePath, `${JSON.stringify(live, null, 2)}\n`);
      }
    } finally {
      if (cache !== undefined) {
        const stats = await cache.stats();
        console.error(`wire cache: ${stats.embeddings} embeddings, ${stats.completions} completions remembered now`);
        await cache.close();
      }
    }
  }
}

// --- the optional captured web diagnostic: separately dated, separately
// authorized, never the gate. Missing SearxNG or authorization is a
// schema-valid stated not-run, exit 0, zero live calls.
const webPath = args.values.get('web-json');
let web: GroundingWeb | null = null;
if (webPath !== undefined && existsSync(webPath)) {
  web = JSON.parse(await readFile(webPath, 'utf8')) as GroundingWeb;
  mustValidate('grounding.schema.json', validate, web);
}
if (args.flags.has('web-live')) {
  const env = readAiEnv();
  const searxBase = args.values.get('searx') ?? null;
  const baseline = live === null ? { reportId: null, registrationId: null } : { reportId: live.reportId, registrationId: live.registration.registrationId };
  let notRunReason: string | null = null;
  if (!env.live) notRunReason = `no live wire: ${env.reason}`;
  else if (searxBase === null) notRunReason = 'no SearxNG endpoint was configured (--searx <base>)';
  if (notRunReason === null) {
    const planBody = {
      baseline,
      searxBase,
      questions: 6,
      maxSearches: 6,
      maxFetches: 6 * 3 + 1,
      maxEmbeddingRequests: 40,
      chat: { planned: 12, maxRepairs: 1, maxFreshCalls: 24 },
      wire: { provider: env.provider, model: env.model, embedModel: env.embedModel || null, keySource: env.keySource, thinking },
      maxCalls: env.maxCalls,
      concurrency: env.maxConcurrency,
      freshHttp: args.flags.has('fresh-http'),
    };
    const webPlanId = await (await import('@jarenjs/json/canonical')).canonicalSha256(planBody);
    console.error(`web plan ${webPlanId}`);
    console.error(`  ${JSON.stringify({ ...planBody, planId: undefined })}`);
    const authorized = args.values.get('authorize-web');
    if (authorized === undefined) {
      notRunReason = 'the web plan was printed and not authorized (--authorize-web <plan-id>)';
    } else if (authorized !== webPlanId) {
      console.error(`--authorize-web ${authorized} does not match the printed plan ${webPlanId}; nothing was spent`);
      process.exit(1);
    } else {
      const { openHttpCapture, HTTP_CAPTURE_PATH } = await import('./lib/http-capture.ts');
      const { runGroundingWeb } = await import('./lib/grounding-web.ts');
      const capture = await openHttpCapture({ path: args.values.get('http-capture') ?? HTTP_CAPTURE_PATH });
      try {
        const counted = countingFetch();
        const retry = { attempts: 8, baseMs: 3000, maxMs: 60000 };
        const chat = chatClientFor(chatSettingsOf(env), { retry, fetch: counted.fetch, ...(thinking === 'off' ? { reasoning: { effort: 'none' as const } } : {}) });
        const embedder = embedderFor({ ...DEFAULT_SETTINGS, embed: embedSettingsOf(env) }, counted.fetch);
        const { lookup } = await import('node:dns/promises').then((dns) => ({
          lookup: async (hostname: string) => dns.lookup(hostname, { all: true, verbatim: true }),
        }));
        web = await runGroundingWeb({
          tier: 'paid',
          provider: env.provider,
          model: env.model,
          keySource: env.keySource,
          thinking,
          chat,
          embedder,
          capture,
          replay: false,
          // narrowed above: a null base already became the not-run reason
          searxBase: searxBase!,
          lookup,
          baseline,
          maxCalls: env.maxCalls,
          concurrency: env.maxConcurrency,
          configIdentityFor: (observed) => envConfigIdentity(env, observed),
          fetchCounts: counted.counts,
          onProgress: (message) => console.error(`  ${message}`),
        });
        mustValidate('grounding.schema.json', validate, web);
        if (webPath !== undefined) await writeFile(webPath, `${JSON.stringify(web, null, 2)}\n`);
      } finally {
        await capture.close();
      }
    }
  }
  if (notRunReason !== null) {
    const { notRunGroundingWeb } = await import('./lib/grounding-web.ts');
    web = await notRunGroundingWeb(notRunReason);
    mustValidate('grounding.schema.json', validate, web);
    console.error(`web diagnostic not run: ${notRunReason}`);
    if (webPath !== undefined) await writeFile(webPath, `${JSON.stringify(web, null, 2)}\n`);
  }
}

const markdown = renderGroundingMarkdown(report, live, web);
console.log(markdown);

const jsonPath = args.values.get('json');
if (jsonPath !== undefined) await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
const mdPath = args.values.get('md');
if (mdPath !== undefined) await writeFile(mdPath, `${markdown}\n`);
