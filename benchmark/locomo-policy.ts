/* eslint-disable no-console */
/**
 * LoCoMo policy matrix — the keyless screen.
 *
 * Registers the splits, the objective, the axes and the cell registry,
 * assigns every identity, then screens the requested cells over the
 * real pipeline: one store per conversation, one run per session, the
 * cell's own thresholds, its own k and minScore, its own built-in
 * embedding width, and the official evidence recall per question. It
 * spends nothing, reads no clock and reaches no wire, so two runs of
 * the same registration over the same bytes are byte-identical.
 *
 *   node benchmark/locomo-policy.ts --cells all                  # the committed selection screen
 *   node benchmark/locomo-policy.ts                              # the inert and shipped cells only
 *   node benchmark/locomo-policy.ts --cells inert,novelty-0.97
 *   node benchmark/locomo-policy.ts --phase screen --samples conv-30
 *   node benchmark/locomo-policy.ts --json PATH --md PATH
 *   node benchmark/locomo-policy.ts --require                    # exit 1 if the submodule is absent
 *
 * `--phase selection` (the default) scores the registered selection
 * sample over the selection conversations and, when every registered
 * cell ran, expands the registry with the pairwise combinations its own
 * Pareto frontier earns, decides the built-in embedding width and
 * freezes at most four non-control live candidates. `--phase screen`
 * scores every scorable question of whatever conversations it is given
 * and freezes nothing: it is a diagnostic.
 *
 * There is no `--live` here and `--phase confirmation` is refused. A
 * live matrix spends a budget the operator authorizes per run, and the
 * held-out split cannot be unlocked by a flag on a screen.
 *
 * Exit 1 with the reason when the gate fails or the report does not
 * validate against `schemas/locomo-policy.schema.json` — whose `$query`
 * assertions refuse a report whose denominators, operation counts or
 * paired question sets do not reconcile. Nothing is printed or written
 * in either case. Elapsed time goes to stderr; the report carries none.
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';

import { resolveEndpoint } from '@tangleai/models/providers';

import { DEFAULT_SETTINGS, chatClientFor, embedderFor } from '../apps/desktop/src/settings.ts';
import { chatSettingsOf, embedSettingsOf, readAiEnv } from './lib/ai-env.ts';
import { parseArgs } from './lib/args.ts';
import { loadLocomo } from './lib/locomo.ts';
import { conversationCorpus } from './lib/locomo-corpus.ts';
import { questionsOf, sampleQuestions, type QaQuestion } from './lib/locomo-qa.ts';
import type { LocomoSample } from './lib/locomo.ts';
import {
  RESPONSE_SCHEMA_REVISION,
  approvedInference,
  chooseChallenger,
  comparisonOf,
  decisionOf,
  describePlan,
  inferenceIdentityOf,
  mergeAttempt,
  planOf,
  registrationIdOf,
  renderMarkdown,
  reportIdOf,
  runLiveCensus,
  runLivePhase,
  runLocomoPolicy,
  transitionOf,
  withPrompts,
  type InferenceControls,
  type LocomoPolicy,
} from './lib/locomo-policy.ts';
import { createReportValidator, describeErrors } from './lib/validate.ts';
import { analyticEnvelope } from './lib/report-envelope.ts';
import RUN_IDENTITY_SCHEMA from '../packages/config/schemas/run-identity.schema.json' with { type: 'json' };
import { WIRE_CACHE_PATH, openWireCache } from './lib/wire-cache.ts';
import SCHEMA from './schemas/locomo-policy.schema.json' with { type: 'json' };

/**
 * Every text a run's cells will embed — the corpus turns and the
 * sampled questions — so the plan counts exactly what the wire will be
 * asked for rather than an estimate of it.
 */
