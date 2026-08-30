/**
 * The policy matrix's contract: the identities that keep a frozen
 * treatment frozen, the arithmetic the SCHEMA refuses rather than the
 * test, the power a comparison may not publish a mean without, and the
 * determinism a screen that spends nothing owes its reader.
 *
 * The power block is checked against the committed live pair, so the
 * figures the campaign's design was sized against are reproduced by the
 * code that will publish them rather than asserted from a document.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { canonicalSha256 } from '@jarenjs/json/canonical';

import { loadLocomo } from '../../benchmark/lib/locomo.ts';
import {
  CAUSES,
  CAUSE_VOCABULARY,
  POLICY_OBJECTIVE,
  RESPONSE_SCHEMA_REVISION,
  causeOf,
  chooseChallenger,
  decisionOf,
  describePlan,
  inferenceIdentityOf,
  planOf,
  runLiveCensus,
  type InferenceControls,
  compareByLadder,
  dominates,
  type Disposition,
  type Objectives,
  type Ranking,
  bootstrapInterval,
  buildRegistration,
  cellDrafts,
  cellIdOf,
  comparabilityReasons,
  comparisonOf,
  confirmationConversations,
  eligibilityReasons,
  mergeAttempt,
  pairsOf,
  powerOf,
  questionSetOf,
  registrationIdOf,
  renderMarkdown,
  reportIdOf,
  runIdOf,
  runLocomoPolicy,
  sourceRevision,
  type Attempt,
  type Comparison,
  type LocomoPolicy,
} from '../../benchmark/lib/locomo-policy.ts';
import { conversationCorpus } from '../../benchmark/lib/locomo-corpus.ts';
import { emptyCensus } from '../../benchmark/lib/locomo-ingest.ts';
import { questionsOf } from '../../benchmark/lib/locomo-qa.ts';
import type { MemoryUnit } from '@tangleai/core/schemas/memory';
import type { Embedder } from '@jarenjs/ai/embed';
import { liveClients, scriptedEnv, scriptedFetch } from '../fixtures/scripted-wire.ts';
import { normalQuantile } from '../../benchmark/lib/stats.ts';
import { createReportValidator } from '../../benchmark/lib/validate.ts';
import SCHEMA from '../../benchmark/schemas/locomo-policy.schema.json' with { type: 'json' };

const LIVE_PATH = 'benchmark/results/locomo-qa-live.json';
const TYPES_PATH = 'benchmark/lib/locomo-policy.types.ts';
const POLICY_PATH = 'benchmark/results/locomo-policy.json';
const POLICY_DOC = 'docs/LOCOMO_POLICY.md';

const validate = createReportValidator(SCHEMA);
const dataset = await loadLocomo();
const missing = dataset.available ? false : `the LoCoMo submodule is absent: ${dataset.reason}`;
const available = dataset.available ? dataset : null;

/** A frozen source revision, so nothing here shells out to git. */
const SOURCE: LocomoPolicy['source'] = {
  head: 'b16f518dcff1acd5966c25bc783efdb726021b03',
  clean: false,
  files: [{ path: 'packages/memory/src/contradiction.ts', sha256: 'a'.repeat(64) }],
  sha256: 'b'.repeat(64),
};

// ---------------------------------------------------------------------------
// the four identities
// ---------------------------------------------------------------------------

describe('the policy matrix\'s identities', () => {
  it('separates the four concerns exactly as designed', async () => {
    const [inert, shipped] = cellDrafts();
    const id = await cellIdOf(inert);

    // member order is not information
    const reordered = { ...inert, retrieval: { minScore: inert.retrieval.minScore, k: inert.retrieval.k }, ingest: { ...inert.ingest } };
    assert.equal(await cellIdOf(reordered), id, 'a canonical digest is over the value, not over the member order');

    // a label is not a treatment; an effective control is
    assert.equal(await cellIdOf({ ...inert, key: 'other', label: 'other', role: 'isolated', axis: 'novelty' }), id,
      'renaming a cell does not make it a different experiment');
    assert.notEqual(await cellIdOf({ ...inert, retrieval: { ...inert.retrieval, k: 20 } }), id, 'k is an effective control');
    assert.notEqual(await cellIdOf({ ...inert, retrieval: { ...inert.retrieval, minScore: 0.25 } }), id);
    assert.notEqual(await cellIdOf({ ...inert, embedding: { model: 'hash-trigram-128', dims: 128 } }), id);
    assert.notEqual(await cellIdOf(shipped), id);
  });

  it('a run identity carries the host and the bytes; a cell identity carries neither', async () => {
    const registration = await buildRegistration(['conv-30', 'conv-44', 'conv-48', 'conv-50'], ['conv-30'], 17753);
    const cell = registration.cells[0];
    const run = {
      tier: 'live' as const, provider: 'openrouter', endpoint: 'https://openrouter.ai/api/v1',
      answerModel: 'z-ai/glm-5.3-flash', judgeModel: 'qwen/qwen3.8-27b',
      embedder: { model: 'baai/bge-m3', dims: 1024 }, thinking: 'default' as const,
      responseSchema: 'https://tangleai.dev/schemas/locomo-answer@1', retry: { attempts: 8, baseMs: 3000, maxMs: 60000 },
      deadlineMs: 300000, concurrency: 4, budgetCeiling: 200, keySource: 'OPENROUTER_AI_KEY',
      questionSet: 'c'.repeat(64), sampleIds: ['conv-30#1'], source: SOURCE.sha256,
    };
    const base = await runIdOf(cell.cellId, run);
    assert.notEqual(await runIdOf(cell.cellId, { ...run, source: 'd'.repeat(64) }), base,
      'a changed in-scope byte is a different run, even without a commit');
    assert.notEqual(await runIdOf(cell.cellId, { ...run, endpoint: 'https://example.test/v1' }), base);
    assert.notEqual(await runIdOf(cell.cellId, { ...run, concurrency: 8 }), base);
    assert.notEqual(await runIdOf(cell.cellId, { ...run, budgetCeiling: 900 }), base);
    assert.notEqual(await runIdOf(cell.cellId, { ...run, thinking: 'off' }), base);
    assert.equal(await cellIdOf(cell), cell.cellId, 'none of that reached the treatment identity');

    // the registration does not move when a source revision or a result does
    const id = await registrationIdOf(registration);
    assert.equal(id, registration.registrationId);
    assert.equal(await registrationIdOf({ ...registration, cells: [...registration.cells] }), id);
  });

  it('the report identity covers the observation and excludes its own field', async () => {
    const report = await fixture();
    const { reportId, ...rest } = report;
    assert.equal(await reportIdOf(rest), reportId, 'the hash is over the document without the hash');
    assert.equal(await reportIdOf(report), reportId, 'and passing the document WITH it changes nothing');
    const moved = { ...report, gate: { passed: report.gate.passed, failures: ['something'] } };
    assert.notEqual(await reportIdOf(moved), reportId, 'an observation is part of the report identity');
  });

  it('no local canonicalizer is added: the digest is the suite\'s', async () => {
    const [inert] = cellDrafts();
    assert.equal(
      await cellIdOf(inert),
      await canonicalSha256({ ingest: inert.ingest, retrieval: inert.retrieval, embedding: inert.embedding }),
    );
  });

  it('every registered cell is a distinct set of effective values', async () => {
    const drafts = cellDrafts();
    const ids = await Promise.all(drafts.map(cellIdOf));
    assert.equal(new Set(ids).size, ids.length, 'two cells with one identity would be one cell wearing two roles');
    assert.equal(new Set(drafts.map((d) => d.key)).size, drafts.length);
  });

  it('the held-out split is a reproducible draw, not three names', () => {
    const release = ['conv-26', 'conv-30', 'conv-41', 'conv-42', 'conv-43', 'conv-44', 'conv-47', 'conv-48', 'conv-49', 'conv-50'];
    assert.deepEqual(confirmationConversations(release, 17753), ['conv-30', 'conv-44', 'conv-48']);
  });
});

