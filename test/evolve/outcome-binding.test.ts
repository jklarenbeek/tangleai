/**
 * What an experiment meant, through the outcome lifecycle and nothing else.
 *
 * The assertion that carries this file is the one about confidence: a kept
 * experiment moves the proposing strategy's carrier UP and a failure moves
 * it DOWN, and it happens inside the outcome service's own transaction via
 * `projectOutcomeConfidence`. Nothing in the evolve package writes that
 * number. A test that merely checked "the four commands returned ok" would
 * pass against a binding that recorded nothing anybody could learn from.
 *
 * The missing-carrier case is the other half. A citation the memory store
 * cannot produce is reported and refused — never created on the way past,
 * because a lifecycle that invents the thing it is supposed to be measuring
 * will always report success.
 *
 * Promotion is proven absent rather than assumed: the automation principal
 * holds no approval, and asking for one is refused with the outcome
 * package's own code.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryOutcomeStore, createOutcomeService, outcomeRevision } from '@tangleai/outcomes';
import {
  recordExperimentOutcome, resolveEvolveEvidence,
  createSourceRegistry, createMemoryEvolveStore, sealRecord, AUTOMATION_PRINCIPAL,
  DEFAULT_EVOLVE_BUDGETS,
} from '@tangleai/evolve';
import { createExperimentOutcomeAdapter } from '@tangleai/evolve/adapters/experiment';
import type { EvolveDecision, EvolveMeasurement } from '@tangleai/evolve/contracts';
import type { OutcomeStore } from '@tangleai/outcomes';

const EPOCH = '2026-09-13T00:00:00.000Z';
const BASE = '1f174c14c3ed9b8895422b19dfc9bc8b1713a912';
const MEMORY_ID = 'evolve-strategy:S-partial-select';

const EXPERIMENT = {
  experimentId: 'improve-partial-select',
  strategyId: 'S-partial-select',
  baseRevision: BASE,
};

async function decisionRecord(
  decision: EvolveDecision['decision'], reason: EvolveDecision['reason'], code: EvolveDecision['code'],
): Promise<EvolveDecision> {
  const sealed = await sealRecord<EvolveDecision>({
    schemaVersion: 1,
    kind: 'decision',
    experimentId: EXPERIMENT.experimentId,
    decision, reason, code,
    evidenceIds: ['m1'],
    budgets: DEFAULT_EVOLVE_BUDGETS,
  });
  assert.equal(sealed.ok, true, JSON.stringify(sealed));
  return (sealed as { value: EvolveDecision }).value;
}

const measurementOf = (delta: number): EvolveMeasurement => ({
  schemaVersion: 1, kind: 'measurement', id: 'm'.repeat(64),
  experimentId: EXPERIMENT.experimentId, metric: 'comparisons', direction: 'lower',
  base: { samples: [3975], median: 3975 }, candidate: { samples: [3103], median: 3103 },
  truth: 3975, delta, effectRecordIds: [],
});

/** The whole stack, keyless: evolve store, outcome store, service, registry. */
async function harness(options: { carrier?: boolean, store?: OutcomeStore } = {}) {
  const outcomeStore = options.store ?? createMemoryOutcomeStore();
  const evolveStore = createMemoryEvolveStore();
  const registry = createSourceRegistry();
  const adapter = await createExperimentOutcomeAdapter();
  const revision = await outcomeRevision({ test: 'evolve-outcome-binding/v1' });

  if (options.carrier !== false) {
    await outcomeStore.memories.put({
      id: MEMORY_ID, kind: 'fact', text: 'Strategy S-partial-select', tags: ['evolve-strategy'],
      evidence: 'registered by the evolve fixture', at: EPOCH, confidence: 0.5,
    });
  }

  const service = await createOutcomeService({
    store: outcomeStore,
    scope: { namespace: 'evolve', domain: adapter.identity.id, subject: EXPERIMENT.experimentId },
    adapters: [adapter],
    principal: {
      id: AUTOMATION_PRINCIPAL.id,
      authorityId: revision,
      // The campaign's principal: it may run experiments and may not approve.
      approve: false,
      reconcile: false,
    },
    resolver: { revision, resolve: resolveEvolveEvidence(evolveStore, registry) },
    authorizeMemoryIds: async () => ({ allowed: true, authorizationId: revision }),
    evaluationSlot: async () => undefined,
  });

  return { service, registry, evolveStore, outcomeStore, adapter, revision };
}

