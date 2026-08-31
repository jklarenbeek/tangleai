/**
 * Content-addressed identities and the run log's identity discipline:
 * an identity that does not hash to its claimed id is refused, storage
 * is idempotent, a run carries its reference from the start or attaches
 * it at finalization, old rows read as legacy-unrecorded and are never
 * backfilled, and a config-aware run cannot finish without saying what
 * stack produced it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { nodeDriver } from '@jarenjs/db/node';
import { identityIdOf, type RunIdentity } from '@tangleai/config';
import { createIdentityRepository, createRunLog, openTangleDb } from '@tangleai/store';

async function sampleIdentity(): Promise<RunIdentity> {
  const body: Omit<RunIdentity, 'identityId'> = {
    registryRevision: null,
    hostManifestRevision: 'b'.repeat(64),
    requested: {
      kind: 'legacy',
      chat: { state: 'unconfigured' },
      embed: { state: 'unconfigured' },
      components: { policy: null, ranker: null },
      chatPrompt: null,
    },
    roles: {},
    embedding: { provider: 'builtin', base: null, model: 'hash-trigram-64', dims: 64, credentialSlot: null },
    components: { policy: null, ranker: null },
    budget: { maxCalls: null, maxTokens: null, maxMs: null, maxConcurrency: null },
  };
  return { identityId: await identityIdOf(body), ...body };
}

describe('the identity repository', () => {
  it('stores a valid identity idempotently and reads it back', async () => {
    const db = await openTangleDb({ driver: nodeDriver() });
    const identities = createIdentityRepository(db);
    const identity = await sampleIdentity();
    const first = await identities.put(identity);
    const second = await identities.put(identity);
    assert.equal(first.ok && second.ok, true);
    assert.deepEqual(await identities.get(identity.identityId), identity);
    assert.equal((await identities.list()).length, 1, 'the second put changed nothing');
  });

  it('refuses a mutated identity under a stale address and an invalid document', async () => {
    const db = await openTangleDb({ driver: nodeDriver() });
    const identities = createIdentityRepository(db);
    const identity = await sampleIdentity();
    const mutated = { ...identity, embedding: { ...(identity.embedding as NonNullable<RunIdentity['embedding']>), dims: 128 } };
    const outcome = await identities.put(mutated);
    assert.equal(outcome.ok, false, 'the content address no longer matches');
    const secretish = { ...identity, apiKey: 'sk-x' } as unknown as RunIdentity;
    const refused = await identities.put(secretish);
    assert.equal(refused.ok, false, 'an undeclared member refuses validation');
    assert.equal((await identities.list()).length, 0);
  });
});

describe('the run log identity discipline', () => {
  it('carries the reference from start, attaches at finalization, and reads honestly', async () => {
    const db = await openTangleDb({ driver: nodeDriver() });
    let tick = 0;
    const log = createRunLog(db, { now: () => `2026-01-01T00:00:${String(tick++).padStart(2, '0')}.000Z`, configAwareKinds: ['sync'] });
    const identity = await sampleIdentity();

    const upfront = await log.startRun('sync', { identityId: identity.identityId });
    assert.equal((await log.finishRun(upfront.id, 'ok')).ok, true);
    assert.equal((await log.getRun(upfront.id))?.run.identityStatus, 'run');

    const attached = await log.startRun('sync');
    await log.attachIdentity(attached.id, identity.identityId);
    assert.equal((await log.finishRun(attached.id, 'ok')).ok, true);
    assert.equal((await log.getRun(attached.id))?.run.identityId, identity.identityId);

    const legacy = await log.startRun('imported-before-identities');
    await log.finishRun(legacy.id, 'ok');
    assert.equal((await log.getRun(legacy.id))?.run.identityStatus, 'legacy-unrecorded', 'an absence is stated, never backfilled');

    const views = await log.listRuns();
    assert.deepEqual(views.map((run) => run.identityStatus).sort(), ['legacy-unrecorded', 'run', 'run']);
  });

  it('refuses to complete a config-aware run without an identity', async () => {
    const db = await openTangleDb({ driver: nodeDriver() });
    const log = createRunLog(db, { configAwareKinds: ['sync'] });
    const bare = await log.startRun('sync');
    const refused = await log.finishRun(bare.id, 'ok', { files: 0 });
    assert.equal(refused.ok, false);
    const view = (await log.getRun(bare.id))?.run;
    assert.equal(view?.status, 'error', 'the run closes as an error naming the absence, never silently ok');
    assert.match(JSON.stringify(view?.summary), /config identity/);
    const errored = await log.startRun('sync');
    assert.equal((await log.finishRun(errored.id, 'error', { boom: true })).ok, true, 'an error finish stays honest without an identity');
  });
});
