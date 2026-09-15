/**
 * The experiment adapter, accepted by the real outcome service.
 *
 * Registering it through `createOutcomeService` is the point: the service
 * re-hashes the adapter's four schemas and its scorer description at
 * registration, so an adapter that merely looks right but hashes
 * differently is refused there rather than here.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createOutcomeService, createMemoryOutcomeStore, outcomeRevision, scopeIdOf } from '@tangleai/outcomes';
import { createExperimentOutcomeAdapter } from '@tangleai/evolve/adapters/experiment';

const scope = { namespace: 'tests', domain: 'evolve', subject: 'experiments' };

describe('the experiment outcome adapter', () => {
  it('is accepted by a real outcome service at its declared identity', async () => {
    const adapter = await createExperimentOutcomeAdapter();
    assert.equal(adapter.identity.id, 'evolve-experiment/v1');
    assert.match(adapter.identity.revision, /^[a-f0-9]{64}$/);

    const service = await createOutcomeService({
      store: createMemoryOutcomeStore(),
      scope,
      adapters: [adapter],
      principal: { id: 'operator', authorityId: await outcomeRevision({ fixture: 1 }), approve: true, reconcile: true },
      resolver: { revision: await outcomeRevision({ fixture: 1 }), async resolve() { return undefined; } },
      authorizeMemoryIds: async () => ({ allowed: true, authorizationId: await outcomeRevision({ fixture: 1 }) }),
    });
    assert.equal(service.scopeId, await scopeIdOf(scope));
  });

  it('predicts improvement, because that is why a proposal exists', async () => {
    const adapter = await createExperimentOutcomeAdapter();
    const predicted = adapter.interpret({
      experimentId: 'e1', strategyId: 's1', baseRevision: 'a'.repeat(40),
      metric: 'ndcg', direction: 'higher',
    }, adapter.staticPayload);
    assert.deepEqual(predicted, { predicted: 'improve' });
  });

  it('scores kept as success, equal as partial, and every other reason as failure', async () => {
    const adapter = await createExperimentOutcomeAdapter();
    const score = (decision: string, reason: string, delta: number | null) =>
      adapter.score({ predicted: 'improve' }, { decision, reason, delta, decisionRecordId: 'd1' });

    assert.equal(score('kept', 'improved', -0.2).outcome, 'success');
    assert.equal(score('abandoned', 'equal', 0).outcome, 'partial', 'safe but bought nothing');
    assert.equal(score('abandoned', 'regression', 0.4).outcome, 'failure');
    assert.equal(score('refused', 'goalpost', null).outcome, 'failure',
      'a proposal that edited the test is a strategy failure, not a neutral event');
    assert.equal(score('refused', 'escape', null).outcome, 'failure');
    assert.equal(score('uncertain', 'uncertain-effect', null).outcome, 'failure');

    assert.deepEqual(score('kept', 'improved', -0.2).diagnostics, { reason: 'improved', delta: -0.2 });
  });

  it('refuses a weight outside the unit interval and accepts the empty policy', async () => {
    const adapter = await createExperimentOutcomeAdapter();
    assert.deepEqual(adapter.validatePayload!({ weights: {}, version: 1 }), []);
    assert.deepEqual(adapter.validatePayload!({ weights: { s1: 0.5 }, version: 1 }), []);

    const refused = adapter.validatePayload!({ weights: { s1: 1.5 }, version: 1 });
    assert.equal(refused.length, 1);
    assert.equal(refused[0].code, 'OUTC1010');

    assert.equal(adapter.validatePayload!({ weights: { s1: -0.1 }, version: 1 }).length, 1);
  });
});