const confidenceOf = async (store: OutcomeStore): Promise<number> => {
  const held = await store.memories.get(MEMORY_ID) as { confidence: number } | undefined;
  assert.ok(held, 'the carrier is there');
  return held.confidence;
};

const bind = (harnessed: Awaited<ReturnType<typeof harness>>, decision: EvolveDecision, measurement: EvolveMeasurement | null) =>
  recordExperimentOutcome({
    service: harnessed.service as never,
    registry: harnessed.registry,
    experiment: EXPERIMENT,
    decision,
    measurement,
    strategy: { memoryId: MEMORY_ID },
    configuration: { kind: 'scripted', revision: harnessed.revision },
    metric: { name: 'comparisons', direction: 'lower' },
    adapter: harnessed.adapter.identity as never,
    epoch: EPOCH,
  });

describe('recording what an experiment meant', () => {
  it('moves the strategy carrier’s confidence up for a keep', async () => {
    const harnessed = await harness();
    const decision = await decisionRecord('kept', 'improved', null);
    await harnessed.evolveStore.putRecord(decision);

    const before = await confidenceOf(harnessed.outcomeStore);
    const recorded = await bind(harnessed, decision, measurementOf(872));
    assert.equal(recorded.ok, true, JSON.stringify(recorded));

    const value = (recorded as { value: { decisionId: string, resolutionId: string, scoreId: string, projectionReceiptId: string, missing: number } }).value;
    for (const id of [value.decisionId, value.resolutionId, value.scoreId, value.projectionReceiptId]) {
      assert.ok(typeof id === 'string' && id.length > 0);
    }
    assert.equal(value.missing, 0);
    assert.ok(await confidenceOf(harnessed.outcomeStore) > before,
      'a kept experiment is evidence the strategy works');
  });

  it('moves it down for a failure', async () => {
    const harnessed = await harness();
    const decision = await decisionRecord('abandoned', 'regression', 'TEVO1008');
    await harnessed.evolveStore.putRecord(decision);

    const before = await confidenceOf(harnessed.outcomeStore);
    assert.equal((await bind(harnessed, decision, measurementOf(-500))).ok, true);
    assert.ok(await confidenceOf(harnessed.outcomeStore) < before,
      'a regression is evidence too, in the other direction');
  });

  it('gives a no-op partial credit rather than a failure', async () => {
    const harnessed = await harness();
    const decision = await decisionRecord('abandoned', 'equal', 'TEVO1008');
    await harnessed.evolveStore.putRecord(decision);

    const failing = await harness();
    const failure = await decisionRecord('abandoned', 'regression', 'TEVO1008');
    await failing.evolveStore.putRecord(failure);

    assert.equal((await bind(harnessed, decision, measurementOf(0))).ok, true);
    assert.equal((await bind(failing, failure, measurementOf(-500))).ok, true);

    assert.ok(await confidenceOf(harnessed.outcomeStore) > await confidenceOf(failing.outcomeStore),
      'a change that was safe but bought nothing beats one that made things worse');
  });

  it('records a refusal with no delta at all, rather than a zero', async () => {
    const harnessed = await harness();
    const decision = await decisionRecord('refused', 'goalpost', 'TEVO1004');
    await harnessed.evolveStore.putRecord(decision);

    const recorded = await bind(harnessed, decision, null);
    assert.equal(recorded.ok, true, JSON.stringify(recorded));
    const source = harnessed.registry.get(decision.id) as { payload: { delta: number | null } };
    assert.equal(source.payload.delta, null,
      'a run that never measured has no delta; a zero would read as “no change”');
  });
});