function corpusTexts(
  dataset: { samples: LocomoSample[] },
  conversations: readonly string[],
  spec: { seed: number, perCategory: number, adversarial: number },
): string[] {
  const texts: string[] = [];
  const questions: QaQuestion[] = [];
  for (const sample of dataset.samples) {
    if (!conversations.includes(sample.sample_id)) continue;
    const corpus = conversationCorpus(sample);
    for (const session of corpus.sessions) for (const input of session.inputs) texts.push(input.text);
    questions.push(...questionsOf(sample, corpus));
  }
  for (const q of sampleQuestions(questions, spec)) texts.push(q.text);
  return texts;
}

const args = parseArgs(process.argv.slice(2), {
  flags: ['require', 'live', 'fresh'],
  values: ['phase', 'cells', 'samples', 'seed', 'json', 'md', 'authorize', 'campaign-ceiling', 'thinking', 'cache'],
});

const live = args.flags.has('live');
const phase = args.values.get('phase') ?? (live ? 'census' : 'selection');
const KEYLESS_PHASES = ['selection', 'screen'];
const LIVE_PHASES = ['census', 'selection', 'confirmation'];
if (!live && !KEYLESS_PHASES.includes(phase)) {
  console.error(phase === 'confirmation'
    ? 'the held-out confirmation is not reachable from a keyless screen: it spends a budget the operator authorizes per run, and a screen that could unlock it by a flag would be a screen that chose its own cells'
    : `--phase without --live is selection or screen, got '${phase}'`);
  process.exit(1);
}
if (live && !LIVE_PHASES.includes(phase)) {
  console.error(`--live --phase is one of ${LIVE_PHASES.join(', ')}, got '${phase}'`);
  process.exit(1);
}

const dataset = await loadLocomo();
if (!dataset.available) {
  console.log(`# LoCoMo policy matrix\n\n**Skipped** — ${dataset.reason}.\n`);
  console.log('The dataset is a git submodule and is not vendored here (it is CC BY-NC 4.0).');
  console.log(`Fetch it with:\n\n    ${dataset.hint}\n`);
  process.exit(args.flags.has('require') ? 1 : 0);
}
if (!dataset.valid) {
  console.error('the release no longer matches benchmark/schemas/locomo10.schema.json — run the census; nothing is scored against a dataset that moved');
  for (const error of dataset.errors) console.error(`  ${error}`);
  process.exit(1);
}

const list = (name: string): string[] | undefined => args.values.get(name)?.split(',').map((s) => s.trim()).filter((s) => s !== '');
const seedRaw = args.values.get('seed');
const seed = seedRaw === undefined ? undefined : Number(seedRaw);
if (seed !== undefined && !Number.isFinite(seed)) throw new Error(`--seed needs a number, got '${seedRaw}'`);

const started = performance.now();
let last = started;
const onProgress = (message: string): void => {
  const now = performance.now();
  console.error(`  ${message} — ${(now - last).toFixed(0)} ms`);
  last = now;
};

const validateReport = createReportValidator(SCHEMA, [RUN_IDENTITY_SCHEMA]);
function mustValidate(report: LocomoPolicy): void {
  const outcome = validateReport(report);
  if (outcome.valid) return;
  console.error('the report does not validate against benchmark/schemas/locomo-policy.schema.json:');
  for (const line of describeErrors(outcome)) console.error(`  ${line}`);
  process.exit(1);
}

const jsonPath = args.values.get('json');
const mdPath = args.values.get('md');

async function publish(report: LocomoPolicy): Promise<void> {
  mustValidate(report);
  if (!report.gate.passed) {
    console.error('GATE FAILED — the scorer is not proven, so no number is published:');
    for (const failure of report.gate.failures) console.error(`  ${failure}`);
    process.exit(1);
  }
  const markdown = renderMarkdown(report);
  console.log(markdown);
  if (jsonPath !== undefined) await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  if (mdPath !== undefined) await writeFile(mdPath, `${markdown}\n`);
}

if (!live) {
  const report = await runLocomoPolicy(dataset, {
    phase: phase as 'selection' | 'screen',
    cells: list('cells'),
    samples: list('samples'),
    seed,
    onProgress,
  });
  console.error(`  total ${(performance.now() - started).toFixed(0)} ms (diagnostic only; the report carries no timing)`);
  await publish(report);
  process.exit(0);
}