// ---------------------------------------------------------------------------
// the generated contract
// ---------------------------------------------------------------------------

describe('the report\'s TypeScript is generated from its schema', () => {
  it('carries the generator\'s banner and no hand-written interface beside it', async () => {
    const source = await readFile(TYPES_PATH, 'utf8');
    assert.match(source, /^\/\/ Generated by @jarenjs\/emit from benchmark\/schemas\/locomo-policy\.schema\.json\.\n\/\/ Do not edit: regenerate instead\.\n/,
      `${TYPES_PATH} is not the generator's output; run npm run emit:types`);
    // the shapes the runtime reads, all of them declared once, here
    for (const name of ['LocomoPolicy', 'Registration', 'Cell', 'Attempt', 'Comparison', 'Power', 'Selection', 'Operations', 'Run']) {
      assert.match(source, new RegExp(`^export interface ${name} `, 'm'), `${name} is missing from the generated contract`);
    }
    const behaviour = await readFile('benchmark/lib/locomo-policy.ts', 'utf8');
    assert.equal(/^export interface (LocomoPolicy|Registration|Attempt|Comparison|Power|Selection|Run) /m.test(behaviour), false,
      'the behaviour module must import the report shapes, never mirror them');
  });
});

// ---------------------------------------------------------------------------
// the schema refuses the arithmetic, not the test
// ---------------------------------------------------------------------------

async function fixture(): Promise<LocomoPolicy> {
  if (!dataset.available) throw new Error('the fixture needs the release');
  return runLocomoPolicy(available!, { phase: 'screen', samples: ['conv-30'], source: SOURCE });
}

/** A report with one member replaced, re-identified so only the intended breakage remains. */
function broken(report: LocomoPolicy, mutate: (draft: LocomoPolicy) => void): LocomoPolicy {
  const draft = JSON.parse(JSON.stringify(report)) as LocomoPolicy;
  mutate(draft);
  return draft;
}

describe('validation refuses a report that does not reconcile', { skip: missing }, () => {
  it('accepts the honest one', async () => {
    const report = await fixture();
    const outcome = validate(report);
    assert.equal(outcome.valid, true, JSON.stringify(outcome.errors?.slice(0, 5)));
  });

  it('refuses a denominator that does not sum, and names the assertion', async () => {
    const report = await fixture();
    const outcome = validate(broken(report, (d) => { d.attempts[0].denominators.planned += 1; }));
    assert.equal(outcome.valid, false, 'planned that is not answered + unanswered + invalid must not validate');
    const keywords = (outcome.errors ?? []).map((e) => (e as { keyword?: string }).keyword);
    assert.ok(keywords.includes('$query'), `the failing assertion is not named: ${JSON.stringify(outcome.errors?.slice(0, 3))}`);
  });

  it('refuses an operation census whose forks do not reconcile', async () => {
    const report = await fixture();
    for (const mutate of [
      (d: LocomoPolicy) => { d.attempts[0].operations.judgeFailures += 1; },
      (d: LocomoPolicy) => { d.attempts[0].operations.contradictionSkips += 1; },
      (d: LocomoPolicy) => { d.attempts[0].operations.mergeSkips += 1; },
      (d: LocomoPolicy) => { d.attempts[0].operations.filtered += 1; },
      (d: LocomoPolicy) => { d.attempts[0].operations.superseded += 1; },
    ]) {
      assert.equal(validate(broken(report, mutate)).valid, false, 'a census that does not reconcile must not validate');
    }
  });

  it('refuses an eligible row that is hiding a failure', async () => {
    const report = await fixture();
    // the census says a judgment failed while the row still calls itself eligible
    const hidden = broken(report, (d) => {
      d.attempts[1].operations.judgeAttempts += 1;
      d.attempts[1].operations.judgeFailures += 1;
    });
    assert.equal(validate(hidden).valid, false);
  });

  it('refuses two rows compared on different question sets or denominators', async () => {
    const report = await fixture();
    assert.equal(validate(broken(report, (d) => { d.comparisons[0].questionSet = 'f'.repeat(64); })).valid, false);
    assert.equal(validate(broken(report, (d) => { d.comparisons[0].pairs -= 1; })).valid, false);
  });

  it('refuses a promotion the interval does not support', async () => {
    const report = await fixture();
    assert.equal(validate(broken(report, (d) => { d.comparisons[0].verdict.promotes = true; })).valid, false);
  });

  it('refuses a cause partition that does not sum to its denominator, or drops a bucket', async () => {
    const report = await fixture();
    assert.equal(validate(broken(report, (d) => { d.attempts[0].causes!.byK['10'].denominator += 1; })).valid, false,
      'a partition that does not sum to its denominator');
    assert.equal(validate(broken(report, (d) => { d.attempts[0].causes!.byK['10'].partition.pop(); })).valid, false,
      'a dropped bucket is refused by validation, not only by a test');
    assert.equal(validate(broken(report, (d) => {
      const at = d.attempts[0].causes!.byK['10'];
      at.partition[1] = { ...at.partition[1], cause: at.partition[0].cause };
    })).valid, false, 'a cause counted twice is not a partition');
  });

  it('refuses an unregistered cell, a duplicate identity and a stray secret', async () => {
    const report = await fixture();
    assert.equal(validate(broken(report, (d) => { d.attempts[0].cellId = 'e'.repeat(64); })).valid, false, 'an attempt of a cell nobody registered');
    assert.equal(validate(broken(report, (d) => { d.registration.cells[1].cellId = d.registration.cells[0].cellId; })).valid, false, 'a duplicate cell identity');
    assert.equal(validate(broken(report, (d) => { (d.attempts[0].run as unknown as Record<string, unknown>).apiKey = 'sk-live-1234'; })).valid, false,
      'key material has no member to arrive in');
    assert.equal(validate(broken(report, (d) => { (d as unknown as Record<string, unknown>).apiKey = 'sk-live-1234'; })).valid, false);
  });

  it('refuses a confirmation attempted while the shortlist is open, and a decision without one', async () => {
    const report = await fixture();
    assert.equal(validate(broken(report, (d) => { d.attempts[0].phase = 'confirmation'; d.comparisons.length = 0; })).valid, false);
    assert.equal(validate(broken(report, (d) => {
      d.selection.decision = { default: d.registration.cells[0].cellId, qualifiesAsDefault: false, rule: 'because', statement: 'nothing qualified', reasons: [] };
    })).valid, false, 'a decision before confirmation is a decision nobody measured');
  });
});

