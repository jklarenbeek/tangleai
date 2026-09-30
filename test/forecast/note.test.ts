import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createForecastExecutor, createNoteBuilder, forecastMust, forecastCheckpointFinalize, forecastQuery, forecastGet, combineForecastSpend } from '@tangleai/forecast';
import { runtimeFixture, scriptedClient } from './runtime-fixture.ts';

async function stopped() {
  const f = await runtimeFixture(), budget = { turns: 4,ms: 1000 };
  const execution = await createForecastExecutor({ ...f,client: scriptedClient(async () => ({ message: { role: 'assistant',content: '\\boxed{approve}' },finishReason: 'stop',usage: { total_tokens: 9 } })),budget,now: () => 0 }).run(f);
  return { ...f,execution,budget,artifact: { question: f.question,checkpoint: f.checkpoint,trace: execution.trace,evidence: execution.evidence,finalMessage: execution.finalMessage,stopReason: 'stop' as const } };
}
describe('checkpoint note builder', () => {
  it('a note has all six sections and no comparison or outcome field', async () => {
    const f = await stopped(), requests: any[] = [];
    const client = scriptedClient(async request => { requests.push(request); return { message: { role: 'assistant',content: JSON.stringify(f.corpus.notes['q01-c1']) },finishReason: 'stop',usage: { total_tokens: 5 } }; });
    const input = { ...f.artifact,otherCheckpoint: 'hidden',outcome: 'secret',revision: 'secret' };
    const result = await createNoteBuilder({ client,now: () => 0 }).build(input,{ ...f.budget,spent: f.execution.budgetSpent });
    assert.equal(result.noteFailure,null); assert.equal(Object.keys(result.note!.sections).length,6);
    assert.ok(!JSON.stringify(requests).includes('secret')); assert.ok(!JSON.stringify(requests).includes('hidden'));
    assert.notEqual(result.note!.promptRevision,f.checkpoint.promptRevision); assert.notEqual(result.note!.toolsetRevision,f.checkpoint.toolsetRevision);
    const final = forecastMust(await forecastCheckpointFinalize(f.store,{ checkpointId: f.checkpoint.id,at: f.checkpoint.scheduledAt,prediction: f.execution.prediction!,trace: f.execution.trace,...result,evidence: f.execution.evidence,spend: combineForecastSpend(f.execution.spend,result.spend),stopReason: 'stop' }));
    assert.equal(final.status,'finalized'); assert.equal(final.noteFailure,null); assert.equal(final.spend.calls,2);
  });
  it('extra sections fail after one repair and leave a finalized prediction with a counted note failure', async () => {
    const f = await stopped(); let calls = 0;
    const client = scriptedClient(async () => { calls++; return { message: { role: 'assistant',content: JSON.stringify({ ...f.corpus.notes['q01-c1'] as Record<string,unknown>,outcome: 'approve' }) },finishReason: 'stop',usage: { total_tokens: 5 } }; });
    const result = await createNoteBuilder({ client,now: () => 0 }).build(f.artifact,{ ...f.budget,spent: f.execution.budgetSpent });
    assert.equal(calls,2); assert.equal(result.note,null); assert.equal(result.noteFailure?.code,'TFCT1001');
    const final = forecastMust(await forecastCheckpointFinalize(f.store,{ checkpointId: f.checkpoint.id,at: f.checkpoint.scheduledAt,prediction: f.execution.prediction!,trace: f.execution.trace,...result,evidence: f.execution.evidence,spend: combineForecastSpend(f.execution.spend,result.spend),stopReason: 'stop' }));
    assert.equal(final.status,'finalized'); assert.equal(final.noteId,null); assert.equal(final.noteFailure?.code,'TFCT1001'); assert.equal(final.spend.calls,3);
    assert.equal(forecastMust(await forecastQuery(f.store,'notes')).length,0);
    assert.equal(forecastMust(await forecastGet(f.store,'predictions',final.predictionId!))?.normalized,'approve');
  });
  it('note repairs consume the remaining checkpoint allowance and stopped JSON is refused', async () => {
    const f = await stopped(); let calls = 0;
    const invalid = scriptedClient(async () => { calls++; return { message: { role: 'assistant',content: '{}' },finishReason: 'stop',usage: null }; });
    const result = await createNoteBuilder({ client: invalid,now: () => 0 }).build(f.artifact,{ turns: 2,ms: 1000,spent: f.execution.budgetSpent });
    assert.equal(calls,1); assert.equal(result.note,null); assert.match(result.noteFailure!.detail,/budget-turns/); assert.equal(result.spend.tokens,null);
    const exhausted = await createNoteBuilder({ client: invalid,now: () => 0 }).build(f.artifact,{ turns: 1,ms: 1000,spent: f.execution.budgetSpent });
    assert.equal(exhausted.spend.calls,0); assert.equal(calls,1);
    const length = await createNoteBuilder({ client: scriptedClient(async () => ({ message: { role: 'assistant',content: JSON.stringify(f.corpus.notes['q01-c1']) },finishReason: 'length',usage: { total_tokens: 2 } })),now: () => 0 }).build(f.artifact,f.budget);
    assert.equal(length.noteFailure?.code,'TFCT1001'); assert.equal(length.note,null);
  });
  it('faults during atomic finalization publish no partial runtime artifacts', async () => {
    for (const point of ['put:forecast_predictions','put:forecast_traces','put:forecast_notes','put:forecast_checkpoints','commit']) {
      let fault = false;
      const f = await runtimeFixture('static-harness',{}, { applyProbe: step => { if (fault && step === point) throw Error('injected finalization fault'); } });
      const execution = await createForecastExecutor({ ...f,client: scriptedClient(async () => ({ message: { role: 'assistant',content: '\\boxed{approve}' },finishReason: 'stop',usage: { total_tokens: 3 } })),budget: { turns: 3,ms: 1000 },now: () => 0 }).run(f);
      const note = await createNoteBuilder({ client: scriptedClient(async () => ({ message: { role: 'assistant',content: JSON.stringify(f.corpus.notes['q01-c1']) },finishReason: 'stop',usage: { total_tokens: 4 } })),now: () => 0 }).build({ question: f.question,checkpoint: f.checkpoint,trace: execution.trace,evidence: execution.evidence,finalMessage: execution.finalMessage,stopReason: 'stop' },{ turns: 3,ms: 1000,spent: execution.budgetSpent });
      fault = true;
      const input = { checkpointId: f.checkpoint.id,at: f.checkpoint.scheduledAt,prediction: execution.prediction!,trace: execution.trace,note: note.note,evidence: execution.evidence,spend: combineForecastSpend(execution.spend,note.spend),stopReason: 'stop' as const };
      assert.equal((await forecastCheckpointFinalize(f.store,input)).ok,false,point); fault = false;
      assert.equal(forecastMust(await forecastGet(f.store,'checkpoints',f.checkpoint.id))!.status,'running');
      for (const table of ['predictions','traces','notes','evidence'] as const) assert.equal(forecastMust(await forecastQuery(f.store,table)).length,0,table);
      assert.equal(forecastMust(await forecastCheckpointFinalize(f.store,input)).status,'finalized');
      const replay = await forecastCheckpointFinalize(f.store,input); assert.equal(replay.ok,true); if(replay.ok) assert.equal(replay.writes,0);
    }
  });
});