// -------------------------------------------------------------------------
// the live tier — a plan first, then the operator, then a request
// -------------------------------------------------------------------------

if (jsonPath === undefined || !existsSync(jsonPath)) {
  console.error('--live extends a frozen keyless report: pass --json with the path of one (run the keyless screen first)');
  process.exit(1);
}
const stored = JSON.parse(await readFile(jsonPath, 'utf8')) as LocomoPolicy;
mustValidate(stored);
if (stored.selection.frozen === null) {
  console.error('the shortlist is not frozen, so there is nothing a live run is allowed to spend on');
  process.exit(1);
}

const env = readAiEnv();
if (!env.live) {
  console.error(`live tier skipped: ${env.reason}`);
  process.exit(0);
}
const thinking = args.values.get('thinking') ?? 'default';
if (thinking !== 'off' && thinking !== 'default') {
  console.error(`--thinking is off or default, got '${thinking}'`);
  process.exit(1);
}
const campaignCeiling = Number(args.values.get('campaign-ceiling') ?? 900);
if (!Number.isInteger(campaignCeiling) || campaignCeiling < 1) {
  console.error('--campaign-ceiling needs a positive whole number of requests');
  process.exit(1);
}

const RETRY = { attempts: 8, baseMs: 3000, maxMs: 60000 };
const resolved = resolveEndpoint({ provider: env.provider, baseUrl: env.baseUrl ?? undefined, model: env.model });
const embedSettings = embedSettingsOf(env);
const probe = embedderFor({ ...DEFAULT_SETTINGS, embed: embedSettings });
const controls: InferenceControls = {
  provider: env.provider,
  endpoint: resolved.base,
  answerModel: env.model,
  judgeModel: env.modelStrong,
  embedder: { model: probe.model, dims: probe.dims ?? 0 },
  thinking,
  responseSchema: RESPONSE_SCHEMA_REVISION,
  retry: RETRY,
  deadlineMs: null,
  concurrency: env.maxConcurrency,
  perRunCeiling: env.maxCalls,
  campaignCeiling,
  keySource: env.keySource,
};
const identity = await inferenceIdentityOf(controls);

const shortlist = stored.selection.frozen.cells;
const cells = shortlist.map((id) => stored.registration.cells.find((c) => c.cellId === id)!);
const confirmationConversations = stored.registration.splits.confirmation.conversations;
const selectionConversations = stored.registration.splits.selection.conversations;
const conversations = phase === 'confirmation' ? confirmationConversations : selectionConversations;
const split = phase === 'confirmation' ? stored.registration.splits.confirmation : stored.registration.splits.selection;

// what the cache already holds is read, never bought — a cache lookup is
// not a request and a warm cache is not an authorization
const cachePath = args.values.get('cache') ?? WIRE_CACHE_PATH;
const cache = cachePath === 'none' ? undefined : await openWireCache({ path: cachePath });
const texts = corpusTexts(dataset, conversations, { seed: seed ?? stored.registration.seed, perCategory: split.perCategory['1'], adversarial: split.adversarial });
const replayEndpoint = { provider: resolved.provider, base: resolved.base, model: probe.model };
const held = cache === undefined || args.flags.has('fresh')
  ? []
  : (await cache.embeddingHits(replayEndpoint, [...new Set(texts)])).filter((v) => v !== undefined);
const uniqueTexts = new Set(texts).size;
const embedFresh = Math.ceil(Math.max(0, uniqueTexts - held.length) / 256);

// confirmation runs exactly three rows — the inert reference, the
// published shipped control and the one frozen challenger — so a plan
// that priced the whole shortlist would ask the operator to approve
// money nobody intends to spend
const shippedCellId = stored.registration.cells.find((c) => c.role === 'shipped')!.cellId;
const inertId = stored.registration.cells.find((c) => c.role === 'inert')!.cellId;
const planCells = phase !== 'confirmation'
  ? shortlist
  : [inertId, shippedCellId, ...(stored.selection.transition === null ? [] : [stored.selection.transition.challenger])];

