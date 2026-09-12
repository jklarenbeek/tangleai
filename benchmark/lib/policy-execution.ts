/** Purchase accounting and immutable phase boundaries for the policy experiment. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createBudgetAccount } from '@tangleai/agents/recursive';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import type { ReplayCache } from '@tangleai/models/replay';
import { cellIdOf, registrationIdOf, reportIdOf, runIdOf, questionSetOf, inferenceIdentityOf, transitionOf, comparisonOf, chooseChallenger, decisionOf, FREEZE_ALGORITHM, type LocomoPolicy } from './locomo-policy.ts';

export interface PurchaseJournal {
  inference: string;
  source: string;
  ceiling: number;
  requests: Array<{ kind: 'embedding' | 'chat'; status: number | 'pending' | 'failed'; request: string }>;
  cacheWrites: Record<string, string>;
}
/** Recheck snapshots after acquiring the process lock; planning may have raced a completed writer. */
export function verifyPurchaseSnapshot(expected: { journal: PurchaseJournal, reportId: string }, current: { journal: PurchaseJournal, reportId: string }): void {
  assert.deepEqual(current, expected, 'Policy purchase state changed during planning; reload before spending');
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
/** The accounts reserve synchronously before fetch; the journal persists even a failed or interrupted purchase. */
export function createPurchaseGuard(options: {
  journal: PurchaseJournal; limit: number; deadlineMs: number; fetch: typeof globalThis.fetch; save: () => void;
}) {
  const { journal, save } = options;
  assert.ok(Number.isSafeInteger(journal.ceiling) && journal.ceiling > 0);
  assert.ok(Number.isSafeInteger(options.limit) && options.limit > 0);
  const campaign = createBudgetAccount({ turns: journal.ceiling, spent: { turns: journal.requests.length } });
  const run = createBudgetAccount({ turns: options.limit });
  const fetch: typeof globalThis.fetch = async (url, init) => {
    if (campaign.stop() || run.stop()) throw new Error('Policy physical request ceiling reached');
    campaign.reserve(); run.reserve();
    const entry: PurchaseJournal['requests'][number] = {
      kind: String(url).endsWith('/embeddings') ? 'embedding' : 'chat', status: 'pending',
      request: digest(String(init?.body ?? '')),
    };
    journal.requests.push(entry); save();
    const timeout = AbortSignal.timeout(options.deadlineMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    try {
      const response = await options.fetch(url, { ...init, signal });
      entry.status = response.status; save();
      return response;
    } catch (error) { entry.status = 'failed'; save(); throw error; }
  };
  return {
    fetch,
    spent: () => run.spent().turns,
    /** Lost successful cache entries cannot silently buy a new answer after its score was seen. */
    cache(cache: ReplayCache): ReplayCache {
      return {
        async get(key) {
          const value = await cache.get(key), id = digest(key);
          if (journal.cacheWrites[id] !== undefined) {
            if (value === undefined || digest(JSON.stringify(value)) !== journal.cacheWrites[id])
              throw new Error('A recorded policy replay is missing or changed');
          }
          return value;
        },
        async set(key, value) {
          const id = digest(key), hash = digest(JSON.stringify(value));
          assert.ok(journal.cacheWrites[id] === undefined || journal.cacheWrites[id] === hash, 'A successful policy response is immutable');
          await cache.set(key, value); journal.cacheWrites[id] = hash; save();
        },
      };
    },
  };
}

/** Recompute the identities before resuming, selecting a default or rendering a claimed result. */
export async function verifyPolicyReport(report: LocomoPolicy): Promise<void> {
  assert.equal(report.reportId, await reportIdOf(report), 'Policy report identity changed');
  for (const cell of report.registration.cells) assert.equal(cell.cellId, await cellIdOf(cell), 'Policy cell identity changed');
  assert.equal(report.registration.registrationId, await registrationIdOf(report.registration), 'Policy registration identity changed');
  assert.equal(report.source.sha256, await canonicalSha256({ head: report.source.head, files: report.source.files }), 'Policy source identity changed');
  if (report.registration.datasetSha256 !== undefined) assert.equal(report.registration.datasetSha256, report.dataset.sha256, 'Registration dataset changed');
  const inference = report.registration.inference;
  if (inference) {
    const { authorized: _approved, identity, ...controls } = inference;
    assert.equal(identity, await inferenceIdentityOf(controls), 'Policy inference identity changed');
  }
  for (const attempt of report.attempts) {
    if (attempt.run.tier === 'live') {
      assert.ok(inference?.authorized, 'Live run needs approved controls');
      for (const key of ['provider', 'endpoint', 'answerModel', 'judgeModel', 'thinking', 'responseSchema', 'retry', 'deadlineMs', 'concurrency', 'keySource'] as const)
        assert.deepEqual(attempt.run[key], inference[key], `Run differs from approved controls: ${key}`);
      assert.equal(attempt.run.budgetCeiling, inference.perRunCeiling, 'Run differs from approved controls: ceiling');
      assert.equal(attempt.run.embedder.model, inference.embedder.model, 'Run differs from approved controls: embedder');
      if (inference.embedder.dims > 0) assert.equal(attempt.run.embedder.dims, inference.embedder.dims, 'Run differs from approved controls: dimensions');
      if (report.census?.embedder) assert.deepEqual(attempt.run.embedder, report.census.embedder, 'Run differs from observed embedder');
      assert.equal(attempt.run.source, report.source.sha256, 'Live run source changed');
    }
    assert.equal(attempt.runId, await runIdOf(attempt.cellId, attempt.run), 'Policy run identity changed');
    assert.equal(attempt.denominators.questionSet, await questionSetOf(attempt.run.sampleIds), 'Policy question identity changed');
  }
  const frozen = report.selection.frozen;
  if (frozen) assert.equal(frozen.identity, await canonicalSha256({
    registrationId: await registrationIdOf({ ...report.registration, inference: null }),
    algorithm: FREEZE_ALGORITHM, cells: frozen.cells,
  }), 'Policy shortlist identity changed');
  for (const comparison of report.comparisons.filter(c => c.metric === 'locomo-f1')) {
    const treatment = report.attempts.find(a => a.run.tier === 'live' && a.phase === comparison.phase && a.cellId === comparison.treatment);
    const control = report.attempts.find(a => a.run.tier === 'live' && a.phase === comparison.phase && a.cellId === comparison.control);
    assert.ok(treatment && control, 'Live comparison is missing its attempts');
    assert.deepEqual(comparison, comparisonOf(treatment, control, report.registration.objective, comparison.metric), 'Policy decision statistics changed');
  }
  if (report.selection.transition) {
    const next = await transitionOf(report.selection.transition, report.registration, report.selection.frozen!.identity);
    assert.deepEqual(report.selection.transition, next, 'Policy challenger identity changed');
    const nonControls = report.selection.shortlist.filter(id => !['inert', 'shipped'].includes(report.registration.cells.find(c => c.cellId === id)!.role));
    const choice = chooseChallenger(report.comparisons.filter(c => c.phase === 'selection' && c.metric === 'locomo-f1'), nonControls, report.registration.objective);
    assert.equal(choice.challenger, report.selection.transition.challenger, 'Challenger differs from the registered selection rule');
    assert.equal(choice.calculation, report.selection.transition.calculation, 'Challenger calculation changed');
  }
  if (report.selection.decision) {
    const inert = report.registration.cells.find(c => c.role === 'inert')!.cellId;
    const comparison = report.comparisons.find(c => c.phase === 'confirmation' && c.metric === 'locomo-f1' && c.treatment === report.selection.transition?.challenger);
    assert.ok(comparison?.eligible, 'Default requires eligible confirmation');
    assert.deepEqual(report.selection.decision, decisionOf(comparison, inert, report.registration.objective), 'Policy default decision changed');
  }
}
export function validatePhase(report: LocomoPolicy, phase: 'census' | 'selection' | 'confirmation'): void {
  assert.ok(report.selection.frozen, 'The policy shortlist must be frozen');
  assert.ok(!report.selection.decision && report.selection.state !== 'confirmed', 'The completed confirmation is immutable; use --render');
  if (phase === 'census') {
    assert.ok(!report.attempts.some(a => a.run.tier === 'live'), 'The census cannot change after answers were observed');
    assert.equal(report.census, null, 'The completed census is immutable');
    return;
  }
  assert.ok(report.census, 'A live census must precede every answer');
  if (phase === 'selection') assert.equal(report.selection.transition, null, 'Selection is frozen; proceed to confirmation');
  if (phase === 'confirmation') assert.ok(report.selection.transition, 'A frozen challenger must precede confirmation');
}

/** A schema-valid replacement dataset must never enter an already registered experiment. */
export function verifyPolicyDataset(report: LocomoPolicy, dataset: { sha256: string, bytes: number }): void {
  assert.equal(dataset.sha256, report.dataset.sha256, 'Registered dataset digest changed');
  assert.equal(dataset.bytes, report.dataset.bytes, 'Registered dataset size changed');
}
