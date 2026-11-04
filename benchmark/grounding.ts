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
 *   node --env-file-if-exists=.env benchmark/grounding.ts --web-live --searx <base> --live-json PATH
 *       # print the web diagnostic's plan — ZERO calls; `--authorize-web <plan-id> --web-json PATH` buys it;
 *       # `--web-structured json_schema|json|none` sets the model's structured-output tier (repeat it on replay)
 *   node --env-file-if-exists=.env benchmark/grounding.ts --web-replay --web-json PATH --live-json PATH
 *       # rebuild the recorded web run from its captures with ZERO network calls; exit 1 unless
 *       # the rebuilt report identity equals the recorded one
 *
 * The web run records its HTTP exchanges in the capture (`--http-capture`),
 * its name resolutions beside it, and its model calls in the wire cache, so
 * the replay answers every request from what the run bought.
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
  flags: ['live', 'fresh', 'web-live', 'fresh-http', 'web-replay'],
  values: ['json', 'md', 'live-json', 'authorize', 'thinking', 'cache', 'web-json', 'authorize-web', 'searx', 'http-capture', 'web-structured'],
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
const baselineOf = (flat: GroundingLive | null) => flat === null
  ? { reportId: null, registrationId: null }
  : { reportId: flat.reportId, registrationId: flat.registration.registrationId };
const webCachePath = args.values.get('cache') ?? WIRE_CACHE_PATH;
// the web row's structured-output tier, when the model's is not the
// provider preset's: Anthropic models refuse the answer schema's `oneOf`,
// so `none` sends the schema in the prompt and validation stays local
const webStructuredFlag = args.values.get('web-structured');
if (webStructuredFlag !== undefined && !['json_schema', 'json', 'none'].includes(webStructuredFlag))
  throw new Error(`--web-structured is json_schema, json or none, got '${webStructuredFlag}'`);
const webStructured = webStructuredFlag === undefined ? undefined
  : webStructuredFlag === 'none' ? null : webStructuredFlag as 'json_schema' | 'json';