const plan = planOf({
  phase: phase as 'census' | 'selection' | 'confirmation',
  cells: planCells,
  scorable: split.scorable,
  adversarial: split.adversarial,
  embedFresh,
  embedCached: held.length,
  controls,
  inference: identity,
});

console.error('');
console.error('  the plan, before any request:');
for (const line of describePlan(plan, controls, stored.registration)) console.error(`    ${line}`);
console.error('');

const authorized = args.values.get('authorize');
if (authorized === undefined) {
  console.error('  NOTHING WAS SPENT. This is a plan, not permission.');
  console.error('  To authorize exactly this host and this ceiling, re-run with:');
  console.error(`    --authorize ${identity}`);
  console.error('  A different model, endpoint, thinking control, retry policy, concurrency or ceiling');
  console.error('  resolves to a different identity and will be refused.');
  if (cache !== undefined) await cache.close();
  process.exit(0);
}
if (authorized !== identity) {
  console.error(`  REFUSED: --authorize names ${authorized.slice(0, 12)}… but this environment resolves ${identity.slice(0, 12)}….`);
  console.error('  A run whose controls differ from the approved ones is a new registration, never a merge.');
  if (cache !== undefined) await cache.close();
  process.exit(1);
}
if (!plan.withinCeilings) {
  console.error(`  REFUSED: ${plan.requests.total} planned requests exceed the ceilings (${plan.ceilings.perRun} per run, ${plan.ceilings.campaign} campaign).`);
  if (cache !== undefined) await cache.close();
  process.exit(1);
}

console.error(`  authorized as ${identity.slice(0, 12)}… — spending up to ${plan.requests.total} requests`);

const registration = { ...stored.registration, inference: await approvedInference(controls) };
registration.registrationId = await registrationIdOf(registration);
const replay = cache?.adapter({ fresh: args.flags.has('fresh') });
const wire = { retry: RETRY, ...(thinking === 'off' ? { reasoning: { effort: 'none' as const } } : {}) };
const chat = chatClientFor(chatSettingsOf(env), { ...wire, cache: replay });
const judgeClient = chatClientFor(chatSettingsOf(env, env.modelStrong), { ...wire, cache: replay });
const wireEmbedder = embedderFor({ ...DEFAULT_SETTINGS, embed: embedSettings }, undefined, replay);
const inertCellId = stored.registration.cells.find((c) => c.role === 'inert')!.cellId;

let next: LocomoPolicy = { ...stored, registration, plan };