// ---------------------------------------------------------------------------
// eligibility and merging
// ---------------------------------------------------------------------------

describe('a failure refuses the comparison instead of leaving it', { skip: missing }, () => {
  const denominators = { planned: 10, answered: 10, unanswered: { wire: 0, budget: 0 }, invalid: 0, questionSet: 'a'.repeat(64) };

  it('names every way a row stops being comparable', () => {
    assert.deepEqual(eligibilityReasons(denominators, emptyCensus()), []);
    const codes = (d: Partial<typeof denominators>, o: Partial<ReturnType<typeof emptyCensus>> = {}): string[] =>
      eligibilityReasons({ ...denominators, ...d } as typeof denominators, { ...emptyCensus(), ...o }).map((r) => r.code);
    assert.deepEqual(codes({ answered: 9, unanswered: { wire: 1, budget: 0 } }), ['incomplete', 'wire-failure']);
    assert.deepEqual(codes({ answered: 9, unanswered: { wire: 0, budget: 1 } }), ['incomplete', 'budget-stop']);
    assert.deepEqual(codes({ answered: 9, invalid: 1 }), ['incomplete', 'invalid-reply']);
    assert.deepEqual(codes({}, { judgeAttempts: 1, judgeFailures: 1 }), ['judge-failure']);
    assert.deepEqual(codes({}, { confirmed: 1, contradictionSkips: 1 }), ['policy-application-failure']);
    assert.deepEqual(codes({}, { crystallizePlanned: 1, mergeSkips: 1 }), ['policy-application-failure']);
  });

  it('refuses two rows that are not one experiment', async () => {
    const report = await fixture();
    const [inert, shipped] = report.attempts;
    assert.deepEqual(comparabilityReasons(shipped, inert), []);
    const codes = (mutate: (a: Attempt) => Attempt): string[] => comparabilityReasons(mutate(structuredClone(shipped)), inert).map((r) => r.code);
    assert.ok(codes((a) => { a.denominators.questionSet = 'f'.repeat(64); return a; }).includes('different-questions'));
    assert.ok(codes((a) => { a.denominators.answered -= 1; return a; }).includes('unequal-denominator'));
    assert.ok(codes((a) => { a.run.embedder = { model: 'baai/bge-m3', dims: 1024 }; return a; }).includes('different-embedding-identity'));
    assert.ok(codes((a) => { a.run.answerModel = 'other'; return a; }).includes('different-model'));
    assert.ok(codes((a) => { a.run.source = 'f'.repeat(64); return a; }).includes('different-source'));
    assert.ok(codes((a) => { a.phase = 'confirmation'; return a; }).includes('different-phase'));
    assert.ok(codes((a) => { a.eligibility = { eligible: false, reasons: [{ code: 'wire-failure', detail: 'the wire failed' }] }; return a; }).includes('wire-failure'));
  });

  it('an ineligible comparison can never promote, whatever its point estimate says', async () => {
    const report = await fixture();
    const [inert, shipped] = report.attempts;
    const failed = structuredClone(shipped);
    failed.eligibility = { eligible: false, reasons: [{ code: 'wire-failure', detail: 'one question was never asked' }] };
    const comparison = comparisonOf(failed, inert, POLICY_OBJECTIVE, 'evidence-recall');
    assert.equal(comparison.eligible, false);
    assert.equal(comparison.verdict.promotes, false);
    assert.ok(comparison.verdict.clauses.some((c) => c.clause === 'eligible' && !c.passed));
    assert.ok(comparison.reasons.some((r) => r.code === 'wire-failure'), 'the row is published with its reason, not dropped');
  });

  it('refuses an attempt that is not registered, clashes, or jumps the held-out gate', async () => {
    const report = await fixture();
    const fresh = structuredClone(report.attempts[1]);
    assert.throws(() => mergeAttempt(report, { ...fresh, cellId: 'e'.repeat(64) }), /not in the registration/);
    assert.throws(() => mergeAttempt(report, { ...fresh, runId: 'e'.repeat(64) }), /already has a screen attempt/);
    assert.throws(() => mergeAttempt(report, { ...fresh, phase: 'confirmation' }), /while the shortlist is open/);
    // the same run identity is a replay completing a registered cell
    const merged = mergeAttempt(report, fresh);
    assert.equal(merged.attempts.length, report.attempts.length);
  });
});

// ---------------------------------------------------------------------------
// power, over the pair the campaign was sized against
// ---------------------------------------------------------------------------

