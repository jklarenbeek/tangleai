/** Atomic commands apply pure plans to retained state; all instants come from the host. */
import { equalsJson } from '@jarenjs/core/object';
import { sealForecastRecord, validateForecastRecord, type ForecastTables } from './identity.ts';
import { forecastMust, reject } from './errors.ts';
import { planQuestionTransition, planCheckpointTransition, planHarnessTransition, visibleHarness } from './transitions.ts';
import { forecastCommandTransaction, type ForecastStore, type ForecastCommandTransaction } from './store.ts';
import type { ForecastCheckpoint, ForecastQuestion, ForecastHarnessVersion, ForecastResolution, ForecastPrediction, ForecastTrace, CheckpointNote, ForecastEvidence, Spend, CheckpointFailure } from './contracts.gen.ts';

async function questionFor(tx: ForecastCommandTransaction, id: string): Promise<ForecastQuestion> {
  const question = await tx.get('questions',id);
  if (!question) reject('TFCT1002', 'The referenced question is missing.', '/questionId');
  return question;
}
async function checkpointFor(tx: ForecastCommandTransaction, id: string) {
  const checkpoint = await tx.get('checkpoints',id);
  if (!checkpoint) reject('TFCT1002', 'The referenced checkpoint is missing.', '/checkpointId');
  const question = await questionFor(tx,checkpoint.questionId);
  const checkpoints = await tx.query('checkpoints',{ questionId: question.id, limit: 1000 });
  return { checkpoint, question, context: { ordinals: question.checkpointPolicy.ordinals, checkpoints } };
}
async function scheduleStatus(tx: ForecastCommandTransaction, checkpoint: ForecastCheckpoint, status: ForecastTables['schedules']['status']) {
  const schedules = await tx.query('schedules',{ questionId: checkpoint.questionId, limit: 1000 });
  const schedule = schedules.find(s => s.ordinal === checkpoint.ordinal);
  if (!schedule || schedule.scheduledAt !== checkpoint.scheduledAt || schedule.cutoffAt !== checkpoint.cutoffAt) reject('TFCT1002', 'The checkpoint differs from its registered schedule.');
  await tx.replace('schedules',schedule,{ ...schedule,status });
}
export function forecastQuestionCreate(store: ForecastStore, input: ForecastQuestion) {
  return forecastCommandTransaction(store,async tx => {
    const question = await validateForecastRecord('questions',input);
    if (question.status !== 'open' || question.latestProvisionalVersionId !== null) reject('TFCT1004', 'Create an open question without a provisional head.');
    const prior = await tx.get('questions',question.id);
    if (prior) return prior;
    await tx.put('questions',question);
    for (const [i,ordinal] of question.checkpointPolicy.ordinals.entries()) {
      const scheduledAt = question.checkpointPolicy.scheduledAt[i];
      await tx.put('schedules',await sealForecastRecord('schedules',{ questionId: question.id, ordinal, scheduledAt, cutoffAt: scheduledAt, status: 'due' }));
    }
    return question;
  });
}
export function forecastCheckpointPlan(store: ForecastStore, input: ForecastCheckpoint) {
  return forecastCommandTransaction(store,async tx => {
    const checkpoint = await validateForecastRecord('checkpoints',input);
    if (checkpoint.status !== 'planned') reject('TFCT1004', 'Plan a checkpoint before transitioning it.');
    const peers = await tx.query('checkpoints',{ questionId: checkpoint.questionId, limit: 1000 });
    const prior = peers.find(c => c.ordinal === checkpoint.ordinal);
    if (prior) {
      if (prior.id !== checkpoint.id) reject('TFCT1004', 'A checkpoint already owns this question and ordinal.');
      return prior;
    }
    const question = await questionFor(tx,checkpoint.questionId);
    if (question.status !== 'open') reject('TFCT1004', 'Only an open question can plan another checkpoint.');
    if (question.checkpointPolicy.scheduledAt[checkpoint.ordinal - 1] !== checkpoint.scheduledAt || checkpoint.cutoffAt < question.issuedAt) reject('TFCT1004', 'The checkpoint is outside the registered question schedule.');
    if (checkpoint.inputHarnessVersionId) {
      const harness = await tx.get('harnesses',checkpoint.inputHarnessVersionId);
      if (!harness || harness.digest !== checkpoint.inputHarnessDigest) reject('TFCT1002', 'The checkpoint harness or digest is missing.');
      forecastMust(visibleHarness(question,harness));
    }
    forecastMust(planCheckpointTransition(checkpoint,{ type: 'checkpoint.start', at: checkpoint.scheduledAt },{ ordinals: question.checkpointPolicy.ordinals, checkpoints: peers }));
    await tx.put('checkpoints',checkpoint);
    await scheduleStatus(tx,checkpoint,'due');
    return checkpoint;
  });
}
export function forecastCheckpointStart(store: ForecastStore, id: string, at: string) {
  return forecastCommandTransaction(store,async tx => {
    const { checkpoint, question, context } = await checkpointFor(tx,id);
    if (question.status !== 'open') reject('TFCT1004', 'Only an open question can start a checkpoint.');
    if (checkpoint.status === 'running' && checkpoint.startedAt === at) return checkpoint;
    const plan = forecastMust(planCheckpointTransition(checkpoint,{ type: 'checkpoint.start',at },context));
    await tx.replace('checkpoints',checkpoint,plan.after); await scheduleStatus(tx,checkpoint,'running'); return plan.after;
  });
}
export interface ForecastFinalization {
  checkpointId: string; at: string; prediction: ForecastPrediction; trace: ForecastTrace; note: CheckpointNote;
  evidence: ForecastEvidence[]; spend: Spend; stopReason: 'stop';
}
async function retainEvidence(tx: ForecastCommandTransaction, checkpoint: ForecastCheckpoint, evidence: ForecastEvidence[]) {
  if (new Set(evidence.map(e => e.id)).size !== evidence.length) reject('TFCT1001', 'Checkpoint evidence contains duplicate ids.');
  for (const e of evidence) {
    if (e.checkpointId !== checkpoint.id) reject('TFCT1003', 'The evidence belongs to another checkpoint.');
    if (e.kind === 'snapshot' && e.admitted && (!e.availableAt || e.availableAt > checkpoint.cutoffAt)) reject('TFCT1006', 'Admitted replay evidence is missing availability or exceeds the cutoff.');
    await tx.put('evidence',e);
  }
}
export function forecastCheckpointFinalize(store: ForecastStore, input: ForecastFinalization) {
  return forecastCommandTransaction(store,async tx => {
    const { checkpoint, question, context } = await checkpointFor(tx,input.checkpointId);
    const { prediction,trace,note } = input;
    if ([prediction,trace,note].some(r => r.checkpointId !== checkpoint.id)) reject('TFCT1003', 'Final artifacts cross checkpoint ownership.');
    if (prediction.adapterId !== question.adapter.id || prediction.adapterVersion !== question.adapter.version) reject('TFCT1002', 'The prediction differs from the question adapter.');
    if (note.traceId !== trace.id || ['configuration','promptRevision','toolsetRevision','noteSchemaRevision'].some(key => !equalsJson(note[key as keyof CheckpointNote],checkpoint[key as keyof ForecastCheckpoint]))) reject('TFCT1002', 'The note differs from the checkpoint producer identity or trace.');
    if (note.evidenceIds.some(id => !input.evidence.some(e => e.id === id && e.admitted))) reject('TFCT1006', 'A note cites evidence not admitted by this checkpoint.');
    const next: ForecastCheckpoint = { ...checkpoint, status: 'finalized', endedAt: input.at, traceId: trace.id, noteId: note.id, predictionId: prediction.id,
      evidenceIds: input.evidence.map(e => e.id), spend: input.spend, stopReason: input.stopReason, failure: null };
    if (checkpoint.status === 'finalized') {
      if (!equalsJson(checkpoint,next)) reject('TFCT1010', 'The checkpoint already has different finalization bytes.');
    } else forecastMust(planCheckpointTransition(checkpoint,{ type: 'checkpoint.finalize',at: input.at },context));
    await retainEvidence(tx,checkpoint,input.evidence);
    await tx.put('predictions',prediction); await tx.put('traces',trace); await tx.put('notes',note);
    await tx.replace('checkpoints',checkpoint,next); await scheduleStatus(tx,checkpoint,'complete'); return next;
  });
}
export interface ForecastCheckpointFailure {
  checkpointId: string; at: string; trace: ForecastTrace | null; evidence: ForecastEvidence[]; spend: Spend; stopReason: string; failure: CheckpointFailure;
}
export function forecastCheckpointFail(store: ForecastStore, input: ForecastCheckpointFailure) {
  return forecastCommandTransaction(store,async tx => {
    const { checkpoint,context } = await checkpointFor(tx,input.checkpointId);
    if (input.trace && input.trace.checkpointId !== checkpoint.id) reject('TFCT1003', 'The failure trace belongs to another checkpoint.');
    const next: ForecastCheckpoint = { ...checkpoint, status: 'failed', endedAt: input.at, traceId: input.trace?.id ?? null, evidenceIds: input.evidence.map(e => e.id), spend: input.spend, stopReason: input.stopReason, failure: input.failure };
    if (checkpoint.status === 'failed') {
      if (!equalsJson(checkpoint,next)) reject('TFCT1010', 'The checkpoint already has different failure bytes.');
    } else forecastMust(planCheckpointTransition(checkpoint,{ type: 'checkpoint.fail',at: input.at },context));
    await retainEvidence(tx,checkpoint,input.evidence); if (input.trace) await tx.put('traces',input.trace);
    await tx.replace('checkpoints',checkpoint,next); await scheduleStatus(tx,checkpoint,'complete'); return next;
  });
}
export function forecastHarnessStage(store: ForecastStore, input: ForecastHarnessVersion) {
  return forecastCommandTransaction(store,async tx => {
    const version = await validateForecastRecord('harnesses',input);
    if (version.status !== 'staged') reject('TFCT1004', 'Stage a harness before transitioning it.');
    const prior = await tx.get('harnesses',version.id); if (prior) return prior;
    if (version.questionId) {
      const question = await questionFor(tx,version.questionId);
      if (question.status !== 'open' || question.scopeKey !== version.scopeKey) reject('TFCT1003', 'A staged harness requires its open question and scope.');
    }
    if (version.parentVersionId) {
      const parent = await tx.get('harnesses',version.parentVersionId);
      if (!parent || parent.scopeKey !== version.scopeKey || parent.questionId !== version.questionId && !parent.provenance.seed && parent.status !== 'checked-ref') reject('TFCT1003', 'The harness parent belongs to another question or scope.');
    }
    await tx.put('harnesses',version); return version;
  });
}
export function forecastHarnessProvisional(store: ForecastStore, id: string) {
  return forecastCommandTransaction(store,async tx => {
    const version = await tx.get('harnesses',id);
    if (!version || !version.questionId) reject('TFCT1003', 'A provisional harness requires a retained question owner.');
    const question = await questionFor(tx,version.questionId);
    if (version.scopeKey !== question.scopeKey || question.status !== 'open') reject('TFCT1003', 'The provisional harness requires its open question and scope.');
    if (version.status === 'provisional' && question.latestProvisionalVersionId === id) return version;
    if (question.latestProvisionalVersionId && version.parentVersionId !== question.latestProvisionalVersionId) reject('TFCT1004', 'The provisional harness parent is stale.');
    const plan = forecastMust(planHarnessTransition(version,{ type: 'harness.provisional' }));
    await tx.replace('harnesses',version,plan.after);
    await tx.replace('questions',question,{ ...question,latestProvisionalVersionId: id }); return plan.after;
  });
}
export function forecastHarnessArchive(store: ForecastStore, id: string) {
  return forecastCommandTransaction(store,async tx => {
    const version = await tx.get('harnesses',id);
    if (!version || !version.questionId) reject('TFCT1003', 'Only a question-owned harness can be archived.');
    const question = await questionFor(tx,version.questionId), resolutions = await tx.query('resolutions',{ questionId: question.id,limit: 1 });
    if (question.status !== 'resolved' || !resolutions.length) reject('TFCT1004', 'A harness is archived only after its question resolution.');
    if (version.status === 'archived') return version;
    const plan = forecastMust(planHarnessTransition(version,{ type: 'resolution.archive' }));
    await tx.replace('harnesses',version,plan.after);
    if (question.latestProvisionalVersionId === id) await tx.replace('questions',question,{ ...question,latestProvisionalVersionId: null });
    return plan.after;
  });
}
export function forecastHarnessReject(store: ForecastStore, id: string) {
  return forecastCommandTransaction(store,async tx => {
    const version = await tx.get('harnesses',id);
    if (!version) reject('TFCT1002', 'The harness version is missing.');
    if (version.status === 'rejected') return version;
    const plan = forecastMust(planHarnessTransition(version,{ type: 'harness.reject' }));
    await tx.replace('harnesses',version,plan.after); return plan.after;
  });
}
export function forecastResolutionRecord(store: ForecastStore, input: ForecastResolution) {
  return forecastCommandTransaction(store,async tx => {
    const resolution = await validateForecastRecord('resolutions',input), question = await questionFor(tx,resolution.questionId);
    const earlier = (await tx.query('resolutions',{ questionId: question.id,limit: 1 }))[0];
    const plan = forecastMust(planQuestionTransition(question,{ type: 'resolution.record',resolution,...(earlier ? { earlier } : {}) }));
    if (earlier) {
      if (!equalsJson(earlier,resolution)) reject('TFCT1004', 'Resolution differs from earlier record ' + earlier.id + '.');
      return earlier;
    }
    await tx.put('resolutions',resolution); await tx.replace('questions',question,plan.after); return resolution;
  });
}
