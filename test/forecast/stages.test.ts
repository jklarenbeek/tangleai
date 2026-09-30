import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createForecastExecutor, createNoteBuilder, forecastCheckpointRecordExecution, forecastCheckpointRecordNote, forecastCheckpointFinalize, forecastMust, forecastGet, forecastQuery, FORECAST_TABLES } from '@tangleai/forecast';
import { runtimeFixture, scriptedClient } from './runtime-fixture.ts';

it('retains execution artifacts and budget charges before an orchestration attempt completes', async () => {
  const f = await runtimeFixture();
  const execution = await createForecastExecutor({ ...f,client: scriptedClient(async () => ({ message: { role: 'assistant',content: '\\boxed{approve}' },finishReason: 'stop',usage: null })),budget: { turns: 4,tokens: 10000,ms: 1000 },now: () => 0 }).run(f);
  const recorded = forecastMust(await forecastCheckpointRecordExecution(f.store,execution));
  assert.equal(recorded.status,'running'); assert.equal(recorded.traceId,execution.trace.id);
  assert.equal(recorded.predictionId,execution.prediction!.id); assert.equal(recorded.spend.tokens,null);
  assert.ok(recorded.progress!.execution.budgetSpent.tokens > 0);
  assert.equal(forecastMust(await forecastGet(f.store,'predictions',execution.prediction!.id))!.normalized,'approve');
  const repeated = await forecastCheckpointRecordExecution(f.store,execution);
  assert.equal(repeated.ok,true); if(repeated.ok) assert.equal(repeated.writes,0);
  let noteCalls = 0;
  const note = await createNoteBuilder({ client: scriptedClient(async () => { noteCalls++; throw Error('The consumed token budget must prevent another purchase.'); }),now: () => 0 }).build({ ...f,checkpoint: recorded,trace: execution.trace,evidence: execution.evidence,finalMessage: execution.finalMessage,stopReason: 'stop' },{ turns: 4,tokens: execution.budgetSpent.tokens,ms: 1000,spent: recorded.progress!.execution.budgetSpent });
  assert.equal(noteCalls,0); assert.equal(note.note,null); assert.equal(note.noteFailure?.code,'TFCT1001');
  const saved = forecastMust(await forecastCheckpointRecordNote(f.store,recorded.id,note));
  assert.equal(saved.spend.tokens,null); assert.deepEqual(saved.progress!.note!.budgetSpent,execution.budgetSpent);
  const replayedNote = await forecastCheckpointRecordNote(f.store,recorded.id,note); assert.equal(replayedNote.ok,true); if(replayedNote.ok) assert.equal(replayedNote.writes,0);
  const final = forecastMust(await forecastCheckpointFinalize(f.store,{ checkpointId: recorded.id,at: recorded.scheduledAt,prediction: execution.prediction!,trace: execution.trace,evidence: execution.evidence,note: null,noteFailure: note.noteFailure,spend: saved.spend,stopReason: 'stop' }));
  assert.equal(final.status,'finalized'); assert.equal(final.spend.tokens,null); assert.deepEqual(final.progress,saved.progress);
  const replayed = await forecastCheckpointRecordExecution(f.store,execution); assert.equal(replayed.ok,true); if(replayed.ok) assert.equal(replayed.writes,0);
  const forged = await forecastCheckpointRecordExecution(f.store,{ ...execution,trace: { ...execution.trace,messages: [] } });
  assert.equal(forged.ok,false); if(!forged.ok) assert.equal(forged.issues[0].code,'TFCT1010');
});

for (const target of ['put:forecast_traces','put:forecast_predictions','put:forecast_checkpoints','commit']) it('rolls back the entire execution stage on ' + target,async () => {
  let armed = false;
  const f = await runtimeFixture('static-harness',{}, { applyProbe: step => { if (armed && step === target) throw Error('Atomic stage fault.'); } });
  const execution = await createForecastExecutor({ ...f,client: scriptedClient(async () => ({ message: { role: 'assistant',content: '\\boxed{approve}' },finishReason: 'stop',usage: { total_tokens: 5 } })),budget: { turns: 4,ms: 1000 },now: () => 0 }).run(f);
  const before = await Promise.all(FORECAST_TABLES.map(t => forecastQuery(f.store,t)));
  armed = true; const failed = await forecastCheckpointRecordExecution(f.store,execution); armed = false;
  assert.equal(failed.ok,false); assert.deepEqual(await Promise.all(FORECAST_TABLES.map(t => forecastQuery(f.store,t))),before);
  assert.equal((await forecastCheckpointRecordExecution(f.store,execution)).ok,true);
});
