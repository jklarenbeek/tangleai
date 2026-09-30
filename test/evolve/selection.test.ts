import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { projectOutcomeConfidence } from '@tangleai/memory/outcome';
import type { MemoryUnit } from '@tangleai/core';
import { selectExperiment, EVOLVE_SELECTION_ARMS, EVOLVE_SELECTION_DEFAULT, type SelectionArm } from '../../packages/evolve/src/selection.ts';
import { loadSelectionRegistration, runSelectionRound, recallStrategyScores, validateSelectionReport,
  renderSelectionDocument, SELECTION_REPORT_PATH, SELECTION_DOCUMENT_PATH } from '../../benchmark/lib/evolve-selection.ts';
import type { EvolveSelection } from '../../benchmark/lib/evolve-selection.types.ts';

const context = { pool: [{ id: 'second', strategyId: 'b' }, { id: 'first', strategyId: 'a' }], attempted: new Set<string>(), strategyOrder: ['a', 'b'],
  recall: async () => new Map([['a', 1], ['b', 1]]), confidence: async () => 0.5 };

describe('deterministic selection policy', () => {
  it('breaks ranked ties in registered strategy order and preserves the unranked default', async () => {
    for (const arm of EVOLVE_SELECTION_ARMS) {
      const result = await selectExperiment({ ...context, arm });
      assert.ok(result.ok);
      assert.equal(result.value?.id, arm === 'recall' || arm === 'outcome-ranked' ? 'first' : 'second');
    }
    assert.equal(EVOLVE_SELECTION_DEFAULT, 'unranked');
  });
  it('does not read ranking sources that do not belong to an arm', async () => {
    const forbidden = async (): Promise<never> => { throw new Error('forbidden ranking source'); };
    for (const arm of ['unranked', 'scripted-model'] as const) assert.ok((await selectExperiment({ ...context, arm, recall: forbidden, confidence: forbidden })).ok);
    assert.ok((await selectExperiment({ ...context, arm: 'recall', confidence: forbidden })).ok);
    assert.ok((await selectExperiment({ ...context, arm: 'outcome-ranked', recall: forbidden })).ok);
  });
  it('refuses duplicate identities, missing strategies, unknown arms and nonfinite scores', async () => {
    assert.equal((await selectExperiment({ ...context, arm: 'unranked', pool: [...context.pool, context.pool[0]] })).ok, false);
    assert.equal((await selectExperiment({ ...context, arm: 'unranked', strategyOrder: [] })).ok, false);
    assert.equal((await selectExperiment({ ...context, arm: 'unknown' as SelectionArm })).ok, false);
    assert.equal((await selectExperiment({ ...context, arm: 'outcome-ranked', confidence: async () => NaN })).ok, false);
    assert.deepEqual(await selectExperiment({ ...context, arm: 'unranked', attempted: new Set(['first', 'second']) }), { ok: true, value: null });
  });
});

describe('registered selection measurement', () => {
  let loaded: Awaited<ReturnType<typeof loadSelectionRegistration>>;
  let scores: ReadonlyMap<string, number>;
  let real: EvolveSelection;
  before(async () => {
    loaded = await loadSelectionRegistration();
    scores = await recallStrategyScores(loaded.fixture.strategies, loaded.registration.near);
    real = JSON.parse(await readFile(SELECTION_REPORT_PATH, 'utf8'));
  });
  async function scripted(arm: SelectionArm) {
    const carriers = new Map<string, MemoryUnit>(loaded.registration.strategyOrder.map(id => [id, {
      id, kind: 'fact', text: id, tags: [], evidence: 'fixture', at: '2026-09-13T00:00:00.000Z', confidence: 0.5,
    }]));
    let confidenceReads = 0;
    const measured = await runSelectionRound({
      arm, attempts: 6, strategyOrder: loaded.registration.strategyOrder,
      pool: loaded.registration.permutations[0].map(id => ({ id, strategyId: loaded.fixture.proposals.find(p => p.document.id === id)!.document.strategyId })),
      recall: async () => scores,
      confidence: async id => { assert.equal(arm, 'outcome-ranked'); confidenceReads++; return carriers.get(id)!.confidence!; },
      execute: async (one, attempt) => {
        const expected = arm === 'scripted-model'
          ? loaded.registration.modelReplies.find(r => r.round === 1 && r.attempt === attempt)!.expect
          : loaded.fixture.manifest.proposals.find(p => p.id === one.id)!.expect;
        const category = expected.decision === 'kept' ? 'success' : expected.reason === 'equal' ? 'partial' : 'failure';
        carriers.set(one.strategyId, projectOutcomeConfidence(carriers.get(one.strategyId)!, category));
        return { actual: expected as never, expected: expected as never, matches: true,
          processRuns: 0, worktreesCreated: 0, patchBytes: 0, modelCalls: arm === 'scripted-model' ? 1 : 0, modelTokens: arm === 'scripted-model' ? 64 : 0 };
      },
    });
    assert.equal(confidenceReads > 0, arm === 'outcome-ranked');
    return measured;
  }
  it('all four injected paths repeat identically and agree with every measured first-round decision', async () => {
    for (const arm of EVOLVE_SELECTION_ARMS) {
      const a = await scripted(arm), b = await scripted(arm);
      assert.deepEqual(a, b);
      const decisions = (rows: typeof a.rows) => rows.map(row => ({ proposalId: row.proposalId, actual: row.actual }));
      assert.deepEqual(decisions(a.rows), decisions(real.rounds[0].arms.find(a => a.arm === arm)!.rows));
    }
  });
  it('the generated document and its closed report match the committed measurement', async () => {
    await validateSelectionReport(real);
    assert.equal(renderSelectionDocument(real), await readFile(SELECTION_DOCUMENT_PATH, 'utf8'));
    assert.equal(real.experiments, 72);
    assert.equal(real.selectionHead, null);
    assert.equal(real.protectedRefWrites, 0);
    assert.equal(real.operatorWorktreeChanged, false);
    assert.equal(real.liveModelCalls, 0);
    assert.equal(real.modelDecision, 'model-exact');
    assert.equal(real.rounds[0].arms[3].shapeRefusals, 1);
  });
  it('rejects forged counts, verdicts and control pairings even after rehashing', async () => {
    const mutations: Array<(r: EvolveSelection) => void> = [
      r => { r.rounds[0].arms[0].kept++; },
      r => { r.rounds[0].arms[0].processRuns++; },
      r => { r.rounds[0].comparison.rankedFirst++; },
      r => { r.rounds[1].arms.reverse(); },
      r => { r.verdict = r.verdict === 'ranked-wins' ? 'ranked-loses' : 'ranked-wins'; },
      r => { r.rounds[1].round = 1; },
      r => { r.rounds[0].arms[0].attemptsToFirstKeep = 1; },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(real); mutate(changed);
      const { reportId: _, ...content } = changed;
      changed.reportId = await canonicalSha256(content);
      await assert.rejects(validateSelectionReport(changed));
    }
  });
});
