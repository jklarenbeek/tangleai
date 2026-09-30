/** MAS handlers publish a stage receipt before returning its small reference output. */
import { equalsJson } from '@jarenjs/core/object';
import { MasInfrastructureCrash, type MasStore, type MasTaskInput, type MasTaskHandlerBinding } from '@tangleai/mas';
import { checkShape } from './schema.ts';
import { forecastGet, type ForecastStore } from './store.ts';
import { forecastMust, reject } from './errors.ts';
import { forecastRevision } from './identity.ts';
import { planCheckpointTransition } from './transitions.ts';
import { forecastQuery } from './store.ts';
import { forecastCheckpointStart, forecastCheckpointFinalize, forecastCheckpointFail } from './commands.ts';
import { forecastCheckpointRecordExecution, forecastCheckpointRecordNote } from './stages.ts';
import { createForecastExecutor } from './executor.ts';
import { createForecastToolbox, type ForecastToolboxOptions } from './toolbox.ts';
import { createNoteBuilder } from './note.ts';
import type { ForecastChatClient } from './meter.ts';
import type { ForecastQuestion, ForecastCheckpoint, ForecastHarnessVersion, ForecastWorkflowRequest } from './contracts.gen.ts';

export interface ForecastHandlerContext { question: ForecastQuestion; checkpoint: ForecastCheckpoint; harness: ForecastHarnessVersion | null; request: ForecastWorkflowRequest; signal: AbortSignal; }
export interface ForecastHandlerOptions {
  forecastStore: ForecastStore; masStore: MasStore; executableRevision: string;
  executor: (context: ForecastHandlerContext) => Pick<ForecastToolboxOptions,'cutoffPolicy'|'search'|'fetcher'|'extract'> & { client: ForecastChatClient };
  noteBuilder: (context: ForecastHandlerContext) => { client: ForecastChatClient };
  now: () => string; clock: () => number;
  afterStage?: (stage: 'checkpoint-run' | 'note-create' | 'checkpoint-complete', checkpoint: ForecastCheckpoint) => void | Promise<void>;
}
export const forecastRunId = (questionId: string,scheduledAt: string) => forecastRevision({ questionId,scheduledAt });
export function createForecastHandlers(options: ForecastHandlerOptions): Record<string,MasTaskHandlerBinding> {
  const store = options.forecastStore;
  async function context(input: MasTaskInput): Promise<ForecastHandlerContext> {
    const request = checkShape<ForecastWorkflowRequest>('forecastWorkflowRequest',input.value.request);
    const checkpoint = forecastMust(await forecastGet(store,'checkpoints',request.checkpointId));
    if (!checkpoint) reject('TFCT1002','The MAS checkpoint input is missing.');
    if (['questionId','ordinal','scheduledAt','cutoffAt','treatment'].some(key => checkpoint[key as keyof ForecastCheckpoint] !== request[key as keyof ForecastWorkflowRequest])) reject('TFCT1003','MAS input crosses the retained checkpoint identity.');
    const question = forecastMust(await forecastGet(store,'questions',checkpoint.questionId));
    if (!question) reject('TFCT1002','The MAS question input is missing.');
    const runId = await forecastRunId(question.id,checkpoint.scheduledAt), run = await options.masStore.getRun(runId);
    if (!input.idempotencyKey.startsWith(runId + '/') || !run || run.executableRevision !== options.executableRevision || !equalsJson(run.input,{ request })) reject('TFCT1002','The task differs from its retained MAS run and semantic key.');
    const harness = checkpoint.inputHarnessVersionId ? forecastMust(await forecastGet(store,'harnesses',checkpoint.inputHarnessVersionId)) : null;
    return { question,checkpoint,harness,request,signal: input.signal };
  }
  async function beforePurchase(input: MasTaskInput, value: ForecastHandlerContext) {
    const runId = await forecastRunId(value.question.id,value.checkpoint.scheduledAt), trace = await options.masStore.readTrace(runId);
    if (input.signal.aborted) reject('TFCT1005','The MAS task signal is aborted.');
    if (trace?.run.status !== 'running' || !trace.attempts.some(a => a.status === 'running' && a.idempotencyKey === input.idempotencyKey && a.invocationId === input.node)) reject('TFCT1004','A forecast purchase requires its active MAS attempt.');
  }
  async function afterStage(stage: Parameters<NonNullable<ForecastHandlerOptions['afterStage']>>[0], checkpoint: ForecastCheckpoint) {
    try { await options.afterStage?.(stage,checkpoint); }
    catch (error) { throw error instanceof MasInfrastructureCrash ? error : new MasInfrastructureCrash(error instanceof Error ? error.message : 'Host stopped after durable forecast publication.'); }
  }
  const completed = async (value: ForecastHandlerContext, revision: unknown) => {
    const c = forecastMust(await forecastGet(store,'checkpoints',value.checkpoint.id))!;
    return { completed: { checkpointId: c.id,status: c.status,traceId: c.traceId,noteId: c.noteId,predictionId: c.predictionId,revision } };
  };
  return {
    'checkpoint-plan': async input => {
      const value = await context(input), { checkpoint,question,request } = value;
      if (checkpoint.status === 'planned') forecastMust(planCheckpointTransition(checkpoint,{ type: 'checkpoint.start',at: options.now() },{ ordinals: question.checkpointPolicy.ordinals,checkpoints: forecastMust(await forecastQuery(store,'checkpoints',{ questionId: question.id })) }));
      return { request };
    },
    'checkpoint-run': async input => {
      const value = await context(input);
      if (value.checkpoint.traceId && (value.checkpoint.predictionId || value.checkpoint.failure)) return { request: value.request };
      await beforePurchase(input,value);
      if (value.checkpoint.status === 'planned') value.checkpoint = forecastMust(await forecastCheckpointStart(store,value.checkpoint.id,options.now()));
      const injected = options.executor(value), toolbox = await createForecastToolbox({ ...injected,store,checkpoint: value.checkpoint,harness: value.harness,now: options.now,signal: input.signal });
      const execution = await createForecastExecutor({ client: injected.client,toolbox,harness: value.harness,budget: value.request.budget,now: options.clock }).run({ question: value.question,checkpoint: value.checkpoint,signal: input.signal });
      const checkpoint = forecastMust(await forecastCheckpointRecordExecution(store,execution));
      await afterStage('checkpoint-run',checkpoint); return { request: value.request };
    },
    'note-create': async input => {
      const value = await context(input), { checkpoint,request } = value;
      if (checkpoint.failure || checkpoint.noteId || checkpoint.noteFailure || checkpoint.progress?.note) return { request };
      await beforePurchase(input,value);
      if (!checkpoint.progress || !checkpoint.traceId || !checkpoint.predictionId) reject('TFCT1004','The note requires a durable execution receipt.');
      const trace = forecastMust(await forecastGet(store,'traces',checkpoint.traceId))!, prediction = forecastMust(await forecastGet(store,'predictions',checkpoint.predictionId))!;
      const evidence = await Promise.all(checkpoint.evidenceIds.map(async id => forecastMust(await forecastGet(store,'evidence',id))!));
      const result = await createNoteBuilder({ ...options.noteBuilder(value),now: options.clock }).build({ question: value.question,checkpoint,trace,evidence,finalMessage: { role: 'assistant',content: prediction.raw },stopReason: 'stop' },{ ...request.budget,spent: checkpoint.progress.execution.budgetSpent },input.signal);
      const saved = forecastMust(await forecastCheckpointRecordNote(store,checkpoint.id,result));
      await afterStage('note-create',saved); return { request };
    },
    'revision-run': async input => { const value = await context(input); return { revision: { checkpointId: value.checkpoint.id,status: 'skipped',reason: value.checkpoint.failure ? 'execution-failed' : 'not-implemented',revisionId: null } }; },
    'revision-skip': async input => { const value = await context(input); return { revision: { checkpointId: value.checkpoint.id,status: 'skipped',reason: value.request.ordinal === 1 ? 'first-checkpoint' : 'disabled',revisionId: null } }; },
    'checkpoint-complete': async input => {
      const value = await context(input), { checkpoint } = value;
      if (['finalized','failed'].includes(checkpoint.status)) return completed(value,input.value.revision);
      if (!checkpoint.traceId || !checkpoint.progress) reject('TFCT1004','Complete only a checkpoint with a durable execution receipt.');
      const trace = forecastMust(await forecastGet(store,'traces',checkpoint.traceId))!, evidence = await Promise.all(checkpoint.evidenceIds.map(async id => forecastMust(await forecastGet(store,'evidence',id))!));
      const common = { checkpointId: checkpoint.id,at: options.now(),trace,evidence,spend: checkpoint.spend };
      const final = checkpoint.failure ? forecastMust(await forecastCheckpointFail(store,{ ...common,stopReason: checkpoint.stopReason!,failure: checkpoint.failure })) : forecastMust(await forecastCheckpointFinalize(store,{ ...common,prediction: forecastMust(await forecastGet(store,'predictions',checkpoint.predictionId!))!,note: checkpoint.noteId ? forecastMust(await forecastGet(store,'notes',checkpoint.noteId)) : null,noteFailure: checkpoint.noteFailure,stopReason: 'stop' }));
      await afterStage('checkpoint-complete',final); return completed(value,input.value.revision);
    },
  };
}