describe('every comparison publishes what it could have seen', { skip: missing }, () => {
  it('reproduces the committed live pair\'s power exactly', async () => {
    const live = JSON.parse(await readFile(LIVE_PATH, 'utf8')) as {
      configurations: Array<{ key: string, questions: { results: Array<{ id: string, category: 1 | 2 | 3 | 4, f1: number, replayed: number }> } }>;
    };
    const rowOf = (key: string) => live.configurations.find((c) => c.key === key)!;
    // a chat call the wire cache replayed is a prompt the policies left
    // byte-identical: the acting set is read from the prompt, never the score
    const attemptOf = async (key: string): Promise<Attempt> => {
      const results = rowOf(key).questions.results.map((r) => ({
        id: r.id, category: r.category, score: r.f1, f1: r.f1, ceiling: 0,
        promptSha256: (r.replayed > 0 ? 'a' : key === 'near' ? 'b' : 'a').repeat(64), tokens: 0, calls: 0,
      }));
      const denominators = { planned: results.length, answered: results.length, unanswered: { wire: 0, budget: 0 }, invalid: 0, questionSet: await questionSetOf(results.map((r) => r.id)) };
      const run = {
        tier: 'live' as const, provider: 'openrouter', endpoint: 'https://openrouter.ai/api/v1',
        answerModel: 'z-ai/glm-5.3-flash', judgeModel: 'qwen/qwen3.8-27b', embedder: { model: 'baai/bge-m3', dims: 1024 },
        thinking: 'default' as const, responseSchema: null, retry: null, deadlineMs: null, concurrency: 4,
        budgetCeiling: 200, keySource: 'OPENROUTER_AI_KEY', questionSet: denominators.questionSet,
        sampleIds: results.map((r) => r.id), source: SOURCE.sha256,
      };
      return {
        cellId: await canonicalSha256(key), runId: await canonicalSha256([key, 'run']), phase: 'selection' as const, run,
        denominators, eligibility: { eligible: true, reasons: [] }, operations: emptyCensus(),
        causes: { version: CAUSE_VOCABULARY, byK: { 10: { denominator: 0, partition: CAUSES.map((cause) => ({ cause, count: 0 })) } } },
        prompts: {
          unchanged: results.filter((r) => r.promptSha256 === 'a'.repeat(64)).length,
          changed: results.filter((r) => r.promptSha256 !== 'a'.repeat(64)).length,
          changedIds: results.filter((r) => r.promptSha256 !== 'a'.repeat(64)).map((r) => r.id),
          tokenProxy: 0, proxy: 'sizeOf-characters' as const, against: await canonicalSha256('near-raw'),
        },
        recall: null, oracleCeiling: null, verbatimFloor: null, quality: { f1: null, ceiling: null, citedRecall: null }, cost: null, results,
      };
    };
    const near = await attemptOf('near');
    const raw = await attemptOf('near-raw');
    const pairs = pairsOf(near, raw);
    assert.equal(pairs.length, 64);

    const power = powerOf(pairs, POLICY_OBJECTIVE.level);
    assert.equal(power.pairedSd.toFixed(4), '0.0697');
    assert.equal(power.standardError.toFixed(4), '0.0087');
    assert.equal(power.minimumDetectableEffect.toFixed(4), '0.0171');
    assert.equal(power.tiedPairs, 59);
    assert.equal(power.actingSetSize, 17);

    const comparison = comparisonOf({ ...near, phase: 'confirmation' }, { ...raw, phase: 'confirmation' }, POLICY_OBJECTIVE, 'locomo-f1');
    assert.equal(comparison.mean.toFixed(4), '-0.0091');
    assert.equal(comparison.actingSet.size, 17);
    assert.equal(comparison.actingSet.mean.toFixed(4), '-0.0341');
    assert.equal(comparison.actingSet.sd.toFixed(4), '0.1350');
    assert.equal(comparison.verdict.promotes, false);
    assert.match(comparison.boundedNull, /no effect larger than 0\.0171 was detectable at 64 pairs/);
    // the per-category noise the registered samples were sized against
    const sds = Object.fromEntries(comparison.byCategory.map((c) => [c.category, c.sd.toFixed(4)]));
    assert.deepEqual(sds, { 1: '0.0016', 2: '0.1250', 3: '0.0637', 4: '0.0000' });
    for (const row of comparison.byCategory) assert.equal(row.pairs, 16);
  });

  it('sizes the registered samples against that SD, as designed', () => {
    const z = normalQuantile(1 - (1 - POLICY_OBJECTIVE.level) / 2);
    assert.equal((z * 0.0697 / Math.sqrt(64)).toFixed(4), '0.0171', 'the selection sample');
    assert.equal((z * 0.0697 / Math.sqrt(89)).toFixed(4), '0.0145', 'the confirmation sample');
    // 16 per category puts a truly neutral category 2 below the floor on noise alone; 24 does not
    const bound = (n: number): number => -normalQuantile(POLICY_OBJECTIVE.categoryLevel) * 0.125 / Math.sqrt(n);
    assert.ok(bound(16) < POLICY_OBJECTIVE.categoryLowerBound, `${bound(16)} is not below ${POLICY_OBJECTIVE.categoryLowerBound}`);
    assert.ok(bound(24) > POLICY_OBJECTIVE.categoryLowerBound);
  });

  it('the bootstrap is seeded, so an interval is a property of the data', () => {
    const deltas = Array.from({ length: 40 }, (_, i) => (i % 7) / 10 - 0.3);
    const options = { resamples: 2000, seed: 17753, level: 0.95 };
    assert.deepEqual(bootstrapInterval(deltas, options), bootstrapInterval(deltas, options));
    assert.notDeepEqual(bootstrapInterval(deltas, options), bootstrapInterval(deltas, { ...options, seed: 1 }));
    assert.deepEqual(bootstrapInterval([], options), { low: 0, high: 0 });
  });

  it('reads the acting set from the prompt, never from the score', async () => {
    const report = await fixture();
    const [inert, shipped] = report.attempts;
    const pairs = pairsOf(shipped, inert);
    const acting = pairs.filter((p) => p.acting).length;
    const scored = pairs.filter((p) => p.delta !== 0).length;
    assert.ok(acting > scored, 'a cell that changed a prompt without changing a score is still acting');
    for (const pair of pairs) {
      if (pair.delta !== 0) assert.equal(pair.acting, true, `${pair.id} changed a score without changing a prompt`);
    }
  });
});

// ---------------------------------------------------------------------------
// the source revision
// ---------------------------------------------------------------------------

describe('the source revision is HEAD plus the bytes', () => {
  it('lists what a cell actually reads, and agrees with itself', async () => {
    const first = await sourceRevision();
    const second = await sourceRevision();
    assert.deepEqual(first, second);
    assert.match(first.head, /^[0-9a-f]{40}$/);
    const paths = first.files.map((f) => f.path);
    for (const path of [
      'packages/memory/src/contradiction.ts', 'packages/memory/src/crystallize.ts',
      'packages/pipeline/src/run.ts', 'benchmark/lib/locomo-policy.ts',
      'benchmark/schemas/locomo-policy.schema.json', 'benchmark/locomo-policy.ts',
    ]) assert.ok(paths.includes(path), `${path} is not in the manifest`);
    assert.deepEqual(paths, [...paths].sort(), 'the manifest is ordered, so its digest is stable');
    assert.equal(paths.some((p) => p.startsWith('TODO')), false, 'ignored campaign scratch is not source');
    assert.equal(paths.some((p) => p === 'README.md'), false, 'an unrelated file does not move a run identity');
  });

  it('moves when an in-scope byte moves, without waiting for a commit', async () => {
    const one = await canonicalSha256({ head: SOURCE.head, files: SOURCE.files });
    const changed = await canonicalSha256({ head: SOURCE.head, files: [{ ...SOURCE.files[0], sha256: 'c'.repeat(64) }] });
    assert.notEqual(changed, one);
  });
});

// ---------------------------------------------------------------------------
// the instrument
// ---------------------------------------------------------------------------