if (phase === 'census') {
  // embeddings only, and the schema asserts the zero: a census that
  // answered a question would be a selection. The registered selection
  // sample rides along so retrieval-axis cells are judged on the context
  // they would actually hand the prompt, not on counts they cannot move.
  const perSample = dataset.samples
    .filter((sample) => conversations.includes(sample.sample_id))
    .map((sample) => {
      const corpus = conversationCorpus(sample);
      return { corpus, questions: questionsOf(sample, corpus) };
    });
  const sampled = sampleQuestions(perSample.flatMap((entry) => entry.questions), {
    seed: seed ?? stored.registration.seed,
    perCategory: split.perCategory['1'],
    adversarial: split.adversarial,
  });
  const entries = perSample.map(({ corpus }) => ({
    corpus,
    questions: sampled.filter((q) => q.sampleId === corpus.sampleId),
  }));
  const census = await runLiveCensus({
    cells,
    inertCellId,
    entries,
    embedder: { model: wireEmbedder.model, dims: wireEmbedder.dims ?? 0, embed: (t, h) => wireEmbedder.embed(t, h) },
    onProgress,
  });
  const dropped = census.rows.filter((r) => r.dropped);
  next = { ...next, census };
  if (dropped.length > 0) {
    next = {
      ...next,
      selection: {
        ...next.selection,
        shortlist: next.selection.shortlist.filter((id) => !dropped.some((r) => r.cellId === id)),
        excluded: [...next.selection.excluded, ...dropped.map((r) => ({
          cellId: r.cellId,
          code: 'ineligible' as const,
          detail: 'mechanically-inert-under-embedder: every live operation count equals the inert cell\'s and every registered selection question retrieves byte-identical context, so buying its answers would buy the inert cell twice',
        }))],
      },
    };
  }
  const surviving = next.selection.shortlist.filter((id) => id !== inertCellId
    && id !== stored.registration.cells.find((c) => c.role === 'shipped')!.cellId);
  if (surviving.length === 0) {
    console.error('  the census emptied the shortlist: the screen selected nothing this embedder actuates. The order stops rather than substituting cells.');
  }
} else {
  const split2 = phase === 'confirmation' ? stored.registration.splits.confirmation : stored.registration.splits.selection;
  if (phase === 'confirmation') {
    if (next.selection.transition === null) {
      console.error('  REFUSED: the challenger is not frozen, so the held-out split stays locked');
      if (cache !== undefined) await cache.close();
      process.exit(1);
    }
  }
  const running = phase === 'confirmation'
    ? [inertCellId, stored.registration.cells.find((c) => c.role === 'shipped')!.cellId, next.selection.transition!.challenger]
      .map((id) => stored.registration.cells.find((c) => c.cellId === id)!)
    : cells.filter((c) => next.selection.shortlist.includes(c.cellId));
  const { attempts } = await runLivePhase({
    dataset,
    phase: phase as 'selection' | 'confirmation',
    cells: running,
    conversations,
    perCategory: split2.perCategory['1'],
    adversarial: split2.adversarial,
    controls,
    source: stored.source.sha256,
    env,
    chat,
    judge: judgeClient,
    embedder: wireEmbedder,
    ...(cache === undefined ? {} : { cache }),
    fresh: args.flags.has('fresh'),
    seed: stored.registration.seed,
    onProgress,
  });
  const priced = withPrompts(attempts, inertCellId);
  let merged = next;
  for (const attempt of priced) merged = mergeAttempt(merged, attempt);
  const inertAttempt = priced.find((a) => a.cellId === inertCellId);
  const comparisons = inertAttempt === undefined
    ? merged.comparisons
    : [...merged.comparisons, ...priced.filter((a) => a.cellId !== inertCellId)
      .map((a) => comparisonOf(a, inertAttempt, registration.objective, 'locomo-f1'))];
  merged = { ...merged, comparisons };

  if (phase === 'selection') {
    const candidates = merged.selection.shortlist.filter((id) => id !== inertCellId
      && id !== stored.registration.cells.find((c) => c.role === 'shipped')!.cellId);
    const choice = chooseChallenger(comparisons.filter((c) => c.phase === 'selection'), candidates, registration.objective);
    if (choice.challenger === null) {
      console.error(`  no challenger could be nominated: ${choice.calculation}`);
    } else {
      merged = {
        ...merged,
        selection: { ...merged.selection, transition: await transitionOf(choice, registration, merged.selection.frozen!.identity), finalist: choice.challenger },
      };
    }
  } else {
    const challenger = merged.selection.transition!.challenger;
    const confirmation = merged.comparisons.find((c) => c.phase === 'confirmation' && c.treatment === challenger) ?? null;
    merged = {
      ...merged,
      selection: { ...merged.selection, state: 'confirmed', decision: decisionOf(confirmation, inertCellId, registration.objective) },
    };
  }
  next = merged;
}

next = { ...next, configIdentities: analyticEnvelope(next.attempts.map((attempt) => attempt.runId)) };
next = { ...next, reportId: await reportIdOf(next) };
if (cache !== undefined) {
  const after = await cache.stats();
  console.error(`  wire cache: ${after.embeddings} embeddings, ${after.completions} completions remembered now`);
  await cache.close();
}
await publish(next);
