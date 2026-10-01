import { describe,it } from 'node:test';
import assert from 'node:assert/strict';
import { planQuestionTransition, planCheckpointTransition, planHarnessTransition, visibleHarness, dueCheckpoints, applyForecastTransition, sealForecastRecord, type ForecastCommandResult, type ForecastSchedule } from '@tangleai/forecast';
import type { ActivationEvent } from '@tangleai/outcomes';
import { makeForecastFixture,must,at,end,hash } from './fixtures.ts';

function refusal(result: ForecastCommandResult<unknown>, code: string, detail: string) {
  assert.equal(result.ok,false); if (!result.ok) assert.deepEqual(result.issues,[{ code,path: detail.startsWith('Resolution conflicts') ? '/outcome' : '',detail,retryable: false }]);
}
describe('pure forecast lifecycle policy', () => {
  it('pins out-of-order and duplicate question/ordinal transitions',async () => {
    const f = await makeForecastFixture(), second = await sealForecastRecord('checkpoints',{ ...f.checkpoints,ordinal: 2,scheduledAt: f.questions.checkpointPolicy.scheduledAt[1],cutoffAt: f.questions.checkpointPolicy.scheduledAt[1] });
    const context = { ordinals: [1,2,3],checkpoints: [f.checkpoints,second] };
    refusal(planCheckpointTransition(second,{ type: 'checkpoint.start',at: second.scheduledAt },context),'TFCT1004','The checkpoint is not the next unfinished ordinal.');
    refusal(planCheckpointTransition(f.checkpoints,{ type: 'checkpoint.start',at },{ ...context,checkpoints: [f.checkpoints,{ ...f.checkpoints,id: hash }] }),'TFCT1004','A checkpoint already owns this question and ordinal.');
    const plan = must(planCheckpointTransition(f.checkpoints,{ type: 'checkpoint.start',at },context)); assert.equal(plan.after.status,'running');
    refusal(applyForecastTransition({ ...f.checkpoints,status: 'failed' as const },plan),'TFCT1004','The lifecycle record changed after planning.');
    assert.deepEqual(must(applyForecastTransition(f.checkpoints,plan)),plan.after);
    refusal(planCheckpointTransition(f.checkpoints,{ type: 'checkpoint.finalize',at: end },context),'TFCT1004','The checkpoint cannot take this lifecycle transition.');
  });
  it('refuses another question provisional and another scope checked reference',async () => {
    const f = await makeForecastFixture(), other = (await makeForecastFixture(' other')).questions;
    const provisional = { ...f.harnesses,questionId: other.id,status: 'provisional' as const,provenance: { ...f.harnesses.provenance,seed: false } };
    refusal(visibleHarness(f.questions,provisional),'TFCT1003','The provisional harness belongs to another question.');
    const checked = { ...f.harnesses,status: 'checked-ref' as const,checkedVersionId: hash,questionId: other.id };
    assert.deepEqual(must(visibleHarness(f.questions,checked)),checked);
    refusal(visibleHarness({ ...f.questions,scopeKey: 'foreign' },checked),'TFCT1003','The harness belongs to another scope.');
    assert.deepEqual(must(visibleHarness(f.questions,f.harnesses)),f.harnesses);
  });
  it('requires an outcome activation event for a checked reference',async () => {
    const f = await makeForecastFixture(), v = { ...f.harnesses,questionId: f.questions.id };
    refusal(planHarnessTransition(v,{ type: 'retrospective.promote',activationEvent: null }),'TFCT1004','A checked reference requires an outcome promotion activation event.');
    const event: ActivationEvent = { schemaVersion: 1,id: hash,scopeId: hash,artifactKey: 'harness',recordedAt: end,kind: 'activationEvent',action: 'promote',approvalId: hash,previousHead: { versionId: null,revision: 0 },nextHead: { versionId: hash,revision: 1 },versionId: hash,evaluationId: hash };
    const plan = must(planHarnessTransition(v,{ type: 'retrospective.promote',activationEvent: event })); assert.equal(plan.after.checkedVersionId,hash);
    refusal(planHarnessTransition(v,{ type: 'retrospective.promote',activationEvent: { ...event,nextHead: { versionId: hash,revision: 3 } } }),'TFCT1004','A checked reference requires an outcome promotion activation event.');
    const provisional = must(planHarnessTransition(v,{ type: 'harness.provisional' })).after;
    assert.equal(must(planHarnessTransition(provisional,{ type: 'resolution.archive' })).after.status,'archived');
    refusal(planHarnessTransition(provisional,{ type: 'harness.provisional' }),'TFCT1004','The harness cannot take this lifecycle transition.');
  });
  it('retains the earlier id on a conflicting resolution and pins question transitions',async () => {
    const f = await makeForecastFixture(), resolved = must(planQuestionTransition(f.questions,{ type: 'resolution.record',resolution: f.resolutions })).after;
    assert.equal(resolved.status,'resolved');
    const conflicting = await sealForecastRecord('resolutions',{ ...f.resolutions,outcome: 'reject' });
    refusal(planQuestionTransition(resolved,{ type: 'resolution.record',resolution: conflicting,earlier: f.resolutions }),'TFCT1004','Resolution conflicts with earlier record ' + f.resolutions.id + '.');
    assert.deepEqual(must(planQuestionTransition(resolved,{ type: 'resolution.record',resolution: f.resolutions,earlier: f.resolutions })).after,resolved);
    assert.equal(must(planQuestionTransition(resolved,{ type: 'resolution.correct',resolution: { ...conflicting,correctionOf: f.resolutions.id },earlier: f.resolutions })).after.status,'disputed');
    refusal(planQuestionTransition(f.questions,{ type: 'resolution.correct',resolution: conflicting }),'TFCT1004','The question cannot take this resolution transition.');
    refusal(planQuestionTransition(resolved,{ type: 'resolution.correct',resolution: f.resolutions }),'TFCT1004','The question cannot take this resolution transition.');
  });
  it('returns due checkpoints at equality in time/question/ordinal order without mutating input',async () => {
    const { schedules } = await makeForecastFixture();
    const rows: ForecastSchedule[] = [{ ...schedules,id: 'e'.repeat(64),questionId: 'd'.repeat(64),ordinal: 2 },{ ...schedules,id: 'd'.repeat(64),questionId: 'd'.repeat(64),ordinal: 1 },
      { ...schedules,id: 'c'.repeat(64),questionId: 'a'.repeat(64) },{ ...schedules,id: 'b'.repeat(64),scheduledAt: end },{ ...schedules,id: 'a'.repeat(64),status: 'complete' }];
    const before = structuredClone(rows); assert.deepEqual(must(dueCheckpoints(rows,at)).map(x => x.id),['c'.repeat(64),'d'.repeat(64),'e'.repeat(64)]); assert.deepEqual(rows,before);
    assert.equal(must(dueCheckpoints(rows,'2025-01-09T23:59:59.999Z')).length,0);
    const bad = dueCheckpoints(rows,'invalid'); assert.equal(bad.ok,false); if (!bad.ok) assert.equal(bad.issues[0].code,'TFCT1001');
  });
});