describe('the keyless policy screen', { skip: missing }, () => {
  it('is byte-identical across two runs of the same registration and bytes', async () => {
    const first = await fixture();
    const second = await fixture();
    assert.equal(JSON.stringify(first, null, 2), JSON.stringify(second, null, 2));
    assert.equal(renderMarkdown(first), renderMarkdown(second));
    assert.equal(first.reportId, second.reportId);
  });

  it('proves its scorer before it publishes a number, and publishes the losses', async () => {
    const report = await fixture();
    assert.deepEqual(report.gate.failures, []);
    assert.equal(report.gate.passed, true);
    assert.equal(report.selection.state, 'open', 'nothing is frozen until a screen has run');
    assert.equal(report.selection.finalist, null);
    assert.equal(report.selection.decision, null);
    const shipped = report.comparisons[0];
    assert.equal(shipped.metric, 'evidence-recall');
    assert.equal(shipped.verdict.promotes, false, 'a keyless recall row can never promote a default');
    assert.ok(shipped.verdict.clauses.some((c) => c.clause === 'primary-objective' && !c.passed));
    assert.ok(shipped.verdict.clauses.some((c) => c.clause === 'held-out-split' && !c.passed));
    assert.deepEqual(shipped.verdict.clauses.map((c) => c.clause),
      ['eligible', 'primary-objective', 'held-out-split', 'overall-interval', 'category-floor', 'token-ratio', 'call-ratio', 'acting-set'],
      'every registered clause is published, passed or not');
    assert.ok(shipped.boundedNull.includes('no effect larger than'));
    const markdown = renderMarkdown(report);
    assert.match(markdown, /judge failed/);
    assert.match(markdown, /min\. detectable/);
    assert.match(markdown, /Gate passed/);
  });

  it('refuses a cell nobody registered and a sample the release does not hold', async () => {
    await assert.rejects(runLocomoPolicy(available!, { phase: 'screen', samples: ['conv-30'], cells: ['nonsense'], source: SOURCE }), /no cell 'nonsense'/);
    await assert.rejects(runLocomoPolicy(available!, { phase: 'screen', samples: ['conv-99'], source: SOURCE }), /no sample 'conv-99'/);
  });
});

// ---------------------------------------------------------------------------
// the cause census
// ---------------------------------------------------------------------------

/** A disposition assembled by hand, so every branch can be forced. */
function disposition(over: Partial<Disposition> = {}): Disposition {
  return {
    addresses: new Set(['conv-1/D1:1']),
    idOf: new Map([['conv-1/D1:1', 'm-abc-3']]),
    byId: new Map(),
    owners: new Map(),
    mergedFrom: new Set(),
    ...over,
  };
}

function ranking(over: Partial<Ranking> = {}): Ranking {
  return { passing: [], passingAddresses: new Set(), unranked: 0, comparable: () => true, ...over };
}

function unit(id: string, over: Partial<MemoryUnit> = {}): MemoryUnit {
  return {
    id, text: id, evidence: 'conv-1/D1:1', tags: [], at: '2026-08-24T10:00:00Z', kind: 'event',
    embedding: [1, 0], embeddedBy: { model: 'hash-trigram-64', dims: 64 }, ...over,
  } as MemoryUnit;
}

describe('every gold address gets exactly one terminal cause', { skip: missing }, () => {
  const A = 'conv-1/D1:1';

  it('names each disposition, in the vocabulary\'s order', () => {
    assert.equal(causeOf('conv-1/D9:9', disposition(), ranking(), new Set()), 'source-unresolved');

    // the content-addressed id is shared and the stored record credits the other turn
    assert.equal(causeOf(A, disposition({ byId: new Map([['m-abc-3', unit('m-abc-3', { evidence: 'conv-1/D2:2' })]]) }), ranking(), new Set()),
      'content-collapsed');

    // nothing holds the id at all: the gate refused it
    assert.equal(causeOf(A, disposition(), ranking(), new Set()), 'novelty-filtered');

    // a survivor absorbed it without crediting the address
    assert.equal(causeOf(A, disposition({ mergedFrom: new Set(['m-abc-3']) }), ranking(), new Set()), 'crystallized-not-carried');

    const owned = (u: MemoryUnit): Disposition => disposition({ owners: new Map([[A, [u]]]), byId: new Map([[u.id, u]]) });
    assert.equal(causeOf(A, owned(unit('m-abc-3', { supersededBy: 'other' })), ranking(), new Set()), 'contradiction-superseded');
    assert.equal(causeOf(A, owned(unit('m-abc-3')), ranking(), new Set([A])), 'retrieved');
    assert.equal(causeOf(A, owned(unit('m-abc-3')), ranking({ passingAddresses: new Set([A]) }), new Set()), 'outside-k');
    assert.equal(causeOf(A, owned(unit('m-abc-3')), ranking({ comparable: () => false }), new Set()), 'identity-unranked');
    assert.equal(causeOf(A, owned(unit('m-abc-3')), ranking(), new Set()), 'below-min-score');
  });

  it('reads its dispositions from the store the pipeline left', async () => {
    const report = await fixture();
    assert.equal(report.attempts.length, 2);
    for (const attempt of report.attempts) {
      assert.equal(attempt.causes!.version, CAUSE_VOCABULARY);
      for (const k of [5, 10, 20]) {
        const at = attempt.causes!.byK[String(k)];
        assert.ok(at !== undefined, `no census at k=${k}`);
        assert.deepEqual(at.partition.map((p) => p.cause), [...CAUSES], 'every bucket, in the vocabulary\'s order');
        assert.equal(at.partition.reduce((n, p) => n + p.count, 0), at.denominator);
      }
      // more of the corpus reaches a larger prompt, and nothing else moves
      const retrieved = (k: number): number => attempt.causes!.byK[String(k)].partition.find((p) => p.cause === 'retrieved')!.count;
      assert.ok(retrieved(20) >= retrieved(10) && retrieved(10) >= retrieved(5));
    }
  });

  it('the denominator is the gold addresses of the scored questions, counted independently', async () => {
    const report = await fixture();
    const corpus = conversationCorpus(available!.samples.find((s) => s.sample_id === 'conv-30')!);
    const scored = new Set(report.attempts[0].results.map((r) => r.id));
    const gold = questionsOf(available!.samples.find((s) => s.sample_id === 'conv-30')!, corpus)
      .filter((q) => scored.has(q.id))
      .reduce((n, q) => n + q.gold.length, 0);
    for (const attempt of report.attempts) {
      for (const k of [5, 10, 20]) assert.equal(attempt.causes!.byK[String(k)].denominator, gold, `k=${k}`);
    }
  });
});

// ---------------------------------------------------------------------------
// the registry, the holdout lock and the frozen shortlist
// ---------------------------------------------------------------------------

