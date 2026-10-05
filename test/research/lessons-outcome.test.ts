import { it } from 'node:test';
import assert from 'node:assert/strict';
import { isThenable } from '@jarenjs/core/function';
import { createMemoryOutcomeStore, type Head, type Json } from '@tangleai/outcomes';
import { openTangleDb, createOutcomeStore, createResearchStore } from '@tangleai/store';
import { createMemoryResearchStore, createResearchLessonAdapter, prepareResearchLessonSlot, recordLessonActivation, LESSON_MISSING_OUTPUT } from '@tangleai/research';
import { id, value, code } from '../outcomes/fixtures.ts';
import { memoryHarness, stored } from './store-harness.ts';
import { lessonScope } from './lessons-store-fixtures.ts';
import { lessonOutcomeFixture, output } from './lessons-outcome-fixtures.ts';

for (const sqlite of [false, true]) it(`${sqlite ? 'SQLite' : 'memory'} promotes two guarded lesson sets and rolls back through the native service`, async () => {
  const db = sqlite ? await openTangleDb() : null;
  let writes = 0;
  const probe = { applyProbe(step: string) { if (step.startsWith('put:') || step.startsWith('skill:put:')) writes++; } };
  const store = db ? createResearchStore(db, probe) : createMemoryResearchStore(probe);
  try {
    const f = await lessonOutcomeFixture(store, db ? createOutcomeStore(db) : createMemoryOutcomeStore());
    const root = await f.root(), child = await f.child(root.versionId);
    assert.equal(value(root.result).eligible, true); assert.equal(value(child.result).eligible, true);
    const approvalId = id(await f.approve(child.versionId, child.evaluationId, root.head, 'child'), 'approvalId');
    const activated = await f.service.promote(f.command('promote-child', { approvalId }));
    const eventId = id(activated, 'activationEventId');
    const secondAudit = stored(await recordLessonActivation({ store, outcomes: f.service, scope: lessonScope, activationEventId: eventId }));
    assert.equal(secondAudit.promoted[0].validation.state, 'promoted');
    const rollbackId = id(await f.approve(root.versionId, root.evaluationId, value(activated).head as unknown as Head, 'rollback', 'rollback'), 'approvalId');
    const rollback = await f.service.rollback(f.command('rollback', { approvalId: rollbackId }));
    const rollbackEvent = id(rollback, 'activationEventId');
    const audit = stored(await recordLessonActivation({ store, outcomes: f.service, scope: lessonScope, activationEventId: rollbackEvent }));
    assert.equal(audit.promoted.length, 1); assert.equal(audit.rolledBack.length, 1);
    assert.equal(audit.rolledBack[0].promotion!.outcomeVersionId, child.versionId);
    assert.equal(audit.rolledBack[0].promotion!.activationEventId, rollbackEvent);
    assert.equal(audit.rolledBack[0].parentId, child.next.validated[0].id);
    const head = value(await f.service.injectChecked({ scopeId: f.service.scopeId, artifactKey: f.artifactKey, input: {} }));
    assert.deepEqual(head.head, { versionId: root.versionId, revision: 3 }); assert.deepEqual(head.payload, f.staged.set.payload);
    for (const original of [...f.staged.validated, ...child.next.validated]) assert.deepEqual(stored(await store.lessons.get(original.id)), original);
    assert.deepEqual(stored(await store.lessons.getSet(child.next.set.id)), child.next.set);
    const beforeReplay = writes, replay = await recordLessonActivation({ store, outcomes: f.service, scope: lessonScope, activationEventId: rollbackEvent });
    assert.ok(replay.ok && replay.replayed); assert.equal(writes - beforeReplay, 0);
    const stale = await f.service.promote(f.command('stale-child', { approvalId })); code(stale, 'OUTC1007');
    const evaluation = value(await f.service.inspect({ scopeId: f.service.scopeId, artifactKey: f.artifactKey, input: { id: child.evaluationId } }));
    assert.equal(evaluation.physicalRequests, 0); assert.equal(evaluation.cost, 0);
    assert.deepEqual(child.prepared.spend, { calls: 0, tokens: 0, physical: 0, replayed: 0, ms: 0, cost: 0 });
  } finally { await db?.close(); }
});

