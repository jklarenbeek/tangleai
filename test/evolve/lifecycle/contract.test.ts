/**
 * The published read surface.
 *
 * The claim worth testing is not that the three operations work — it is
 * that there is no fourth one that lands a change, and that the review
 * bundle never carries the diff text or what the gate printed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  evolveContractDocument, createEvolveContract, createEvolveHandlers,
  createEvolveReader, EVOLVE_OPERATIONS, EVOLVE_LIST_LIMIT,
} from '@tangleai/evolve/contract';
import { createMemoryEvolveStore } from '@tangleai/evolve';

const document = evolveContractDocument as unknown as {
  id: string,
  operations: Record<string, { kind: string }>,
  $defs: Record<string, unknown>,
};

const anyContext = {} as never;

function handlersOver(reader: Parameters<typeof createEvolveHandlers>[0] extends never ? never : unknown, allow = true) {
  return createEvolveHandlers({
    resolveHost: () => ({ reader: reader as never, allowRead: () => allow }),
  });
}

describe('the evolve read contract', () => {
  it('publishes reads only — nothing that lands a change', () => {
    const kinds = Object.entries(document.operations).map(([id, one]) => `${id}:${one.kind}`);
    assert.deepEqual(kinds.filter(one => !one.endsWith(':read')), [],
      'the authority to land a change is absent from the surface, not guarded inside it');
    assert.deepEqual(Object.keys(document.operations).sort(), [...EVOLVE_OPERATIONS].sort());
  });

  it('names no operation that merges, promotes, approves or runs', () => {
    const forbidden = ['merge', 'promote', 'approve', 'run', 'cancel', 'stop', 'apply', 'create'];
    for (const id of Object.keys(document.operations)) {
      for (const verb of forbidden) {
        assert.ok(!id.includes(verb), `${id} names the forbidden verb ${verb}`);
      }
    }
  });

  it('compiles', () => {
    const contract = createEvolveContract();
    assert.ok(contract, 'the document is a compilable contract');
  });

  it('carries no subscribe operation — there is no second event channel', () => {
    const subscribes = Object.entries(document.operations).filter(([, one]) => one.kind === 'subscribe');
    assert.deepEqual(subscribes, []);
  });
});

describe('the read handlers', () => {
  const reader = {
    listExperiments: async (query: { limit?: number }) =>
      ({ experiments: [{ id: 'exp-1' }], truncated: false, seenLimit: query.limit }) as never,
    getExperiment: async (id: string) =>
      (id === 'exp-1' ? { experiment: { id }, recordIds: ['r1'] } : undefined),
    getReviewBundle: async (id: string) =>
      (id === 'exp-1' ? { diffDigest: 'abc', diffBytes: 42 } : undefined),
  };

  it('refuses when the host declines, before reading anything', async () => {
    let touched = false;
    const handlers = createEvolveHandlers({
      resolveHost: () => ({
        reader: { ...reader, listExperiments: async () => { touched = true; return { experiments: [], truncated: false }; } },
        allowRead: () => false,
      }),
    });
    const answer = await handlers['evolve.experiments.list']({}, anyContext) as { ok?: boolean };
    assert.equal(answer.ok, false);
    assert.equal(touched, false, 'it refused before reaching the store');
  });

  it('bounds a list even when the caller asks for more', async () => {
    const handlers = handlersOver(reader);
    const answer = await handlers['evolve.experiments.list']({ limit: 100000 }, anyContext) as { seenLimit: number };
    assert.equal(answer.seenLimit, EVOLVE_LIST_LIMIT,
      'a read that can ask for everything is a denial-of-service surface with a friendly name');
  });

  it('refuses an experiment it does not hold rather than answering empty', async () => {
    const handlers = handlersOver(reader);
    const answer = await handlers['evolve.experiment.get']({ experimentId: 'nope' }, anyContext) as { ok?: boolean };
    assert.equal(answer.ok, false);
  });

  it('answers the review bundle without the diff text or the gate output', async () => {
    const handlers = handlersOver(reader);
    const answer = await handlers['evolve.review.get']({ experimentId: 'exp-1' }, anyContext) as {
      bundle: Record<string, unknown>,
    };
    assert.deepEqual(Object.keys(answer.bundle).sort(), ['diffBytes', 'diffDigest']);
    for (const banned of ['diff', 'stdout', 'stderr', 'patch']) {
      assert.ok(!(banned in answer.bundle),
        `the bundle must not carry ${banned}; a reviewer reads it from the branch, where it is attributable`);
    }
  });

  it('says so when an experiment left no bundle, instead of an empty one', async () => {
    const handlers = handlersOver(reader);
    // A refused or abandoned experiment leaves nothing to review, and an
    // empty bundle would read like a keep with no changes.
    const answer = await handlers['evolve.review.get']({ experimentId: 'exp-2' }, anyContext) as { ok?: boolean };
    assert.equal(answer.ok, false);
  });
});

describe('the reader over the package store', () => {
  it('reads an absent experiment as absent rather than throwing', async () => {
    const reader = createEvolveReader(createMemoryEvolveStore());
    assert.equal(await reader.getExperiment('missing'), undefined);
    assert.equal(await reader.getReviewBundle('missing'), undefined);
    assert.deepEqual(await reader.listExperiments({}), { experiments: [], truncated: false });
  });
});