describe('the registered cells', { skip: missing }, () => {
  it('is exactly the inert reference, the shipped control and 18 isolated levels', async () => {
    const drafts = cellDrafts();
    const byRole = drafts.reduce<Record<string, number>>((n, d) => ({ ...n, [d.role]: (n[d.role] ?? 0) + 1 }), {});
    assert.deepEqual(byRole, { inert: 1, shipped: 1, isolated: 18 }, 'before any pairwise expansion');
    const byAxis = drafts.filter((d) => d.role === 'isolated')
      .reduce<Record<string, number>>((n, d) => ({ ...n, [d.axis!]: (n[d.axis!] ?? 0) + 1 }), {});
    assert.deepEqual(byAxis, { novelty: 4, contradiction: 3, crystallize: 3, k: 2, minScore: 3, offlineWidth: 3 });

    // every cell carries the inert levels it did not change
    const inert = drafts[0];
    assert.deepEqual(inert.ingest, { novelty: 2, contradiction: 2, crystallize: 2, maxPairs: 20 });
    assert.deepEqual(inert.retrieval, { k: 10, minScore: 0 });
    assert.deepEqual(inert.embedding, { model: 'hash-trigram-64', dims: 64 });
    for (const d of drafts.filter((x) => x.role === 'isolated')) {
      const changed = [
        d.ingest.novelty !== inert.ingest.novelty, d.ingest.contradiction !== inert.ingest.contradiction,
        d.ingest.crystallize !== inert.ingest.crystallize, d.retrieval.k !== inert.retrieval.k,
        d.retrieval.minScore !== inert.retrieval.minScore, d.embedding.dims !== inert.embedding.dims,
      ].filter(Boolean).length;
      assert.equal(changed, 1, `${d.key} changes ${changed} axes, not one`);
    }
  });

  it('a selection screen cannot read the held-out conversations', async () => {
    await assert.rejects(runLocomoPolicy(available!, { phase: 'selection', samples: ['conv-30'], source: SOURCE }),
      /conv-30 is a held-out confirmation conversation/);
    await assert.rejects(runLocomoPolicy(available!, { phase: 'selection', samples: ['conv-26', 'conv-44'], source: SOURCE }),
      /conv-44 is a held-out confirmation conversation/);
  });

  it('the ladder is read at each cell\'s own k, and a fixed k is never used', () => {
    const row = (over: Partial<Objectives>): Objectives =>
      ({ cellId: 'a'.repeat(64), recall: 0, floor: 0, tokenProxy: 0, operations: 0, ...over });
    // a k=20 cell retrieves more and pays more; a k=5 cell the reverse.
    // The ladder must prefer the recall it can see AT ITS OWN k, and only
    // then charge for the tokens that bought it.
    const wide = row({ cellId: 'b'.repeat(64), recall: 0.31, floor: 0.02, tokenProxy: 200000, operations: 0 });
    const narrow = row({ cellId: 'c'.repeat(64), recall: 0.12, floor: 0.02, tokenProxy: 50000, operations: 0 });
    assert.ok(compareByLadder(wide, narrow) < 0, 'recall at the cell\'s own k leads the ladder');
    // equal recall and floor: the cheaper prompt wins, then fewer operations, then identity
    assert.ok(compareByLadder(row({ cellId: 'b'.repeat(64), recall: 0.2, tokenProxy: 10 }), row({ cellId: 'c'.repeat(64), recall: 0.2, tokenProxy: 20 })) < 0);
    assert.ok(compareByLadder(row({ cellId: 'b'.repeat(64), operations: 1 }), row({ cellId: 'c'.repeat(64), operations: 2 })) < 0);
    assert.ok(compareByLadder(row({ cellId: 'b'.repeat(64) }), row({ cellId: 'c'.repeat(64) })) < 0, 'ties break by ascending identity');
    // domination is over all four objectives at once
    assert.equal(dominates(row({ recall: 0.3, floor: 0.1, tokenProxy: 5, operations: 1 }), row({ recall: 0.2, floor: 0.1, tokenProxy: 5, operations: 1 })), true);
    assert.equal(dominates(row({ recall: 0.3, tokenProxy: 9 }), row({ recall: 0.2, tokenProxy: 5 })), false, 'better recall at a higher cost dominates nothing');
  });
});

// ---------------------------------------------------------------------------
// the committed screen
// ---------------------------------------------------------------------------

const committed = JSON.parse(await readFile(POLICY_PATH, 'utf8')) as LocomoPolicy;