describe('evidence that cannot be produced', () => {
  it('refuses a citation the evolve store does not hold', async () => {
    const harnessed = await harness();
    // Deliberately NOT written to the evolve store: the resolver must not
    // answer for a record nobody holds.
    const decision = await decisionRecord('kept', 'improved', null);

    const recorded = await bind(harnessed, decision, measurementOf(872));
    assert.equal(recorded.ok, false, 'an unresolvable citation is a refusal, not empty evidence');
    const issue = (recorded as { issues: Array<{ code: string, path: string }> }).issues[0];
    assert.equal(issue.code, 'TEVO1011');
    assert.equal(issue.path, '/resolve');
  });

  it('refuses a missing carrier and creates nothing', async () => {
    const harnessed = await harness({ carrier: false });
    const decision = await decisionRecord('kept', 'improved', null);
    await harnessed.evolveStore.putRecord(decision);

    const recorded = await bind(harnessed, decision, measurementOf(872));
    assert.equal(recorded.ok, false);
    const issue = (recorded as { issues: Array<{ code: string, path: string }> }).issues[0];
    assert.equal(issue.code, 'TEVO1011');
    assert.equal(issue.path, '/project/memoryIds');
    assert.equal(await harnessed.outcomeStore.memories.get(MEMORY_ID), undefined,
      'a lifecycle that invents what it measures always reports success');
  });
});

describe('replaying the same experiment', () => {
  it('returns the reservation’s result and writes nothing the second time', async () => {
    const harnessed = await harness();
    const decision = await decisionRecord('kept', 'improved', null);
    await harnessed.evolveStore.putRecord(decision);

    const first = await bind(harnessed, decision, measurementOf(872));
    assert.equal(first.ok, true, JSON.stringify(first));
    const firstValue = (first as { value: { writes: number, decisionId: string, scoreId: string } }).value;
    assert.ok(firstValue.writes > 0, 'the first run records something');
    const confidence = await confidenceOf(harnessed.outcomeStore);

    const second = await bind(harnessed, decision, measurementOf(872));
    assert.equal(second.ok, true, JSON.stringify(second));
    const secondValue = (second as { value: { writes: number, decisionId: string, scoreId: string } }).value;
    assert.equal(secondValue.writes, 0, 'a replay under the same keys writes nothing');
    assert.equal(secondValue.decisionId, firstValue.decisionId, 'and answers the same records');
    assert.equal(secondValue.scoreId, firstValue.scoreId);
    assert.equal(await confidenceOf(harnessed.outcomeStore), confidence,
      'so a resumed run cannot move confidence twice');
  });
});

describe('the promotion rail this campaign does not take', () => {
  it('refuses the automation principal an approval', async () => {
    const harnessed = await harness();
    const service = harnessed.service as unknown as {
      approve?: (raw: unknown) => Promise<{ ok: boolean, issues?: Array<{ code: string }> }>,
      scopeId: string,
    };
    assert.equal(typeof service.approve, 'function', 'the command exists; the capability does not');

    // A WELL-FORMED approval, deliberately: the shape is checked before the
    // capability is, so a malformed one would prove nothing about who may
    // approve. This one is refused for the only reason that matters.
    const refused = await service.approve!({
      scopeId: service.scopeId, artifactKey: 'strategy-selection', requestKey: 'never', at: EPOCH,
      input: {
        action: 'promote',
        versionId: 'a'.repeat(64),
        evaluationId: 'b'.repeat(64),
        expectedHead: { versionId: null, revision: 0 },
        reason: 'an automation asking to land its own work',
      },
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.issues?.[0]?.code, 'OUTC1012',
      'approval is a person’s, and the principal says so before anything is read');
  });

  it('keeps the selection artifact empty: nothing is promoted by running experiments', async () => {
    const harnessed = await harness();
    const decision = await decisionRecord('kept', 'improved', null);
    await harnessed.evolveStore.putRecord(decision);
    assert.equal((await bind(harnessed, decision, measurementOf(872))).ok, true);

    assert.deepEqual(harnessed.adapter.staticPayload, { weights: {}, version: 1 },
      'a kept experiment is a branch for a person, not a weight change');
  });
});
