import { runtimeFixture, scriptedClient } from './runtime-fixture.ts';
import { createForecastExecutor, createNoteBuilder, createForecastToolbox, forecastCheckpointRecordExecution, forecastCheckpointRecordNote, forecastCheckpointFinalize, forecastCheckpointPlan, forecastCheckpointStart, sealForecastRecord, forecastMust, createMemoryForecastStore, type ForecastQuestion, type ForecastCheckpoint } from '@tangleai/forecast';

export async function feedbackFixture(storeOptions: Parameters<typeof createMemoryForecastStore>[0] = {}) {
  const f = await runtimeFixture('evolving-harness',{},storeOptions), budget = { turns: 12,ms: 1000 };
  let checkpoint = f.checkpoint;
  const checkpoints: ForecastCheckpoint[] = [];
  for (const ordinal of [1,2]) {
    const scheduled = f.corpus.questions[0].checkpoints[ordinal - 1];
    if (ordinal > 1) {
      const planned = await sealForecastRecord('checkpoints',{ ...f.checkpoint,ordinal,scheduledAt: scheduled.scheduledAt,cutoffAt: scheduled.cutoffAt,status: 'planned',startedAt: null });
      forecastMust(await forecastCheckpointPlan(f.store,planned)); checkpoint = forecastMust(await forecastCheckpointStart(f.store,planned.id,scheduled.scheduledAt));
    }
    const toolbox = await createForecastToolbox({ store: f.store,checkpoint,harness: f.harness,cutoffPolicy: { kind: 'replay',corpus: 'tidewater',snapshots: f.corpus.snapshots.filter(s => scheduled.snapshotIds.includes(s.id)).map(s => ({ ...s,questionId: f.question.id })) },now: () => scheduled.scheduledAt });
    const execution = await createForecastExecutor({ client: scriptedClient(async () => ({ message: { role: 'assistant',content: '\\boxed{approve}' },finishReason: 'stop',usage: { total_tokens: 3 } })),toolbox,harness: f.harness,budget,now: () => 0 }).run({ question: f.question,checkpoint });
    checkpoint = forecastMust(await forecastCheckpointRecordExecution(f.store,execution));
    const result = await createNoteBuilder({ client: scriptedClient(async () => ({ message: { role: 'assistant',content: JSON.stringify(f.corpus.notes[scheduled.id]) },finishReason: 'stop',usage: { total_tokens: 4 } })),now: () => 0 }).build({ question: f.question,checkpoint,trace: execution.trace,evidence: execution.evidence,finalMessage: execution.finalMessage,stopReason: 'stop' },{ ...budget,spent: execution.budgetSpent });
    checkpoint = forecastMust(await forecastCheckpointRecordNote(f.store,checkpoint.id,result));
    if (ordinal === 1) checkpoint = forecastMust(await forecastCheckpointFinalize(f.store,{ checkpointId: checkpoint.id,at: checkpoint.scheduledAt,prediction: execution.prediction!,trace: execution.trace,note: result.note,evidence: execution.evidence,spend: checkpoint.spend,stopReason: 'stop' }));
    checkpoints.push(checkpoint);
  }
  const item = { component: 'evidenceHandling' as const,text: (f.corpus.leaks as { allow: string[] }).allow[0],sources: ['note:' + checkpoint.noteId] };
  const { toolbox: _executorToolbox,...shared } = f;
  return { ...shared,checkpoint,checkpoints,item,budget: { ...budget,spent: checkpoint.progress!.note!.budgetSpent },now: () => checkpoint.scheduledAt,clock: () => 0 };
}
export const feedbackAnswer = (value: unknown, usage: unknown = { total_tokens: 5 }) => ({ message: { role: 'assistant',content: JSON.stringify(value) },finishReason: 'stop',usage });
