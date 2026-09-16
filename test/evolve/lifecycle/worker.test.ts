/**
 * The effect worker, and the two windows that decide whether a crash
 * costs anything.
 *
 * Everything is injected: no process runs here. What is under test is not
 * whether git works, it is what the worker does with a result — which key
 * it answers under, and which case it refuses to answer at all.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createEvolveEffectWorker, type EvolveEffectJob } from '@tangleai/evolve/host';
import { ok, refuseOne } from '@tangleai/evolve';
import type { EffectPlan } from '@tangleai/evolve/host';

const interactionIdOf = (runId: string, path: string) => `${runId}:i:${path}`;

function planFor(id: string): EffectPlan {
  return {
    id, jobId: id, kind: 'evolve-effect', actor: 'evolve-automation',
    reason: 'gate', hashVersion: '1',
    legs: [{ id: 'gate', request: { safety: 'single-send' }, maxAttempts: 1 }],
  };
}

function jobFor(id: string, seal?: EvolveEffectJob['seal']): EvolveEffectJob {
  return { plan: planFor(id), runId: 'run-1', interactionPath: 'await-gate', seal };
}

/** A store that records what it was told, and how many times. */
function interactionRig(revision = 3) {
  const responses: Array<{ id: string, key: string, revision: number, value: unknown }> = [];
  return {
    responses,
    getInteraction: async () => ({ revision, status: 'waiting' }),
    respondInteraction: async (id: string, value: unknown, expected: number, key: string) => {
      responses.push({ id, key, revision: expected, value });
      return { ok: true };
    },
  };
}

const oneJob = (job: EvolveEffectJob) => {
  let handed = false;
  return {
    claim: async () => {
      if (handed) return null;
      handed = true;
      return { lease: { jobId: job.plan.jobId }, payload: job };
    },
  };
};

const hostStub = {} as never;

describe('the effect worker', () => {
  it('answers the wait under the effect record id, so a replay is the same response', async () => {
    const interactions = interactionRig(7);
    const worker = createEvolveEffectWorker({
      jobs: oneJob(jobFor('exp-1/gate')),
      driver: { run: async () => ok({ planId: 'exp-1/gate', prepared: 1, state: 'complete', legs: [{ id: 'gate', state: 'confirmed' }] }) },
      interactions, host: hostStub, owner: 'test', interactionIdOf,
    });

    const pass = await worker.drain(4);
    assert.deepEqual(pass.settled, ['exp-1/gate']);
    assert.deepEqual(pass.unresolved, []);
    assert.equal(interactions.responses.length, 1);

    const answered = interactions.responses[0];
    assert.equal(answered.id, 'run-1:i:await-gate');
    assert.equal(answered.key, 'exp-1/gate',
      'the response key is the effect record id, not a fresh token');
    assert.equal(answered.revision, 7, 'it answers the revision it read');
    assert.equal((answered.value as { state: string }).state, 'confirmed');
  });

  it('leaves an unresolved leg unanswered, because nobody can account for it', async () => {
    const interactions = interactionRig();
    const worker = createEvolveEffectWorker({
      jobs: oneJob(jobFor('exp-2/gate')),
      driver: { run: async () => refuseOne('TEVO1009', '/effects', 'the leg did not resolve') },
      interactions, host: hostStub, owner: 'test', interactionIdOf,
    });

    const pass = await worker.drain(4);
    assert.deepEqual(pass.settled, []);
    assert.deepEqual(pass.unresolved, ['exp-2/gate'],
      'it is reported, not summarised into a settlement');
    assert.equal(interactions.responses.length, 0,
      'the wait still stands — a person reconciles it, nothing retries it');
  });

  it('counts a replay rather than hiding it', async () => {
    const interactions = interactionRig();
    const worker = createEvolveEffectWorker({
      jobs: oneJob(jobFor('exp-3/gate')),
      // `prepared: 0` is the store saying it already held this plan: the
      // legs replayed and nothing spawned.
      driver: { run: async () => ok({ planId: 'exp-3/gate', prepared: 0, state: 'complete', legs: [{ id: 'gate', state: 'confirmed' }] }) },
      interactions, host: hostStub, owner: 'test', interactionIdOf,
    });

    const pass = await worker.drain(4);
    assert.equal(pass.replayed, 1, 'a replayed run is counted');
    assert.equal(interactions.responses.length, 1, 'and still answers the wait');
    const evidence = (interactions.responses[0].value as { evidence: { replayed: boolean } }).evidence;
    assert.equal(evidence.replayed, true);
  });

  it('reports a rejected leg as rejected rather than as a failure to settle', async () => {
    const interactions = interactionRig();
    const worker = createEvolveEffectWorker({
      jobs: oneJob(jobFor('exp-4/gate')),
      driver: { run: async () => ok({ planId: 'exp-4/gate', prepared: 1, state: 'complete', legs: [{ id: 'gate', state: 'rejected' }] }) },
      interactions, host: hostStub, owner: 'test', interactionIdOf,
    });

    await worker.drain(4);
    assert.equal((interactions.responses[0].value as { state: string }).state, 'rejected',
      'a leg that ran and was refused is a settlement, not an unknown');
  });

  it('brackets the base batch with the seal and reports whether it held', async () => {
    const seals = ['aaa', 'bbb'];
    const movingHost = {
      inspect: async () => ok({ revision: 'base-rev', clean: true }),
      trackedDigest: async () => ok(seals.shift() ?? 'bbb'),
    } as never;

    const interactions = interactionRig();
    const worker = createEvolveEffectWorker({
      jobs: oneJob(jobFor('exp-5/measure-base', { repositoryRoot: '/repo', baseRevision: 'base-rev' })),
      driver: { run: async () => ok({ planId: 'exp-5/measure-base', prepared: 1, state: 'complete', legs: [{ id: 'base-sample-0', state: 'confirmed' }] }) },
      interactions, host: movingHost, owner: 'test', interactionIdOf,
    });

    await worker.drain(4);
    const evidence = (interactions.responses[0].value as { evidence: { sealHeld: boolean } }).evidence;
    assert.equal(evidence.sealHeld, false,
      'the base moved while the instrument ran, so every number in the run is void');
  });

  it('reports the seal holding when the base did not move', async () => {
    const steadyHost = {
      inspect: async () => ok({ revision: 'base-rev', clean: true }),
      trackedDigest: async () => ok('same-bytes'),
    } as never;

    const interactions = interactionRig();
    const worker = createEvolveEffectWorker({
      jobs: oneJob(jobFor('exp-6/measure-base', { repositoryRoot: '/repo', baseRevision: 'base-rev' })),
      driver: { run: async () => ok({ planId: 'exp-6/measure-base', prepared: 1, state: 'complete', legs: [{ id: 'base-sample-0', state: 'confirmed' }] }) },
      interactions, host: steadyHost, owner: 'test', interactionIdOf,
    });

    await worker.drain(4);
    const evidence = (interactions.responses[0].value as { evidence: { sealHeld: boolean } }).evidence;
    assert.equal(evidence.sealHeld, true);
  });
});