describe('the committed selection screen', { skip: missing }, () => {

  it('validates, and its document is rendered from it', async () => {
    const outcome = validate(committed);
    assert.equal(outcome.valid, true, JSON.stringify(outcome.errors?.slice(0, 5)));
    assert.equal(`${renderMarkdown(committed)}\n`, await readFile(POLICY_DOC, 'utf8'),
      `${POLICY_DOC} is stale; regenerate it with npm run benchmark:locomo:policy -- --cells all --json ${POLICY_PATH} --md ${POLICY_DOC}`);
  });

  it('screened the selection split only, over the registered sample', () => {
    assert.deepEqual(committed.dataset.restricted, ['conv-26', 'conv-41', 'conv-42', 'conv-43', 'conv-47', 'conv-49', 'conv-50']);
    assert.deepEqual(committed.registration.splits.confirmation.conversations, ['conv-30', 'conv-44', 'conv-48']);
    for (const attempt of committed.attempts) {
      assert.equal(attempt.phase, 'selection');
      assert.equal(attempt.run.tier, 'keyless');
      assert.equal(attempt.denominators.answered, committed.registration.splits.selection.scorable);
      assert.equal(attempt.eligibility.eligible, true, `${attempt.cellId} is not eligible`);
    }
    assert.equal(committed.gate.passed, true);
    assert.deepEqual(committed.gate.failures, []);
  });

  it('registered 20 cells before pairwise expansion, and only frontier pairs after', () => {
    const roles = committed.registration.cells.reduce<Record<string, number>>((n, c) => ({ ...n, [c.role]: (n[c.role] ?? 0) + 1 }), {});
    assert.equal(roles.inert, 1);
    assert.equal(roles.shipped, 1);
    assert.equal(roles.isolated, 18);
    assert.ok((roles.combination ?? 0) > 0, 'the frontier earned at least one pairwise cell');
    for (const cell of committed.registration.cells.filter((c) => c.role === 'combination')) {
      assert.equal(cell.embedding.dims, 64, 'a width can never be part of a live candidate');
      assert.ok(cell.key.includes('+'));
    }
    assert.equal(new Set(committed.registration.cells.map((c) => c.cellId)).size, committed.registration.cells.length);
  });

  it('froze at most four non-control candidates, with every rejection named', () => {
    const cellOf = (id: string) => committed.registration.cells.find((c) => c.cellId === id)!;
    assert.equal(committed.selection.state, 'frozen');
    assert.ok(committed.selection.frozen !== null);
    assert.deepEqual(committed.selection.frozen!.cells, committed.selection.shortlist);
    const shortlisted = committed.selection.shortlist.map(cellOf);
    assert.equal(shortlisted.filter((c) => c.role === 'inert' || c.role === 'shipped').length, 2, 'both controls are retained');
    const candidates = shortlisted.filter((c) => c.role !== 'inert' && c.role !== 'shipped');
    assert.ok(candidates.length <= 4, `${candidates.length} non-control cells were frozen`);
    for (const c of candidates) {
      assert.equal(c.retrieval.k, 10, 'a k=20 cell cannot satisfy the token clause and is never shortlisted');
      assert.equal(c.embedding.dims, 64, 'a built-in width cell can never be a live treatment');
    }
    // every cell is either shortlisted or excluded with a reason — nothing is silently dropped
    const accounted = new Set([...committed.selection.shortlist, ...committed.selection.excluded.map((e) => e.cellId)]);
    for (const cell of committed.registration.cells) assert.ok(accounted.has(cell.cellId), `${cell.key} is neither shortlisted nor excluded`);
    for (const code of ['cost-infeasible', 'live-inapplicable', 'dominated'] as const) {
      assert.ok(committed.selection.excluded.some((e) => e.code === code), `no cell was excluded as ${code}`);
    }
    for (const e of committed.selection.excluded) assert.ok(e.detail.length > 0);
    // the k=20 cell is the cost-infeasible one the design predicted
    const infeasible = committed.selection.excluded.filter((e) => e.code === 'cost-infeasible').map((e) => cellOf(e.cellId));
    assert.ok(infeasible.every((c) => c.retrieval.k === 20), 'the cost-infeasible cells are the k=20 ones');
    const inapplicable = committed.selection.excluded.filter((e) => e.code === 'live-inapplicable').map((e) => cellOf(e.cellId));
    assert.deepEqual(inapplicable.map((c) => c.embedding.dims).sort((a, b) => a - b), [128, 256, 512]);
  });

  it('proposes one built-in width, labelled a lexical-tier result', () => {
    const w = committed.widthDecision!;
    assert.equal(w.tier, 'lexical');
    assert.equal(w.k, 10);
    assert.deepEqual(w.rows.map((r) => r.dims), [64, 128, 256, 512]);
    assert.ok(w.rows.some((r) => r.dims === w.proposedDims));
    assert.match(w.caveat, /never serves a live answer/);
    assert.match(w.caveat, /not an answer-quality result/);
  });

  it('publishes the prompt proxy as a proxy, and no cell claims a change it did not make', () => {
    const inert = committed.attempts.find((a) => committed.registration.cells.find((c) => c.cellId === a.cellId)!.role === 'inert')!;
    assert.equal(inert.prompts.changed, 0);
    assert.equal(inert.prompts.changedIds.length, 0);
    assert.equal(inert.prompts.unchanged, inert.denominators.answered);
    const inertPrompts = new Map(inert.results.map((r) => [r.id, r.promptSha256]));
    for (const attempt of committed.attempts) {
      assert.equal(attempt.prompts.proxy, 'sizeOf-characters');
      assert.equal(attempt.prompts.against, inert.cellId);
      assert.equal(attempt.prompts.unchanged + attempt.prompts.changed, attempt.denominators.answered);
      const expected = attempt.results.filter((r) => inertPrompts.get(r.id) !== r.promptSha256).map((r) => r.id);
      assert.deepEqual(attempt.prompts.changedIds, expected, 'the changed set is read from prompt bytes');
      // and it is the acting set the comparison publishes
      const comparison = committed.comparisons.find((c) => c.treatment === attempt.cellId);
      if (comparison !== undefined) assert.equal(comparison.actingSet.size, attempt.prompts.changed);
    }
  });

  it('makes no answer-quality claim anywhere in its document', async () => {
    const doc = await readFile(POLICY_DOC, 'utf8');
    assert.match(doc, /hashed-trigram reference/, 'the embedder is named lexical');
    assert.match(doc, /a screen allocates budget; it does not predict the wire/);
    assert.match(doc, /Nothing on this page is such a proof/);
    assert.match(doc, /Where every gold address went/);
    assert.match(doc, /verbatim floor/);
    assert.match(doc, /Every cell the screen rejected/, 'losses are published beside gains');
    assert.equal(committed.comparisons.every((c) => !c.verdict.promotes), true, 'a screen promotes nothing');
    assert.equal(committed.selection.finalist, null);
    assert.equal(committed.selection.decision, null);
  });
});

// ---------------------------------------------------------------------------
// the live tier, against a scripted wire — no key, no network, no spend
// ---------------------------------------------------------------------------

const CONTROLS: InferenceControls = {
  provider: 'openrouter',
  endpoint: 'https://openrouter.ai/api/v1',
  answerModel: 'fast',
  judgeModel: 'strong',
  embedder: { model: 'stub-embed', dims: 8 },
  thinking: 'default',
  responseSchema: RESPONSE_SCHEMA_REVISION,
  retry: { attempts: 8, baseMs: 3000, maxMs: 60000 },
  deadlineMs: null,
  concurrency: 3,
  perRunCeiling: 1000,
  campaignCeiling: 900,
  keySource: 'OPENROUTER_AI_KEY',
};

describe('a plan is not permission', () => {
  it('prices what a phase would spend, and never a key', async () => {
    const plan = planOf({
      phase: 'selection', cells: ['a'.repeat(64), 'b'.repeat(64)],
      scorable: 64, adversarial: 6, embedFresh: 17, embedCached: 0,
      controls: CONTROLS, inference: await inferenceIdentityOf(CONTROLS),
    });
    assert.equal(plan.requests.chat, 2 * 70, 'one answer per scorable and per adversarial question, per cell');
    assert.equal(plan.requests.judge, 2 * 6, 'and one judgment per adversarial answer');
    assert.equal(plan.requests.total, 17 + 140 + 12);
    assert.equal(plan.withinCeilings, true);
    // a census buys embeddings and nothing else
    const census = planOf({ phase: 'census', cells: ['a'.repeat(64)], scorable: 64, adversarial: 6, embedFresh: 9, embedCached: 100, controls: CONTROLS, inference: null });
    assert.deepEqual(census.requests, { embedFresh: 9, embedCached: 100, chat: 0, judge: 0, total: 9 });
    assert.deepEqual(census.questions, { scorable: 0, adversarial: 0 });
    // and a plan that would exceed a ceiling says so instead of trying
    const over = planOf({ phase: 'selection', cells: ['a'.repeat(64)], scorable: 64, adversarial: 6, embedFresh: 0, embedCached: 0, controls: { ...CONTROLS, perRunCeiling: 10 }, inference: null });
    assert.equal(over.withinCeilings, false);
  });

  it('the identity moves with every control that makes a run a different experiment', async () => {
    const base = await inferenceIdentityOf(CONTROLS);
    for (const change of [
      { answerModel: 'other' }, { judgeModel: 'other' }, { endpoint: 'https://example.test/v1' },
      { thinking: 'off' as const }, { concurrency: 8 }, { perRunCeiling: 400 }, { campaignCeiling: 100 },
      { retry: { attempts: 1, baseMs: 0, maxMs: 0 } }, { responseSchema: 'other@2' },
    ]) assert.notEqual(await inferenceIdentityOf({ ...CONTROLS, ...change }), base, JSON.stringify(change));
    // the key's NAME is part of the identity; the key can never be
    assert.notEqual(await inferenceIdentityOf({ ...CONTROLS, keySource: 'OTHER_KEY' }), base);
    const described = describePlan(
      planOf({ phase: 'census', cells: [], scorable: 0, adversarial: 0, embedFresh: 0, embedCached: 0, controls: CONTROLS, inference: base }),
      CONTROLS,
      (await fixture()).registration,
    ).join('\n');
    assert.match(described, /read from OPENROUTER_AI_KEY \(never printed, never hashed\)/);
    assert.equal(described.includes('sk-'), false);
  });
});

