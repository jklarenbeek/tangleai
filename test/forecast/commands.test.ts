import { describe,it } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryForecastStore, forecastQuestionCreate, forecastHarnessStage, forecastCheckpointPlan, forecastCheckpointStart, forecastCheckpointFinalize, forecastCheckpointFail,
  forecastHarnessProvisional, forecastHarnessArchive, forecastResolutionRecord, forecastGet, forecastQuery, sealForecastRecord, type ForecastCommandResult } from '@tangleai/forecast';
import { makeForecastFixture,must,at,end,hash } from './fixtures.ts';

const code = (r: ForecastCommandResult<unknown>) => r.ok ? null : r.issues[0].code;
async function setup() {
  const store = createMemoryForecastStore(), f = await makeForecastFixture();
  must(await forecastQuestionCreate(store,f.questions)); must(await forecastHarnessStage(store,f.harnesses)); must(await forecastCheckpointPlan(store,f.checkpoints));
  return { store,f };
}
describe('atomic forecast commands', () => {
  it('runs planned/running/finalized, publishes the complete artifact set and replays without writes',async () => {
    const { store,f } = await setup(); must(await forecastCheckpointStart(store,f.checkpoints.id,at));
    const input = { checkpointId: f.checkpoints.id,at: end,prediction: f.predictions,trace: f.traces,note: f.notes,evidence: [f.evidence],spend: { calls: 2,tokens: 40,ms: 1000,usageKnown: true },stopReason: 'stop' as const };
    const result = await forecastCheckpointFinalize(store,input), cp = must(result); assert.equal(cp.status,'finalized'); assert.equal(cp.noteId,f.notes.id);
    for (const table of ['evidence','predictions','traces','notes'] as const) assert.equal(must(await forecastQuery(store,table,{ checkpointId: cp.id })).length,1);
    for (const result of [await forecastQuestionCreate(store,f.questions),await forecastHarnessStage(store,f.harnesses),await forecastCheckpointPlan(store,f.checkpoints),await forecastCheckpointFinalize(store,input)]) { assert.equal(result.ok,true); if (result.ok) assert.equal(result.writes,0); }
    assert.equal(code(await forecastCheckpointFinalize(store,{ ...input,spend: { ...input.spend,calls: 3 } })),'TFCT1010');
  });
  it('refuses another harness under the same ordinal and refuses the next ordinal before completion',async () => {
    const { store,f } = await setup();
    const different = await sealForecastRecord('checkpoints',{ ...f.checkpoints,configuration: { kind: 'scripted',revision: hash } });
    assert.equal(code(await forecastCheckpointPlan(store,different)),'TFCT1004');
    const at2 = f.questions.checkpointPolicy.scheduledAt[1],second = await sealForecastRecord('checkpoints',{ ...f.checkpoints,ordinal: 2,scheduledAt: at2,cutoffAt: at2 });
    assert.equal(code(await forecastCheckpointPlan(store,second)),'TFCT1004');
    must(await forecastCheckpointStart(store,f.checkpoints.id,at));
    must(await forecastCheckpointFail(store,{ checkpointId: f.checkpoints.id,at: end,trace: f.traces,evidence: [],spend: { calls: 1,tokens: null,ms: 1000,usageKnown: false },stopReason: 'length',failure: { code: 'TFCT1005',detail: 'No stopped prediction.' } }));
    assert.equal(must(await forecastCheckpointPlan(store,second)).ordinal,2);
    const failed = must(await forecastGet(store,'checkpoints',f.checkpoints.id))!; assert.equal(failed.spend.tokens,null); assert.equal(failed.predictionId,null); assert.equal(failed.noteId,null);
  });
  it('refuses foreign artifact links and future or undated admitted evidence without partial writes',async () => {
    const { store,f } = await setup(); must(await forecastCheckpointStart(store,f.checkpoints.id,at));
    const input = { checkpointId: f.checkpoints.id,at: end,prediction: f.predictions,trace: f.traces,note: f.notes,evidence: [f.evidence],spend: { calls: 1,tokens: 1,ms: 1,usageKnown: true },stopReason: 'stop' as const };
    const note = await sealForecastRecord('notes',{ ...f.notes,promptRevision: hash });
    assert.equal(code(await forecastCheckpointFinalize(store,{ ...input,note })),'TFCT1002');
    const foreign = await sealForecastRecord('predictions',{ ...f.predictions,checkpointId: hash });
    assert.equal(code(await forecastCheckpointFinalize(store,{ ...input,prediction: foreign })),'TFCT1003');
    for (const availableAt of [end,null]) {
      const evidence = await sealForecastRecord('evidence',{ ...f.evidence,availableAt });
      const note = await sealForecastRecord('notes',{ ...f.notes,evidenceIds: [evidence.id] });
      assert.equal(code(await forecastCheckpointFinalize(store,{ ...input,evidence: [evidence],note })),'TFCT1006');
    }
    assert.equal(must(await forecastQuery(store,'notes')).length,0); assert.equal(must(await forecastQuery(store,'predictions')).length,0);
    assert.equal(must(await forecastGet(store,'checkpoints',f.checkpoints.id))!.status,'running');
  });
  it('keeps provisional versions question-local, rejects a stale parent and archives after resolution',async () => {
    const { store,f } = await setup();
    const candidate = await sealForecastRecord('harnesses',{ ...f.harnesses,questionId: f.questions.id,parentVersionId: f.harnesses.id,provenance: { seed: false,revisionId: null,retrospectiveId: null } });
    must(await forecastHarnessStage(store,candidate)); assert.equal(must(await forecastHarnessProvisional(store,candidate.id)).status,'provisional');
    assert.equal(must(await forecastGet(store,'questions',f.questions.id))!.latestProvisionalVersionId,candidate.id);
    const other = await sealForecastRecord('harnesses',{ ...candidate,recordedAt: end }); must(await forecastHarnessStage(store,other));
    assert.equal(code(await forecastHarnessProvisional(store,other.id)),'TFCT1004');
    assert.equal(code(await forecastHarnessArchive(store,candidate.id)),'TFCT1004');
    must(await forecastResolutionRecord(store,f.resolutions)); assert.equal(must(await forecastHarnessArchive(store,candidate.id)).status,'archived');
    assert.equal(must(await forecastGet(store,'questions',f.questions.id))!.latestProvisionalVersionId,null);
    const repeated = await forecastResolutionRecord(store,f.resolutions); assert.equal(repeated.ok,true); if (repeated.ok) assert.equal(repeated.writes,0);
    const conflicting = await sealForecastRecord('resolutions',{ ...f.resolutions,outcome: 'reject' });
    const refused = await forecastResolutionRecord(store,conflicting); assert.equal(code(refused),'TFCT1004'); if (!refused.ok) assert.match(refused.issues[0].detail,new RegExp(f.resolutions.id));
  });
});
