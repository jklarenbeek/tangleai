/* eslint-disable no-console */
/** Registered lexical screen and authorized, resumable live policy experiment.
 * --cells all runs the keyless screen; --render reproduces a stored report without a wire.
 * --live --phase census|selection|confirmation prints a no-call plan. Its inference
 * identity must be explicitly authorized; answering runs default to one pending cell.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync, renameSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';

import { resolveEndpoint } from '@tangleai/models/providers';

import { DEFAULT_SETTINGS, chatClientFor, embedderFor } from '../apps/desktop/src/settings.ts';
import { chatSettingsOf, embedSettingsOf, readAiEnv, envConfigIdentity } from './lib/ai-env.ts';
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
  sourceRevision,
  type InferenceControls,
  type LocomoPolicy,
} from './lib/locomo-policy.ts';
import { createReportValidator, describeErrors } from './lib/validate.ts';
import { createPurchaseGuard, verifyPolicyReport, verifyPolicyDataset, verifyPurchaseSnapshot, validatePhase, type PurchaseJournal } from './lib/policy-execution.ts';
import RUN_IDENTITY_SCHEMA from '../packages/config/schemas/run-identity.schema.json' with { type: 'json' };
import { openWireCache } from './lib/wire-cache.ts';
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
  flags: ['require', 'live', 'fresh', 'render'],
  values: ['phase', 'cells', 'samples', 'seed', 'json', 'md', 'authorize', 'campaign-ceiling', 'thinking', 'cache', 'journal'],
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

if (args.flags.has('render')) {
  const path = args.values.get('json');
  assert.ok(path, '--render requires --json');
  const report = JSON.parse(await readFile(path, 'utf8')) as LocomoPolicy;
  await verifyPolicyReport(report);
  const outcome = createReportValidator(SCHEMA, [RUN_IDENTITY_SCHEMA])(report);
  assert.ok(outcome.valid, describeErrors(outcome).join('\n'));
  const markdown = renderMarkdown(report);
  console.log(markdown);
  const destination = args.values.get('md');
  if (destination) await writeFile(destination, `${markdown}\n`);
  process.exit(0);
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
await verifyPolicyReport(stored);
verifyPolicyDataset(stored, dataset);
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

const RETRY = { attempts: 1, baseMs: 3000, maxMs: 60000 };
const DEADLINE_MS = 120_000;
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
  deadlineMs: DEADLINE_MS,
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
const cachePath = args.values.get('cache') ?? `${jsonPath}.sqlite`;
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
const phaseCells = phase !== 'confirmation' ? (stored.census ? stored.selection.shortlist : shortlist)
  : [inertId, shippedCellId, ...(stored.selection.transition ? [stored.selection.transition.challenger] : [])];
const requested = list('cells');
const pending = phaseCells.filter(id => !stored.attempts.some(a => a.run.tier === 'live' && a.phase === phase && a.cellId === id && a.eligibility.eligible));
const planCells = phase === 'census' ? phaseCells : requested
  ? (requested.includes('all') ? phaseCells : requested.map(key => {
    const cell = stored.registration.cells.find(c => c.key === key || c.cellId === key);
    assert.ok(cell && phaseCells.includes(cell.cellId), `Cell ${key} is outside this phase`);
    return cell.cellId;
  })) : pending.slice(0, 1);
assert.equal(new Set(planCells).size, planCells.length, 'Duplicate requested cells');
const journalPath = args.values.get('journal') ?? `${jsonPath}.purchases.json`;
const journal: PurchaseJournal = existsSync(journalPath)
  ? JSON.parse(await readFile(journalPath, 'utf8')) as PurchaseJournal
  : { inference: identity, source: stored.source.sha256, ceiling: campaignCeiling, requests: [], cacheWrites: {} };
assert.equal(journal.inference, identity, 'Purchase journal inference changed');
assert.equal(journal.ceiling, campaignCeiling, 'Purchase journal ceiling changed');
assert.equal(journal.source, stored.source.sha256, 'Purchase journal source changed');
if (stored.registration.inference) assert.equal(stored.registration.inference.identity, identity, 'Approved inference controls changed');

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
console.error(`  Physical requests already purchased: ${journal.requests.length}/${campaignCeiling}`);
const selectionSplit = stored.registration.splits.selection, confirmationSplit = stored.registration.splits.confirmation;
const censusBase = Math.ceil(new Set(corpusTexts(dataset, selectionSplit.conversations, { seed: stored.registration.seed, perCategory: selectionSplit.perCategory['1'], adversarial: selectionSplit.adversarial })).size / 256);
const confirmationBase = Math.ceil(new Set(corpusTexts(dataset, confirmationSplit.conversations, { seed: stored.registration.seed, perCategory: confirmationSplit.perCategory['1'], adversarial: confirmationSplit.adversarial })).size / 256);
const selectionCalls = shortlist.length * (selectionSplit.scorable + 2 * selectionSplit.adversarial);
const confirmationCalls = 3 * (confirmationSplit.scorable + 2 * confirmationSplit.adversarial);
console.error(`  Cold campaign base: ${censusBase} census embeddings + ${selectionCalls} selection answers/judgments + ${confirmationBase} held-out embeddings + ${confirmationCalls} confirmation answers/judgments = ${censusBase + selectionCalls + confirmationBase + confirmationCalls} requests.`);
console.error('  Derived embeddings, repairs, failures and retries also consume the hard ceiling; cache replays consume zero physical requests.');
console.error('  Answering is split into one cell per run by default; no incomplete matrix can freeze a challenger.');
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

validatePhase(stored, phase as 'census' | 'selection' | 'confirmation');
assert.ok(planCells.length, 'This phase has no pending cells');
assert.ok(cache && !args.flags.has('fresh'), 'Policy campaigns require a persistent replay cache and forbid --fresh');
assert.ok(journal.requests.length < campaignCeiling, 'Campaign physical request ceiling exhausted');
assert.equal((await sourceRevision()).sha256, stored.source.sha256, 'Source changed: regenerate the keyless screen before a new experiment; an active experiment cannot change source');
await envConfigIdentity(env, null); // Fail config resolution before buying embeddings.
const lockPath = `${journalPath}.lock`;
await writeFile(lockPath, `${process.pid}\n`, { flag: 'wx' });
const { unlink } = await import('node:fs/promises');
try {
verifyPurchaseSnapshot({ journal, reportId: stored.reportId }, {
  journal: existsSync(journalPath) ? JSON.parse(await readFile(journalPath, 'utf8')) as PurchaseJournal : journal,
  reportId: (JSON.parse(await readFile(jsonPath, 'utf8')) as LocomoPolicy).reportId,
});
const saveJournal = (): void => {
  writeFileSync(`${journalPath}.tmp`, `${JSON.stringify(journal, null, 2)}\n`);
  renameSync(`${journalPath}.tmp`, journalPath);
};
saveJournal();
const guard = createPurchaseGuard({ journal, limit: env.maxCalls, deadlineMs: DEADLINE_MS, fetch: globalThis.fetch, save: saveJournal });
const registration = { ...stored.registration, inference: await approvedInference(controls) };
registration.registrationId = await registrationIdOf(registration);
const replay = guard.cache(cache.adapter());
const wire = { fetch: guard.fetch, retry: RETRY, ...(thinking === 'off' ? { reasoning: { effort: 'none' as const } } : {}) };
const chat = chatClientFor(chatSettingsOf(env), { ...wire, cache: replay });
const judgeClient = chatClientFor(chatSettingsOf(env, env.modelStrong), { ...wire, cache: replay });
const wireEmbedder = embedderFor({ ...DEFAULT_SETTINGS, embed: embedSettings }, guard.fetch, replay, RETRY);
const inertCellId = inertId;
let next: LocomoPolicy = { ...stored, registration, plan };
next = { ...next, reportId: await reportIdOf(next) };
await publish(next); // Persist approved controls before the first purchase.

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
  const running = planCells.map(id => stored.registration.cells.find(c => c.cellId === id)!);
  const { attempts, live: evidence } = await runLivePhase({
    configIdentityFor: observed => envConfigIdentity(env, observed),
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
  const evidenceBytes = `${JSON.stringify(evidence, null, 2)}\n`;
  const evidenceHash = createHash('sha256').update(evidenceBytes).digest('hex');
  const evidencePath = `${jsonPath}.${phase}.${evidenceHash}.json`;
  if (!existsSync(evidencePath)) await writeFile(evidencePath, evidenceBytes, { flag: 'wx' });
  let merged = next;
  for (const attempt of attempts) merged = mergeAttempt(merged, attempt);
  const phaseAttempts = withPrompts(merged.attempts.filter(a => a.run.tier === 'live' && a.phase === phase), inertCellId);
  merged = { ...merged, attempts: merged.attempts.map(a => phaseAttempts.find(p => p.runId === a.runId) ?? a),
    liveEvidence: [...(merged.liveEvidence ?? []), { path: evidencePath, sha256: evidenceHash, phase: phase as 'selection' | 'confirmation' }],
  };
  const inertAttempt = phaseAttempts.find(a => a.cellId === inertCellId);
  const comparisons = inertAttempt ? phaseAttempts.filter(a => a.cellId !== inertCellId)
    .map(a => comparisonOf(a, inertAttempt, registration.objective, 'locomo-f1')) : [];
  merged.comparisons = [...merged.comparisons.filter(c => c.metric !== 'locomo-f1' || c.phase !== phase), ...comparisons];
  const complete = phaseCells.every(id => phaseAttempts.some(a => a.cellId === id && a.eligibility.eligible));
  if (complete && phase === 'selection') {
    const candidates = phaseCells.filter(id => id !== inertCellId && id !== shippedCellId);
    const choice = chooseChallenger(comparisons, candidates, registration.objective);
    if (choice.challenger) merged.selection = { ...merged.selection,
      transition: await transitionOf(choice, registration, merged.selection.frozen!.identity), finalist: choice.challenger };
  } else if (complete && phase === 'confirmation') {
    const comparison = comparisons.find(c => c.treatment === merged.selection.transition!.challenger)!;
    assert.ok(comparison.eligible, 'Ineligible confirmation cannot select a default');
    merged.selection = { ...merged.selection, state: 'confirmed', decision: decisionOf(comparison, inertCellId, registration.objective) };
  }
  const identities = new Map([...merged.configIdentities.identities, ...evidence.configIdentities.identities].map(i => [i.identityId, i]));
  const ids = new Map(evidence.configIdentities.rows.filter(r => r.identityStatus === 'run').map(r => [r.rowId, r.identityId]));
  merged.configIdentities = { identities: [...identities.values()], rows: [
    ...merged.configIdentities.rows.filter(r => !attempts.some(a => a.runId === r.rowId)),
    ...attempts.map(a => ({ rowId: a.runId, identityStatus: 'run' as const, identityId: ids.get(stored.registration.cells.find(c => c.cellId === a.cellId)!.key)! })),
  ] };

  next = merged;
}

next = { ...next, purchases: { path: journalPath, sha256: createHash('sha256').update(await readFile(journalPath)).digest('hex'), physical: journal.requests.length } };
next = { ...next, reportId: await reportIdOf(next) };
if (cache !== undefined) {
  const after = await cache.stats();
  console.error(`  wire cache: ${after.embeddings} embeddings, ${after.completions} completions remembered now`);
}
await publish(next);

} finally { await unlink(lockPath); await cache.close(); }