describe('the live census reads operations, never a score', { skip: missing }, () => {
  it('makes zero chat calls and drops only a cell that does what inert does', async () => {
    const env = scriptedEnv();
    const { fetch, calls } = scriptedFetch();
    const clients = liveClients(env, fetch);
    const embedder = clients.embedder as Embedder & { dims: number };
    const corpus = conversationCorpus(available!.samples.find((s) => s.sample_id === 'conv-30')!);
    const cells = committed.registration.cells.filter((c) => ['inert', 'shipped', 'minScore-0.25'].includes(c.key));
    const inertCellId = cells.find((c) => c.key === 'inert')!.cellId;

    const census = await runLiveCensus({
      cells, inertCellId, entries: [{ corpus }],
      embedder: { model: embedder.model, dims: embedder.dims ?? 8, embed: (t, h) => embedder.embed(t, h) },
    });
    assert.equal(census.chatCalls, 0);
    assert.deepEqual({ chat: calls.chat, judge: calls.judge, author: calls.author }, { chat: 0, judge: 0, author: 0 },
      'a census that answered a question would be a selection');
    assert.ok(census.embedRequests > 0);
    assert.equal(census.rows.length, 3);

    const inert = census.rows.find((r) => r.cellId === inertCellId)!;
    assert.equal(inert.mechanicallyInert, false, 'the reference is not inert against itself');
    // a minScore cell touches no ingest policy at all, so its operation
    // counts must equal inert's — it acts on the ranking, not the corpus
    const minScore = census.rows.find((r) => r.cellId === cells.find((c) => c.key === 'minScore-0.25')!.cellId)!;
    assert.deepEqual(minScore.operations, inert.operations);
    assert.equal(minScore.mechanicallyInert, true);
    assert.equal(minScore.dropped, true);
    // the shipped cell does change the corpus, so it survives
    const shipped = census.rows.find((r) => r.cellId === cells.find((c) => c.key === 'shipped')!.cellId)!;
    assert.equal(shipped.mechanicallyInert, false);
    assert.equal(shipped.dropped, false);
  });
});

describe('the challenger is chosen mechanically', () => {
  const cell = (n: number): string => String(n).repeat(64);
  const comparison = (over: Partial<Comparison>): Comparison => ({
    key: 'k', phase: 'selection', metric: 'locomo-f1', treatment: cell(1), control: cell(0),
    eligible: true, reasons: [], pairs: 64, questionSet: 'a'.repeat(64), mean: 0,
    interval: { low: -1, high: 1 },
    power: { pairedSd: 0.07, standardError: 0.009, minimumDetectableEffect: 0.017, tiedPairs: 59, actingSetSize: 17 },
    byCategory: [1, 2, 3, 4].map((category) => ({ category: category as 1, pairs: 16, mean: 0, sd: 0, lowerBound: 0 })),
    actingSet: { size: 17, mean: 0, sd: 0.1, interval: { low: -1, high: 1 }, blocks: false },
    cost: { tokenRatio: 1, callRatio: 1 },
    boundedNull: 'n', verdict: { promotes: false, clauses: [], reasons: [] },
    ...over,
  });

  it('takes the greatest delta among cells clearing every preliminary constraint', () => {
    const best = comparison({ treatment: cell(1), mean: 0.05 });
    const worse = comparison({ treatment: cell(2), mean: 0.02 });
    const choice = chooseChallenger([worse, best], [cell(1), cell(2)], POLICY_OBJECTIVE);
    assert.equal(choice.challenger, cell(1));
    assert.match(choice.calculation, /greatest eligible paired delta/);
  });

  it('breaks a tie by ascending cell identity, never by order of arrival', () => {
    const a = comparison({ treatment: cell(2), mean: 0.05 });
    const b = comparison({ treatment: cell(1), mean: 0.05 });
    assert.equal(chooseChallenger([a, b], [cell(1), cell(2)], POLICY_OBJECTIVE).challenger, cell(1));
    assert.equal(chooseChallenger([b, a], [cell(1), cell(2)], POLICY_OBJECTIVE).challenger, cell(1));
  });

  it('nominates a deliberately losing challenger when nothing clears the constraints', () => {
    const overrun = comparison({ treatment: cell(1), mean: 0.09, cost: { tokenRatio: 2, callRatio: 1 } });
    const loses = comparison({ treatment: cell(2), mean: -0.01, cost: { tokenRatio: 3, callRatio: 1 } });
    const choice = chooseChallenger([overrun, loses], [cell(1), cell(2)], POLICY_OBJECTIVE);
    assert.equal(choice.challenger, cell(1));
    assert.match(choice.calculation, /deliberately losing challenger/);
  });

  it('nominates nothing rather than the shipped cell when no candidate is eligible', () => {
    const blocked = comparison({ treatment: cell(1), eligible: false });
    const choice = chooseChallenger([blocked], [cell(1)], POLICY_OBJECTIVE);
    assert.equal(choice.challenger, null);
    assert.match(choice.calculation, /the shipped cell cannot be nominated in its place/);
  });

  it('a category regression, a call overrun and an acting-set harm each keep a cell out', () => {
    const regression = comparison({ treatment: cell(1), mean: 0.09, byCategory: [1, 2, 3, 4].map((c) => ({ category: c as 1, pairs: 16, mean: c === 2 ? -0.2 : 0, sd: 0, lowerBound: 0 })) });
    const calls = comparison({ treatment: cell(2), mean: 0.08, cost: { tokenRatio: 1, callRatio: 2 } });
    const clean = comparison({ treatment: cell(3), mean: 0.01 });
    const choice = chooseChallenger([regression, calls, clean], [cell(1), cell(2), cell(3)], POLICY_OBJECTIVE);
    assert.equal(choice.challenger, cell(3), 'the smaller clean delta beats two larger constrained ones');
  });
});

describe('the decision the next campaign consumes', { skip: missing }, () => {
  it('is a bounded null when nothing qualified, and names the inert cell', () => {
    const inert = 'a'.repeat(64);
    const none = decisionOf(null, inert, POLICY_OBJECTIVE);
    assert.equal(none.qualifiesAsDefault, false);
    assert.equal(none.default, inert);
    assert.match(none.statement, /nothing was measured that could change it/);
  });

  it('names the challenger only when every registered clause passed', async () => {
    const report = await fixture();
    const [inertAttempt, shippedAttempt] = report.attempts;
    const screen = comparisonOf(shippedAttempt, inertAttempt, POLICY_OBJECTIVE, 'evidence-recall');
    const decision = decisionOf(screen, inertAttempt.cellId, POLICY_OBJECTIVE);
    assert.equal(decision.qualifiesAsDefault, false);
    assert.equal(decision.default, inertAttempt.cellId, 'the inert cell stands when nothing qualified');
    assert.match(decision.statement, /bounded null/);
    assert.match(decision.statement, /no effect larger than/);
  });
});
