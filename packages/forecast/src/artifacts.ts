/** Shared checks for one-shot and durable staged artifact publication. */
import { equalsJson } from '@jarenjs/core/object';
import { forecastMust, reject } from './errors.ts';
import { admitEvidence } from './evidence.ts';
import { forecastPromptRevisions } from './prompts.ts';
import { forecastRevision } from './identity.ts';
import { parseForecastAnswer } from './adapters/index.ts';
import type { ForecastCommandTransaction } from './store.ts';
import type { ForecastCheckpoint, ForecastQuestion, ForecastPrediction, ForecastTrace, ForecastEvidence, CheckpointNote, CheckpointFailure } from './contracts.gen.ts';

export function checkForecastPrediction(question: ForecastQuestion, prediction: ForecastPrediction) {
  if (prediction.adapterId !== question.adapter.id || prediction.adapterVersion !== question.adapter.version) reject('TFCT1002', 'The prediction differs from the question adapter.');
  if (prediction.normalized !== forecastMust(parseForecastAnswer(question.adapter,prediction.raw)) || prediction.uncertainty !== null) reject('TFCT1009', 'The prediction differs from its parsed answer or carries undeclared probability.');
}
export async function checkForecastNote(checkpoint: ForecastCheckpoint, trace: ForecastTrace, note: CheckpointNote | null, noteFailure: CheckpointFailure | null, evidence: ForecastEvidence[]) {
  if (note && (note.checkpointId !== checkpoint.id || trace.checkpointId !== checkpoint.id)) reject('TFCT1003','The note and trace cross checkpoint ownership.');
  if (note && (note.traceId !== trace.id || ['configuration','noteSchemaRevision'].some(key => !equalsJson(note[key as keyof CheckpointNote],checkpoint[key as keyof ForecastCheckpoint])))) reject('TFCT1002', 'The note differs from the checkpoint configuration, schema or trace.');
  if (note && (note.promptRevision !== (await forecastPromptRevisions()).note || note.toolsetRevision !== await forecastRevision([]))) reject('TFCT1002', 'The note differs from its producer prompt or empty toolset.');
  if (note && note.evidenceIds.some(id => !evidence.some(e => e.id === id && e.admitted))) reject('TFCT1006', 'A note cites evidence not admitted by this checkpoint.');
  if ((note === null) === (noteFailure === null) || noteFailure && noteFailure.code !== 'TFCT1001') reject('TFCT1001', 'Retain either a note or its counted generation failure.');
}
export async function retainForecastEvidence(tx: ForecastCommandTransaction, checkpoint: ForecastCheckpoint, evidence: ForecastEvidence[]) {
  if (new Set(evidence.map(e => e.id)).size !== evidence.length) reject('TFCT1001', 'Checkpoint evidence contains duplicate ids.');
  for (const e of evidence) {
    if (e.checkpointId !== checkpoint.id) reject('TFCT1003', 'The evidence belongs to another checkpoint.');
    if (e.kind === 'snapshot') {
      const gate = forecastMust(admitEvidence(e,checkpoint.cutoffAt));
      if (e.admitted !== gate.admitted || !gate.admitted && e.refusal?.reason !== gate.reason) reject('TFCT1006', 'Replay evidence differs from its cutoff admission.');
    }
    await tx.put('evidence',e);
  }
}
