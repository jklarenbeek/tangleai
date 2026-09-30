/** Durable purchase receipts precede the orchestration attempt's completion. */
import { equalsJson } from '@jarenjs/core/object';
import { forecastCommandTransaction, type ForecastStore } from './store.ts';
import { checkShape } from './schema.ts';
import { reject } from './errors.ts';
import { checkForecastPrediction, checkForecastNote, retainForecastEvidence } from './artifacts.ts';
import { combineForecastSpend } from './meter.ts';
import type { ForecastExecution } from './executor.ts';
import type { createNoteBuilder } from './note.ts';
import type { ForecastStageReceipt, ForecastCheckpoint } from './contracts.gen.ts';

function receipt(input: Pick<ForecastExecution,'spend'|'budgetSpent'|'calls'>): ForecastStageReceipt {
  return checkShape('forecastStageReceipt',{ spend: input.spend,budgetSpent: input.budgetSpent,calls: input.calls });
}
export function forecastCheckpointRecordExecution(store: ForecastStore, input: ForecastExecution) {
  return forecastCommandTransaction(store,async tx => {
    const checkpoint = await tx.get('checkpoints',input.checkpointId);
    if (!checkpoint) reject('TFCT1002','The execution checkpoint is missing.');
    const question = await tx.get('questions',checkpoint.questionId);
    if (!question) reject('TFCT1002','The execution question is missing.');
    const execution = receipt(input);
    if (input.trace.checkpointId !== checkpoint.id || input.prediction && input.prediction.checkpointId !== checkpoint.id) reject('TFCT1003','The execution artifacts cross checkpoint ownership.');
    if (input.prediction) checkForecastPrediction(question,input.prediction);
    if ((input.prediction === null) === (input.failure === null) || input.prediction && input.stopReason !== 'stop') reject('TFCT1001','Retain either a stopped prediction or the execution failure.');
    await retainForecastEvidence(tx,checkpoint,input.evidence);
    await tx.put('traces',input.trace); if (input.prediction) await tx.put('predictions',input.prediction);
    if (checkpoint.progress) {
      if (!equalsJson(checkpoint.progress.execution,execution) || checkpoint.traceId !== input.trace.id || checkpoint.predictionId !== (input.prediction?.id ?? null) || checkpoint.stopReason !== input.stopReason || !equalsJson(checkpoint.failure,input.failure) || !equalsJson(checkpoint.evidenceIds,input.evidence.map(e => e.id))) reject('TFCT1010','The checkpoint already contains another execution receipt.');
      return checkpoint;
    }
    if (checkpoint.status !== 'running') reject('TFCT1004','Only a running checkpoint can retain an execution receipt.');
    const next: ForecastCheckpoint = { ...checkpoint,traceId: input.trace.id,predictionId: input.prediction?.id ?? null,evidenceIds: input.evidence.map(e => e.id),stopReason: input.stopReason,failure: input.failure,spend: input.spend,progress: { execution,note: null } };
    await tx.replace('checkpoints',checkpoint,next); return next;
  });
}
export type ForecastNoteResult = Awaited<ReturnType<ReturnType<typeof createNoteBuilder>['build']>>;
export function forecastCheckpointRecordNote(store: ForecastStore, checkpointId: string, input: ForecastNoteResult) {
  return forecastCommandTransaction(store,async tx => {
    const checkpoint = await tx.get('checkpoints',checkpointId);
    if (!checkpoint || !checkpoint.progress || !checkpoint.predictionId || !checkpoint.traceId) reject('TFCT1004','Retain a successful checkpoint execution before its note.');
    const note = receipt(input);
    if (input.note) await tx.put('notes',input.note);
    if (checkpoint.progress.note) {
      if (!equalsJson(checkpoint.progress.note,note) || checkpoint.noteId !== (input.note?.id ?? null) || !equalsJson(checkpoint.noteFailure,input.noteFailure)) reject('TFCT1010','The checkpoint already contains another note receipt.');
      return checkpoint;
    }
    if (checkpoint.status !== 'running') reject('TFCT1004','Only a running checkpoint can retain its note receipt.');
    const trace = (await tx.get('traces',checkpoint.traceId))!, evidence = await Promise.all(checkpoint.evidenceIds.map(async id => (await tx.get('evidence',id))!));
    await checkForecastNote(checkpoint,trace,input.note,input.noteFailure,evidence);
    const next: ForecastCheckpoint = { ...checkpoint,noteId: input.note?.id ?? null,noteFailure: input.noteFailure,spend: combineForecastSpend(checkpoint.progress.execution.spend,input.spend),progress: { ...checkpoint.progress,note } };
    await tx.replace('checkpoints',checkpoint,next); return next;
  });
}
