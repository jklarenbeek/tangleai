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

import { createEvolveEffectWorker, createEffectAddressing, type EvolveEffectJob } from '@tangleai/evolve/host';
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
      // The payload the fenced store writes when it enqueues the
      // operation's job: one field. Everything else the worker needs is
      // read back from the record and the run, which is the point — a
      // crash that lost the dispatching process loses nothing.
      return { lease: { jobId: job.plan.jobId }, payload: { operationId: job.plan.id } };
    },
  };
};

/** Queue, record and address for one job, as the worker will find them. */
const rigFor = (job: EvolveEffectJob) => ({
  jobs: oneJob(job),
  effects: { get: async (id: string) => (id === job.plan.id ? { plan: job.plan } : null) },
  addressing: {
    address: async () => ({
      runId: job.runId,
      interactionPath: job.interactionPath,
      ...(job.seal === undefined ? {} : { seal: job.seal }),
    }),
  },
});

const hostStub = {} as never;

describe('the effect worker', () => {
  it('answers the wait under the effect record id, so a replay is the same response', async () => {
    const interactions = interactionRig(7);
    const worker = createEvolveEffectWorker({
      ...rigFor(jobFor('exp-1/gate')),
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
      ...rigFor(jobFor('exp-2/gate')),
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
      ...rigFor(jobFor('exp-3/gate')),
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
      ...rigFor(jobFor('exp-4/gate')),
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
      ...rigFor(jobFor('exp-5/measure-base', { repositoryRoot: '/repo', baseRevision: 'base-rev' })),
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
      ...rigFor(jobFor('exp-6/measure-base', { repositoryRoot: '/repo', baseRevision: 'base-rev' })),
      driver: { run: async () => ok({ planId: 'exp-6/measure-base', prepared: 1, state: 'complete', legs: [{ id: 'base-sample-0', state: 'confirmed' }] }) },
      interactions, host: steadyHost, owner: 'test', interactionIdOf,
    });

    await worker.drain(4);
    const evidence = (interactions.responses[0].value as { evidence: { sealHeld: boolean } }).evidence;
    assert.equal(evidence.sealHeld, true);
  });
});

describe('addressing an operation to the wait it answers', () => {
  const seal = { repositoryRoot: '/repo', baseRevision: 'base-rev' };
  const addressing = (waiting: string[]) => createEffectAddressing({
    waitingPaths: async () => waiting,
    runIdFor: async (experimentId) => (experimentId === 'exp-1' ? 'run-1' : undefined),
    baseSealFor: async () => seal,
  });

  it('answers the path the run is parked on, not one built from the stage name', async () => {
    // The rerun's wait lives inside the flake switch's branch, so its
    // recorded path carries that region's prefix. An interaction id
    // assembled from the bare node id would address nothing at all, and
    // the run would park forever with an answer nobody delivered.
    const found = await addressing(['flake/rerun/await-gate-rerun']).address('exp-1/gate-rerun');
    assert.equal(found?.interactionPath, 'flake/rerun/await-gate-rerun');
    assert.equal(found?.runId, 'run-1');
    assert.equal(found?.seal, undefined, 'only the base batch is bracketed');
  });

  it('brackets the base batch and nothing else', async () => {
    const base = await addressing(['await-measure-base']).address('exp-1/measure-base');
    assert.deepEqual(base?.seal, seal,
      'the base batch runs in the operator own root, so it is sealed on both sides');
    const candidate = await addressing(['await-measure-candidate']).address('exp-1/measure-candidate');
    assert.equal(candidate?.seal, undefined,
      'a worktree is supposed to change; sealing one would refuse the experiment');
  });

  it('refuses to guess when the run is parked on more than one wait, or none', async () => {
    assert.equal(await addressing([]).address('exp-1/gate'), undefined,
      'nothing is waiting, so there is nothing to answer');
    assert.equal(await addressing(['await-gate', 'await-apply']).address('exp-1/gate'), undefined,
      'two waits cannot say which one this operation answers, and picking is a guess');
    assert.equal(await addressing(['await-gate']).address('exp-9/gate'), undefined,
      'no run is executing that experiment');
    assert.equal(await addressing(['await-gate']).address('malformed'), undefined,
      'an operation id that names no stage addresses nothing');
  });
});
