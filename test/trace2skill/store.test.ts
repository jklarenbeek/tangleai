/**
 * The store contract on its in-memory implementation: one lifecycle, immutable
 * puts, a revision-fenced activation that applies exactly once under twenty
 * concurrent attempts, and a forced failure at every write stage that leaves
 * nothing behind.
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryTrace2SkillStore } from '@tangleai/trace2skill';
import { SCOPE, lifecycleRecords, runActivationRollback, runPartialWriteRefusal, runSkillLifecycle } from './fixture.ts';

const records = await lifecycleRecords();

it('the in-memory store passes the skill lifecycle', async () => {
  await runSkillLifecycle(createMemoryTrace2SkillStore(), records);
});

it('twenty concurrent activations apply exactly once', async () => {
  const store = createMemoryTrace2SkillStore();
  assert.ok((await store.putSnapshot(records.frozen)).valid);
  assert.ok((await store.markBundle(records.frozen.bundle.id, 'eligible')).valid);
  const outcomes = await Promise.all(Array.from({ length: 20 }, () =>
    store.activate(SCOPE, { versionId: null, revision: 0 }, records.frozen.bundle.id)));
  assert.equal(outcomes.filter(outcome => outcome.valid).length, 1, 'exactly one activation applies');
  assert.equal(outcomes.filter(outcome => !outcome.valid).length, 19);
  assert.deepEqual(await store.head(SCOPE), { versionId: records.frozen.bundle.id, revision: 1 });
  assert.equal(store.stats().activations, 1);
});

it('a forced failure at any write stage leaves nothing behind', async () => {
  const steps = ['put:files', 'put:bundles', 'commit'];
  for (const failAt of steps) {
    let armed = true;
    const store = createMemoryTrace2SkillStore({ applyProbe: step => {
      if (armed && step === failAt) { armed = false; throw new Error(`forced ${step}`); }
    } });
    await assert.rejects(() => store.putSnapshot(records.frozen), /forced/);
    assert.equal((await store.listBy(records.frozen.bundle.id, 'files')).length, 0, failAt);
    assert.ok(!(await store.getBundle(records.frozen.bundle.id)).valid, failAt);
  }
});

it('a conflicting page refuses the directory without committing an earlier one', async () => {
  await runPartialWriteRefusal(createMemoryTrace2SkillStore(), records);
});

it('a failure at any stage of the swap leaves the prior directory active', async () => {
  await runActivationRollback(applyProbe => createMemoryTrace2SkillStore({ applyProbe }), records);
});

it('an unknown directory, a foreign scope and a stale parent each refuse activation', async () => {
  const store = createMemoryTrace2SkillStore();
  const unknown = await store.activate(SCOPE, { versionId: null, revision: 0 }, 'f'.repeat(64));
  assert.ok(!unknown.valid);
  assert.equal(unknown.issues[0].code, 'TT2S1010');
  assert.ok((await store.putSnapshot(records.frozen)).valid);
  assert.ok((await store.markBundle(records.frozen.bundle.id, 'eligible')).valid);
  const foreign = await store.activate('another-scope', { versionId: null, revision: 0 }, records.frozen.bundle.id);
  assert.ok(!foreign.valid);
  assert.equal(foreign.issues[0].code, 'TT2S1010');
  assert.ok((await store.putSnapshot(records.evolved)).valid);
  assert.ok((await store.markBundle(records.evolved.bundle.id, 'eligible')).valid);
  const orphan = await store.activate(SCOPE, { versionId: null, revision: 0 }, records.evolved.bundle.id);
  assert.ok(!orphan.valid, 'a child cannot activate over an empty head');
  assert.equal(orphan.issues[0].code, 'TT2S1010');
  assert.equal(store.stats().activations, 0);
});

it('a rejected directory never moves again and activation is not a status write', async () => {
  const store = createMemoryTrace2SkillStore();
  assert.ok((await store.putSnapshot(records.frozen)).valid);
  const direct = await store.markBundle(records.frozen.bundle.id, 'active');
  assert.ok(!direct.valid);
  assert.equal(direct.issues[0].code, 'TT2S1010');
  assert.ok((await store.markBundle(records.frozen.bundle.id, 'rejected')).valid);
  const again = await store.markBundle(records.frozen.bundle.id, 'eligible');
  assert.ok(!again.valid);
  assert.equal(again.issues[0].code, 'TT2S1001');
});

it('a run record settles where its drive stopped, and a settled one is not written twice', async () => {
  const store = createMemoryTrace2SkillStore();
  const unknown = await store.markRun('f'.repeat(64), 'completed');
  assert.ok(!unknown.valid, 'a run nobody stored was settled');
  assert.equal(unknown.issues[0].code, 'TT2S1001');

  assert.ok((await store.putRun(records.run)).valid);
  const settled = await store.markRun(records.run.id, 'completed');
  assert.ok(settled.valid);
  assert.equal(settled.value.status, 'completed');
  // Re-asserting the stage a run already settled in is the replay every other
  // repeated write is, not a second write and not a refusal.
  const writes = store.stats().writes;
  const again = await store.markRun(records.run.id, 'completed');
  assert.ok(again.valid);
  assert.equal(store.stats().writes, writes);
  // A finished run is finished: only the stage moves, and only forwards.
  const reopened = await store.markRun(records.run.id, 'running');
  assert.ok(!reopened.valid);
  assert.equal(reopened.issues[0].code, 'TT2S1001');
  // The record is addressed by a hash that excludes the stage, so a resume
  // that re-asserts the run as it created it replays instead of conflicting.
  const recreated = await store.putRun(records.run);
  assert.ok(recreated.valid, JSON.stringify(recreated.valid ? [] : recreated.issues));
  assert.equal(recreated.value.status, 'completed');
});