if (args.flags.has('web-live') && args.flags.has('web-replay')) {
  console.error('--web-replay rebuilds a recorded web run; it does not combine with --web-live');
  process.exit(1);
}
if (args.flags.has('web-live')) {
  const env = readAiEnv();
  const searxBase = args.values.get('searx') ?? null;
  const baseline = baselineOf(live);
  const fresh = args.flags.has('fresh');
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
      wire: { provider: env.provider, model: env.model, embedModel: env.embedModel || null, keySource: env.keySource, thinking, structured: webStructuredFlag ?? 'preset' },
      maxCalls: env.maxCalls,
      concurrency: env.maxConcurrency,
      freshHttp: args.flags.has('fresh-http'),
      wireCache: webCachePath === 'none' ? null : { path: webCachePath, fresh },
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
      const { dnsLogPathOf, recordingLookup, writeDnsLog } = await import('./lib/dns-capture.ts');
      const capturePath = args.values.get('http-capture') ?? HTTP_CAPTURE_PATH;
      const capture = await openHttpCapture({ path: capturePath });
      const cache = webCachePath === 'none' ? undefined : await openWireCache({ path: webCachePath });
      try {
        const counted = countingFetch();
        // the model calls are remembered too, so the replay can answer them
        const replayCache = cache?.adapter({ fresh });
        const retry = { attempts: 8, baseMs: 3000, maxMs: 60000 };
        const chat = chatClientFor(chatSettingsOf(env), { retry, fetch: counted.fetch, cache: replayCache, structured: webStructured, ...(thinking === 'off' ? { reasoning: { effort: 'none' as const } } : {}) });
        const embedder = embedderFor({ ...DEFAULT_SETTINGS, embed: embedSettingsOf(env) }, counted.fetch, replayCache);
        const dns = await import('node:dns/promises');
        const recorded = recordingLookup(async (hostname) => dns.lookup(hostname, { all: true, verbatim: true }));
        const lookup = recorded.lookup;
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
        await writeDnsLog(dnsLogPathOf(capturePath), recorded.log);
        console.error(`  wire: ${counted.counts.chat} chat and ${counted.counts.embeddings} embedding requests sent`);
        if (webPath !== undefined) await writeFile(webPath, `${JSON.stringify(web, null, 2)}\n`);
      } finally {
        await capture.close();
        await cache?.close();
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

// --- the web run's replay: every SearxNG and document exchange from the
// capture, every name from the recorded resolutions, every model call from
// the wire cache, and a transport that throws if anything reaches it
if (args.flags.has('web-replay')) {
  if (web === null || web.notRun !== null) {
    console.error(`--web-replay needs --web-json naming a recorded web run${web === null ? '' : `; ${webPath} is a not-run record (${web.notRun})`}`);
    process.exit(1);
  }
  if (webCachePath === 'none') {
    console.error('--web-replay answers the model calls from the wire cache; --cache none leaves nothing to answer them');
    process.exit(1);
  }
  const recorded = web;
  const searxBase = recorded.registration.searxBase;
  if (searxBase === null) {
    console.error(`the web report at ${webPath} names no SearxNG base, so it was never run`);
    process.exit(1);
  }
  const env = readAiEnv();
  const differences = [
    env.provider !== recorded.generated.provider ? `provider ${env.provider} (recorded ${recorded.generated.provider})` : null,
    env.model !== recorded.generated.model ? `model ${env.model} (recorded ${recorded.generated.model})` : null,
    JSON.stringify(baselineOf(live)) !== JSON.stringify(recorded.baseline) ? 'the flat baseline named by --live-json' : null,
  ].filter((difference) => difference !== null);
  if (differences.length > 0) {
    console.error(`this environment cannot rebuild the recorded run: ${differences.join('; ')}`);
    process.exit(1);
  }
  const { openHttpCapture, HTTP_CAPTURE_PATH } = await import('./lib/http-capture.ts');
  const { runGroundingWeb } = await import('./lib/grounding-web.ts');
  const { dnsLogPathOf, readDnsLog, replayingLookup } = await import('./lib/dns-capture.ts');
  const capturePath = args.values.get('http-capture') ?? HTTP_CAPTURE_PATH;
  const names = replayingLookup(await readDnsLog(dnsLogPathOf(capturePath)));
  const capture = await openHttpCapture({ path: capturePath });
  const cache = await openWireCache({ path: webCachePath });
  try {
    const offline = countingFetch((async () => {
      throw new Error('the network must not be touched on replay');
    }) as unknown as typeof globalThis.fetch);
    const replayCache = cache.adapter();
    const thinkingOf = recorded.generated.thinking;
    const chat = chatClientFor(chatSettingsOf(env), { retry: { attempts: 1 }, fetch: offline.fetch, cache: replayCache, structured: webStructured, ...(thinkingOf === 'off' ? { reasoning: { effort: 'none' as const } } : {}) });
    const embedder = embedderFor({ ...DEFAULT_SETTINGS, embed: embedSettingsOf(env) }, offline.fetch, replayCache, { attempts: 1 });
    const rebuilt = await runGroundingWeb({
      tier: recorded.generated.tier,
      provider: env.provider,
      model: env.model,
      keySource: env.keySource,
      thinking: thinkingOf,
      chat,
      embedder,
      capture,
      replay: true,
      searxBase,
      lookup: names.lookup,
      baseline: recorded.baseline,
      maxCalls: env.maxCalls,
      concurrency: recorded.registration.concurrency,
      configIdentityFor: (observed) => envConfigIdentity(env, observed),
      fetchCounts: offline.counts,
      onProgress: (message) => console.error(`  ${message}`),
    });
    const network = offline.counts.chat + offline.counts.embeddings + offline.counts.other;
    console.error(`replay: ${rebuilt.capture.replayHits} captured exchanges served, ${rebuilt.capture.replayMisses} missing, `
      + `${names.misses()} unrecorded names, ${network} model requests reached the network`);
    if (rebuilt.reportId !== recorded.reportId || rebuilt.capture.replayMisses > 0 || names.misses() > 0 || network > 0) {
      console.error(`the replay does not reproduce the recorded run: report ${rebuilt.reportId}, recorded ${recorded.reportId}`
        + (network > 0 ? "; a model call missed the wire cache — pass the run's --web-structured and --cache" : ''));
      process.exit(1);
    }
    console.error(`the recorded web run replays byte-identically: report ${recorded.reportId}`);
  } finally {
    await capture.close();
    await cache.close();
  }
}

const markdown = renderGroundingMarkdown(report, live, web);
console.log(markdown);

const jsonPath = args.values.get('json');
if (jsonPath !== undefined) await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
const mdPath = args.values.get('md');
if (mdPath !== undefined) await writeFile(mdPath, `${markdown}\n`);
