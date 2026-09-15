/**
 * Lifecycle guards and the revision-fenced activation plan. The fence is the
 * outcomes head planner, so its refusal travels as the cause rather than being
 * renumbered, and eligibility never follows from structural validity.
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_SKILL_HEAD, assertFrozenBase, planActivation, planBundleStatus, planRollback, planRunStage,
  planSkillPromotion, type SkillHead, type SkillPromotionRegistration } from '@tangleai/trace2skill';
import { lifecycleRecords } from './fixture.ts';

const records = await lifecycleRecords();
const parent = records.frozen.bundle.id;
const head = { versionId: parent, revision: 1 };
const registration: SkillPromotionRegistration = {
  scopeKey: records.candidate.scopeKey, executorIdentityId: 'keyless',
  policyVersion: 'held-out-v1', testHash: records.run.testHash, expectedHead: head,
};

it('an invalid lifecycle move is refused and a legal one is planned', () => {
  assert.deepEqual(EMPTY_SKILL_HEAD, { versionId: null, revision: 0 });
  for (const [from, to] of [['staged', 'active'], ['active', 'eligible'], ['archived', 'eligible'], ['rejected', 'eligible']] as const) {
    const refused = planBundleStatus(from, to);
    assert.ok(!refused.valid, `${from} to ${to}`);
    assert.equal(refused.issues[0].code, 'TT2S1001');
  }
  // An archived directory may become active again — its pages were never
  // deleted — but only through the fenced swap, never through a status write.
  for (const [from, to] of [['staged', 'eligible'], ['eligible', 'active'], ['active', 'archived'], ['eligible', 'rejected'], ['archived', 'active']] as const)
    assert.ok(planBundleStatus(from, to).valid, `${from} to ${to}`);
  assert.ok(planRunStage('planned', 'running').valid);
  // A run that stopped part way is resumable, so the stage it stopped in is
  // not where it stays; a run that reached its end is finished for good.
  assert.ok(planRunStage('refused', 'completed').valid);
  const closed = planRunStage('completed', 'running');
  assert.ok(!closed.valid);
  assert.equal(closed.issues[0].code, 'TT2S1001');
  assert.ok(!planRunStage('completed', 'refused').valid);
});

it('a rollback is the same fence backwards and refuses everything an activation would', () => {
  const from: SkillHead = { versionId: 'a'.repeat(64), revision: 2 };
  const target = { bundleId: 'b'.repeat(64), status: 'archived' as const };
  const planned = planRollback(from, from, target);
  assert.ok(planned.valid, planned.valid ? '' : JSON.stringify(planned.issues));
  assert.deepEqual(planned.value, { versionId: target.bundleId, revision: 3 });
  for (const [refused, why] of [
    [planRollback({ versionId: null, revision: 0 }, { versionId: null, revision: 0 }, target), 'an empty head'],
    [planRollback(from, from, { bundleId: from.versionId as string, status: 'active' }), 'the active directory'],
    [planRollback(from, from, { ...target, status: 'eligible' }), 'a directory that was never active'],
    [planRollback(from, { versionId: 'a'.repeat(64), revision: 1 }, target), 'a stale fence'],
  ] as const) {
    assert.ok(!refused.valid, why);
    assert.equal(refused.issues[0].code, 'TT2S1010', why);
  }
});

it('a frozen-directory hash mismatch anywhere is an identity refusal', () => {
  assert.ok(assertFrozenBase(records.run, records.run.s0Hash, '/s0Hash').valid);
  const stale = assertFrozenBase(records.run, '0'.repeat(64), '/s0Hash');
  assert.ok(!stale.valid);
  assert.equal(stale.issues[0].code, 'TT2S1002');
});

it('a stale parent is refused before the fence is consulted', () => {
  const orphan = planActivation(head, head, { bundleId: records.evolved.bundle.id, parentId: null });
  assert.ok(!orphan.valid);
  assert.equal(orphan.issues[0].code, 'TT2S1010');
  assert.equal(orphan.issues[0].path, '/parentId');
  assert.equal(orphan.issues[0].cause, undefined, 'a parent mismatch is local, not a fence refusal');
});

it('an expected head with the right version and the wrong revision is refused', () => {
  const applied = planActivation(head, head, { bundleId: records.evolved.bundle.id, parentId: parent });
  assert.ok(applied.valid);
  assert.deepEqual(applied.value, { versionId: records.evolved.bundle.id, revision: 2 });

  for (const expected of [{ versionId: parent, revision: 0 }, { versionId: parent, revision: 2 }, { versionId: null, revision: 1 }]) {
    const fenced = planActivation(head, expected, { bundleId: records.evolved.bundle.id, parentId: parent });
    assert.ok(!fenced.valid, JSON.stringify(expected));
    assert.equal(fenced.issues[0].code, 'TT2S1010');
    assert.equal(fenced.issues[0].cause?.code, 'OUTC1013');
    assert.equal(fenced.issues[0].cause?.docPath, '/expectedHead');
  }
});

it('promotion binds the held-out evaluation, the executor, the policy and the head', () => {
  const promoted = planSkillPromotion(head, records.candidate, records.evaluation, registration);
  assert.ok(promoted.valid, promoted.valid ? '' : JSON.stringify(promoted.issues));
  assert.deepEqual(promoted.value, { versionId: records.evolved.bundle.id, revision: 2 });

  const cases: Array<[string, Parameters<typeof planSkillPromotion>, string]> = [
    ['another scope', [head, { ...records.candidate, scopeKey: 'other' }, records.evaluation, registration], 'TT2S1010'],
    ['another candidate', [head, records.candidate, { ...records.evaluation, candidateBundleId: 'f'.repeat(64) }, registration], 'TT2S1010'],
    ['another split', [head, records.candidate, { ...records.evaluation, testHash: 'a'.repeat(64) }, registration], 'TT2S1010'],
    ['another executor', [head, records.candidate, { ...records.evaluation, executorIdentityId: 'live' }, registration], 'TT2S1010'],
    ['another policy', [head, records.candidate, { ...records.evaluation, policyVersion: 'v2' }, registration], 'TT2S1010'],
    ['another registered head', [head, records.candidate, { ...records.evaluation, expectedHead: { versionId: null, revision: 0 } }, registration], 'TT2S1010'],
    ['a counted leak', [head, records.candidate, { ...records.evaluation, leakage: 1 }, registration], 'TT2S1006'],
    ['an ineligible evaluation', [head, records.candidate, { ...records.evaluation, eligible: false }, registration], 'TT2S1010'],
    ['an unresolved candidate', [head, { ...records.candidate, semantic: { valid: false, issues: [] } }, records.evaluation, registration], 'TT2S1010'],
  ];
  for (const [label, argv, code] of cases) {
    const refused = planSkillPromotion(...argv);
    assert.ok(!refused.valid, label);
    assert.equal(refused.issues[0].code, code, label);
  }
});