it('interpretation and payload guards are synchronous, immutable and bound to exact registered topics', async () => {
  const h = await memoryHarness();
  try {
    const f = await lessonOutcomeFixture(h.store, createMemoryOutcomeStore()), row = f.firstRun.rows[0];
    const answer = f.adapter.interpret({ topicId: row.topicId, inputHash: row.inputHash }, f.staged.set.payload as unknown as Json);
    assert.equal(isThenable(answer), false); assert.deepEqual(answer, row.output); assert.ok(Object.isFrozen(answer));
    for (const input of [{ topicId: 'renamed-topic', inputHash: row.inputHash }, { topicId: row.topicId, inputHash: 'unknown' }]) {
      const missing = f.adapter.interpret(input, f.staged.set.payload as unknown as Json);
      assert.deepEqual(missing, LESSON_MISSING_OUTPUT); assert.equal(f.adapter.score(missing as Json, row.truth as unknown as Json).outcome, 'failure');
    }
    assert.deepEqual(f.adapter.validatePayload(f.adapter.staticPayload), []);
    assert.deepEqual(f.adapter.validatePayload(f.staged.set.payload as unknown as Json), []);
    const forged = structuredClone(f.staged.set.payload); forged.lessonIds = [f.origin.lesson.id];
    assert.equal(f.adapter.validatePayload(forged as unknown as Json)[0].code, 'OUTC1010');
    assert.equal(f.adapter.score(output(.75) as unknown as Json, output(1) as unknown as Json).outcome, 'partial');
    assert.equal(f.adapter.score(output(0) as unknown as Json, output(0) as unknown as Json).outcome, 'failure');
  } finally { await h.close(); }
});
it('refuses a missing baseline instead of allowing a zero-based improvement', async () => {
  const h = await memoryHarness();
  try {
    const f = await lessonOutcomeFixture(h.store, createMemoryOutcomeStore());
    const versionId = id(await f.reflect('root', f.staged.set.payload as unknown as Json), 'versionId');
    const result = await prepareResearchLessonSlot({ store: h.store, outcomes: f.service,
      adapter: { ...f.adapter, staticPayload: { ...(f.adapter.staticPayload as Record<string, Json>), rows: {} } },
      scope: lessonScope, validationRunId: f.firstRun.id, versionId, slotId: 'missing-baseline' });
    assert.equal(result.valid, false); if (!result.valid) { assert.equal(result.issues[0].code, 'TRSH2004'); assert.match(result.issues[0].detail, /missing is not zero/); }
  } finally { await h.close(); }
});
it('preserves minority-domain loss in the native eligibility and approval gates', async () => {
  const h = await memoryHarness();
  try {
    const f = await lessonOutcomeFixture(h.store, createMemoryOutcomeStore(), [
      { id: 'majority-a', score: 1, baseline: .5, domain: 'majority' },
      { id: 'majority-b', score: 1, baseline: .5, domain: 'majority' },
      { id: 'minority-a', score: 0, baseline: .5, domain: 'minority' },
    ]);
    const versionId = id(await f.reflect('volatile', f.staged.set.payload as unknown as Json), 'versionId');
    const evaluated = await f.evaluate(versionId, f.firstRun, 'volatile');
    assert.deepEqual(evaluated.prepared.slot.cases.map(row => row.domain), ['majority', 'majority', 'minority']);
    assert.equal(value(evaluated.result).eligible, false); assert.match(JSON.stringify(value(evaluated.result).issues), /domain regressed/);
    code(await f.approve(versionId, evaluated.evaluationId, { versionId: null, revision: 0 }, 'volatile'), 'OUTC1011');
    code(await f.service.injectChecked({ scopeId: f.service.scopeId, artifactKey: f.artifactKey, input: {} }), 'OUTC1004');
  } finally { await h.close(); }
});
it('refuses ordinary proposals as outcome payloads and cannot mint an activation from a version ID', async () => {
  const h = await memoryHarness();
  try {
    const f = await lessonOutcomeFixture(h.store, createMemoryOutcomeStore()), payload = structuredClone(f.staged.set.payload);
    payload.lessonIds = [f.origin.lesson.id];
    const reflected = await f.reflect('unvalidated', payload as unknown as Json), versionId = id(reflected, 'versionId');
    const version = value(await f.service.inspect({ scopeId: f.service.scopeId, artifactKey: f.artifactKey, input: { id: versionId } }));
    assert.match(JSON.stringify(version.issues), /OUTC1010/);
    const before = await h.capture(), audit = await recordLessonActivation({ store: h.store, outcomes: f.service, scope: lessonScope, activationEventId: versionId });
    assert.equal(audit.ok, false); if (!audit.ok) assert.equal(audit.issue.code, 'TRSH2007'); assert.deepEqual(await h.capture(), before);
    const missing = await createResearchLessonAdapter({ store: h.store, scope: lessonScope, baseBundleHash: f.origin.snapshot.bundle.id,
      validationRunIds: [f.firstRun.id], lessonSetIds: [f.staged.set.id] });
    assert.equal(missing.valid, false); if (!missing.valid) assert.equal(missing.issues[0].code, 'TRSH2004');
  } finally { await h.close(); }
});
