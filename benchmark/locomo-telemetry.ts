/** Recover program step telemetry from saved completions, with all network access refused. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { DEFAULT_SETTINGS, chatClientFor, embedderFor } from '../apps/desktop/src/settings.ts';
import { chatSettingsOf, embedSettingsOf, envConfigIdentity, readAiEnv } from './lib/ai-env.ts';
import { parseArgs } from './lib/args.ts';
import { loadLocomo } from './lib/locomo.ts';
import { runLocomoQaLive, type LiveReport, type LiveConfiguration } from './lib/locomo-qa.ts';
import { createReportValidator } from './lib/validate.ts';
import { openWireCache } from './lib/wire-cache.ts';
import RECALL_SCHEMA from './schemas/locomo-recall.schema.json' with { type: 'json' };
import QA_SCHEMA from './schemas/locomo-qa.schema.json' with { type: 'json' };
import LIVE_SCHEMA from './schemas/locomo-qa-live.schema.json' with { type: 'json' };
import IDENTITY_SCHEMA from '../packages/config/schemas/run-identity.schema.json' with { type: 'json' };

const args = parseArgs(process.argv.slice(2), { flags: [], values: ['live-json', 'cache', 'receipt'] });
const path = args.values.get('live-json');
const cachePath = args.values.get('cache');
const receiptPath = args.values.get('receipt');
assert.ok(path && cachePath && receiptPath, '--live-json, --cache and --receipt are required');
const original: LiveReport = JSON.parse(await readFile(path, 'utf8'));
const validate = createReportValidator(LIVE_SCHEMA, [RECALL_SCHEMA, QA_SCHEMA, IDENTITY_SCHEMA]);
assert.ok(validate(original).valid, 'the original report must validate');
const before = original.configurations.find((row) => row.kind === 'long-horizon');
assert.ok(before?.horizon, 'the report must contain a long-horizon attempt');
const env = readAiEnv();
assert.ok(env.live, env.reason ?? 'provider settings are required to resolve the cache identity');
assert.equal(env.model, original.generated.model);
assert.equal(env.provider, original.generated.provider);
const dataset = await loadLocomo();
assert.ok(dataset.available && dataset.valid, 'initialize the pinned LoCoMo dataset before replaying');
const cache = await openWireCache({ path: cachePath });
let cacheMisses = 0;
const offlineFetch: typeof fetch = async () => {
  cacheMisses++;
  return new Response(JSON.stringify({ error: { message: 'Local replay cache miss; no network request was sent' } }), { status: 400 });
};

/** Timing/replay markers and the telemetry under audit are the only permitted differences. */
function scored(row: LiveConfiguration) {
  const { cost, latency, run, horizon, questions, adversarial, ...rest } = row;
  return {
    ...rest,
    questions: { ...questions, results: questions.results.map(({ ms, replayed, subcalls, failed, unvisited, stopped, ...result }) => result) },
    adversarial: { ...adversarial, cost: undefined },
    tokens: cost.tokens,
    horizon: horizon === undefined ? undefined : { ...horizon, subcalls: undefined, stops: undefined },
  };
}

try {
  const replay = cache.adapter();
  const thinking = original.generated.thinking;
  const wire = { fetch: offlineFetch, retry: { attempts: 1 }, cache: replay,
    ...(thinking === 'off' ? { reasoning: { effort: 'none' as const } } : {}) };
  const horizon = before.horizon;
  const replayed = await runLocomoQaLive(dataset, {
    env, cache, rows: ['long-horizon'], thinking,
    chat: chatClientFor(chatSettingsOf(env), wire),
    judge: chatClientFor(chatSettingsOf(env, env.modelStrong), wire),
    horizonClient: chatClientFor(chatSettingsOf(env), { fetch: offlineFetch, retry: { attempts: 1 }, cache: replay }),
    embedder: embedderFor({ ...DEFAULT_SETTINGS, embed: embedSettingsOf(env) }, offlineFetch, replay),
    k: original.config.k, seed: original.sample.seed,
    perCategory: original.sample.perCategory, adversarial: original.sample.adversarial,
    horizon: { ...horizon, strategy: 'legacy', authorThinking: horizon.thinking.author },
    configIdentityFor: (observed) => envConfigIdentity(env, observed),
    onProgress: (message) => console.error(message),
  });
  assert.ok(validate(replayed).valid, 'the replay must validate');
  assert.equal(replayed.runs[0].spent.turns, 0, 'the replay cannot spend a model call');
  const after = replayed.configurations[0];
  assert.deepEqual(scored(after), scored(before), 'scores, coverage, usage and program outcomes must remain identical');
  const originalSha256 = await canonicalSha256(original);
  const countsBefore = before.horizon.subcalls;
  const stopsBefore = before.horizon.stops;
  const questionTelemetryBefore = before.questions.results.map(({ id, subcalls, failed, unvisited, stopped }) => ({ id, subcalls, failed, unvisited, stopped }));
  before.horizon.subcalls = after.horizon!.subcalls;
  before.horizon.stops = after.horizon!.stops;
  before.questions.results.forEach((result, index) => {
    const { subcalls, failed, unvisited, stopped } = after.questions.results[index];
    Object.assign(result, { subcalls, failed, unvisited, stopped });
  });
  assert.ok(validate(original).valid, 'the corrected telemetry must validate');
  const receipt = {
    measuredAt: new Date().toISOString(), modelNetworkRequests: 0, cacheMisses,
    completionReplays: replayed.runs[0].replayed,
    scoresCoverageUsageUnchanged: true, originalSha256,
    correctedSha256: await canonicalSha256(original), countsBefore, stopsBefore, questionTelemetryBefore,
    countsAfter: before.horizon.subcalls, stops: before.horizon.stops,
  };
  await writeFile(path, JSON.stringify(original, null, 2) + '\n');
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
} finally {
  await cache.close();
}
