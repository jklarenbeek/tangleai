/** Pure lifecycle policy. Plans confer no persistence or checked-head authority. */
import { cloneJson, equalsJson } from '@jarenjs/core/object';
import type { ActivationEvent } from '@tangleai/outcomes';
import { checkShape, checkTime } from './schema.ts';
import { ForecastRefusal, failure, forecastMust, refuse, reject, type ForecastCommandResult } from './errors.ts';
import type { ForecastQuestion, ForecastCheckpoint, ForecastSchedule, ForecastHarnessVersion, ForecastResolution } from './contracts.gen.ts';

export interface ForecastTransition<T> { before: T; after: T; }
function pure<T>(task: () => T): ForecastCommandResult<T> {
  try { return { ok: true, value: task(), writes: 0 }; }
  catch (error) { return error instanceof ForecastRefusal ? failure(error) : refuse('TFCT1001', 'Invalid forecast transition input.'); }
}
export function applyForecastTransition<T>(current: T, plan: ForecastTransition<T>): ForecastCommandResult<T> {
  return pure(() => {
    if (!equalsJson(current, plan.before)) reject('TFCT1004', 'The lifecycle record changed after planning.');
    return cloneJson(plan.after);
  });
}
export type QuestionCommand = { type: 'resolution.record' | 'resolution.correct'; resolution: ForecastResolution; earlier?: ForecastResolution };
export function planQuestionTransition(input: ForecastQuestion, command: QuestionCommand): ForecastCommandResult<ForecastTransition<ForecastQuestion>> {
  return pure(() => {
    const question = checkShape<ForecastQuestion>('forecastQuestion', input);
    const resolution = checkShape<ForecastResolution>('forecastResolution', command.resolution);
    if (resolution.questionId !== question.id) reject('TFCT1003', 'The resolution belongs to another question.');
    if (command.earlier) {
      const earlier = checkShape<ForecastResolution>('forecastResolution', command.earlier);
      if (earlier.questionId !== question.id) reject('TFCT1003', 'The earlier resolution belongs to another question.');
      if (!equalsJson(earlier.outcome, resolution.outcome)) reject('TFCT1004', 'Resolution conflicts with earlier record ' + earlier.id + '.', '/outcome');
      if (equalsJson(earlier, resolution) && question.status === 'resolved' && command.type === 'resolution.record') return { before: question, after: question };
    }
    if (question.status !== 'open' || !['resolution.record','resolution.correct'].includes(command.type)) reject('TFCT1004', 'The question cannot take this resolution transition.');
    return { before: question, after: { ...question, status: command.type === 'resolution.record' ? 'resolved' as const : 'disputed' as const } };
  });
}
export type CheckpointCommand = { type: 'checkpoint.start'; at: string } | { type: 'checkpoint.finalize' | 'checkpoint.fail'; at: string };
export interface CheckpointContext { ordinals: readonly number[]; checkpoints: readonly ForecastCheckpoint[]; }
export function planCheckpointTransition(input: ForecastCheckpoint, command: CheckpointCommand, context: CheckpointContext): ForecastCommandResult<ForecastTransition<ForecastCheckpoint>> {
  return pure(() => {
    const checkpoint = checkShape<ForecastCheckpoint>('forecastCheckpoint', input);
    checkTime(command.at);
    const peers = context.checkpoints.filter(c => c.questionId === checkpoint.questionId);
    if (peers.filter(c => c.ordinal === checkpoint.ordinal).length > 1 || peers.some(c => c.ordinal === checkpoint.ordinal && c.id !== checkpoint.id))
      reject('TFCT1004', 'A checkpoint already owns this question and ordinal.');
    const next = context.ordinals.find(ordinal => !peers.some(c => c.ordinal === ordinal && ['finalized','failed'].includes(c.status)));
    if (next !== checkpoint.ordinal) reject('TFCT1004', 'The checkpoint is not the next unfinished ordinal.');
    let after: ForecastCheckpoint;
    if (command.type === 'checkpoint.start' && checkpoint.status === 'planned') {
      if (command.at < checkpoint.scheduledAt) reject('TFCT1004', 'The checkpoint cannot start before its scheduled instant.');
      after = { ...checkpoint, status: 'running', startedAt: command.at };
    } else if (checkpoint.status === 'running' && ['checkpoint.finalize','checkpoint.fail'].includes(command.type)) {
      if (!checkpoint.startedAt || command.at < checkpoint.startedAt) reject('TFCT1004', 'The checkpoint cannot finish before its start instant.');
      after = { ...checkpoint, status: command.type === 'checkpoint.finalize' ? 'finalized' : 'failed', endedAt: command.at };
    } else reject('TFCT1004', 'The checkpoint cannot take this lifecycle transition.');
    return { before: checkpoint, after };
  });
}
export type HarnessCommand = { type: 'harness.provisional' | 'harness.reject' | 'resolution.archive' } | { type: 'retrospective.promote'; activationEvent: ActivationEvent | null };
export function planHarnessTransition(input: ForecastHarnessVersion, command: HarnessCommand): ForecastCommandResult<ForecastTransition<ForecastHarnessVersion>> {
  return pure(() => {
    const version = checkShape<ForecastHarnessVersion>('forecastHarnessVersion', input);
    let after: ForecastHarnessVersion;
    if (version.status === 'staged' && ['harness.provisional','harness.reject'].includes(command.type)) {
      if (command.type === 'harness.provisional' && !version.questionId) reject('TFCT1003', 'A provisional harness requires a question owner.');
      after = { ...version, status: command.type === 'harness.provisional' ? 'provisional' : 'rejected' };
    } else if (version.status === 'provisional' && command.type === 'resolution.archive') after = { ...version, status: 'archived' };
    else if (command.type === 'retrospective.promote') {
      const event = command.activationEvent;
      if (!event || event.kind !== 'activationEvent' || event.action !== 'promote' || !/^[a-f0-9]{64}$/.test(event.id) || !/^[a-f0-9]{64}$/.test(event.versionId) || event.nextHead.versionId !== event.versionId || event.nextHead.revision !== event.previousHead.revision + 1 || !['staged','provisional','archived'].includes(version.status))
        reject('TFCT1004', 'A checked reference requires an outcome promotion activation event.');
      after = { ...version, status: 'checked-ref', checkedVersionId: event.versionId };
    } else reject('TFCT1004', 'The harness cannot take this lifecycle transition.');
    return { before: version, after };
  });
}
/** A clock-free host query; equality at the boundary is due. */
export function dueCheckpoints(schedules: readonly ForecastSchedule[], now: string): ForecastCommandResult<ForecastSchedule[]> {
  return pure(() => {
    checkTime(now);
    const rows = schedules.map(s => checkShape<ForecastSchedule>('forecastSchedule', s));
    return rows.filter(s => s.status === 'due' && s.scheduledAt <= now).sort((a,b) => a.scheduledAt.localeCompare(b.scheduledAt) || a.questionId.localeCompare(b.questionId) || a.ordinal - b.ordinal);
  });
}
export function visibleHarness(input: ForecastQuestion, candidate: ForecastHarnessVersion): ForecastCommandResult<ForecastHarnessVersion> {
  return pure(() => {
    const question = checkShape<ForecastQuestion>('forecastQuestion', input), version = checkShape<ForecastHarnessVersion>('forecastHarnessVersion', candidate);
    if (version.scopeKey !== question.scopeKey) reject('TFCT1003', 'The harness belongs to another scope.');
    if (['staged','provisional'].includes(version.status) && version.questionId !== question.id && !(version.questionId === null && version.provenance.seed))
      reject('TFCT1003', 'The provisional harness belongs to another question.');
    if (['rejected','archived'].includes(version.status)) reject('TFCT1004', 'The harness is not visible for checkpoint execution.');
    if (version.status === 'checked-ref' && !version.checkedVersionId) reject('TFCT1004', 'The checked reference has no outcome version.');
    return version;
  });
}
export function applyQuestionTransition(question: ForecastQuestion, command: QuestionCommand) { return pure(() => forecastMust(applyForecastTransition(question, forecastMust(planQuestionTransition(question, command))))); }
export function applyCheckpointTransition(checkpoint: ForecastCheckpoint, command: CheckpointCommand, context: CheckpointContext) { return pure(() => forecastMust(applyForecastTransition(checkpoint, forecastMust(planCheckpointTransition(checkpoint, command, context))))); }
export function applyHarnessTransition(version: ForecastHarnessVersion, command: HarnessCommand) { return pure(() => forecastMust(applyForecastTransition(version, forecastMust(planHarnessTransition(version, command))))); }
