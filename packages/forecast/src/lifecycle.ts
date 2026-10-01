/** Resolution admission shares MAS storage, task recovery and the host's segment queue. */
import { JarenValidator } from '@jarenjs/validate';
import { equalsJson } from '@jarenjs/core/object';
import { createMasRegistrySnapshot, createMasConfigCatalog, validateMasWorkflow, planMasWorkflow, compileMasRuntime, MasInfrastructureCrash, type MasStore, type MasTaskInput, type MasTaskHandlerBinding } from '@tangleai/mas';
import { defineForecastLifecycleWorkflow, FORECAST_LIFECYCLE_HANDLERS, FORECAST_LIFECYCLE_REQUEST } from './workflow.ts';
import { forecastResolutionBegin, forecastPredictionsScore, type ForecastResolutionInput } from './outcome-commands.ts';
import { createRetrospectiveEditor, forecastRetrospectiveRecord, forecastPromoteOrRetain } from './retrospective.ts';
import { forecastGet, forecastQuery } from './store.ts';
import { forecastRevision } from './identity.ts';
import { forecastMust, failure, reject, type ForecastCommandResult } from './errors.ts';
import type { ForecastOutcomeHost } from './outcome-host.ts';
import type { ForecastSegments } from './host.ts';
import type { ForecastChatClient } from './meter.ts';
import type { CheckpointBudget } from './contracts.gen.ts';
export interface ForecastLifecycleRequest { resolution: ForecastResolutionInput;budget: CheckpointBudget; }
export interface ForecastLifecycleOptions {
  outcomeHost: ForecastOutcomeHost;masStore: MasStore;segments: ForecastSegments;profile: string;
  retrospectiveEditor: (request: ForecastLifecycleRequest) => { client: ForecastChatClient };
  now: () => string;clock: () => number;
  afterStage?: (stage: typeof FORECAST_LIFECYCLE_HANDLERS[number],recordId: string) => void | Promise<void>;
}
const valid = <T>(result: { valid: true;value: T } | { valid: false;issues: unknown }): T => { if (!result.valid) throw new TypeError(JSON.stringify(result.issues)); return result.value; };
export const forecastLifecycleRunId = (resolution: ForecastResolutionInput) => forecastRevision({ questionId: resolution.questionId,receivedAt: resolution.receivedAt,operation: 'resolution' });
export async function prepareForecastLifecycleWorkflow(profile: string) {
  const snapshot = valid(await createMasRegistrySnapshot({ $masRegistry: '0.1',registryId: 'forecast-resolution-v1',roles: [],handlers: FORECAST_LIFECYCLE_HANDLERS.map(id => ({ id,title: id,effect: 'effectful' as const,idempotency: 'honored' as const })),tools: [],messageAdapters: [{ id: 'json-schema',version: '0.1' }],contextAdapters: [],templates: [],subgraphs: [] }));
  const catalog = valid(await createMasConfigCatalog({ profiles: [profile],tools: [],contexts: [] })), workflow = await defineForecastLifecycleWorkflow({ profile,registryRevision: snapshot.revision,configRegistryRevision: catalog.revision });
  const validated = valid(await validateMasWorkflow(workflow,snapshot,catalog)), plan = valid(await planMasWorkflow(validated));
  return { snapshot,catalog,workflow,validated,plan };
}
export function createForecastLifecycleHandlers(options: ForecastLifecycleOptions & { executableRevision: string }): Record<string,MasTaskHandlerBinding> {
  const { outcomeHost: host } = options, check = new JarenValidator({ collectErrors: true }).compile(FORECAST_LIFECYCLE_REQUEST);
  async function context(input: MasTaskInput) {
    if (!check(input.value.request).valid) reject('TFCT1001','Invalid forecast lifecycle request.');
    const request = input.value.request as unknown as ForecastLifecycleRequest, runId = await forecastLifecycleRunId(request.resolution), run = await options.masStore.getRun(runId);
    if (!run || run.executableRevision !== options.executableRevision || !equalsJson(run.input,{ request }) || !input.idempotencyKey.startsWith(runId + '/')) reject('TFCT1002','The lifecycle task differs from its retained MAS request.');
    await host.question(request.resolution.questionId); return { request,runId };
  }
  async function after(stage: typeof FORECAST_LIFECYCLE_HANDLERS[number],id: string) {
    try { await options.afterStage?.(stage,id); } catch (error) { throw error instanceof MasInfrastructureCrash ? error : new MasInfrastructureCrash(error instanceof Error ? error.message : 'Stopped after forecast lifecycle publication.'); }
  }
  return {
    'resolution-record': async input => { const { request } = await context(input), saved = forecastMust(await forecastResolutionBegin(host,request.resolution)); await after('resolution-record',saved.id); return { request,resolution: saved.id }; },
    'predictions-score': async input => {
      const { request } = await context(input), resolution = forecastMust(await forecastGet(host.store,'resolutions',String(input.value.resolution)));
      if (!resolution || resolution.questionId !== request.resolution.questionId) reject('TFCT1003','The scoring task crosses its resolution owner.');
      const saved = forecastMust(await forecastPredictionsScore(host,resolution.id)); await after('predictions-score',saved.id); return { request,resolution: saved.id };
    },
    'retrospective-run': async input => {
      const { request,runId } = await context(input), resolution = forecastMust(await forecastGet(host.store,'resolutions',String(input.value.resolution)));
      if (!resolution || resolution.questionId !== request.resolution.questionId) reject('TFCT1003','The retrospective task crosses its resolution owner.');
      const prior = forecastMust(await forecastQuery(host.store,'retrospectives',{ questionId: resolution.questionId }))[0];
      if (prior) { if (prior.resolutionId !== resolution.id) reject('TFCT1010','The retained retrospective belongs to another resolution.'); return { request,retrospective: prior.id }; }
      const trace = await options.masStore.readTrace(runId);
      if (input.signal.aborted || trace?.run.status !== 'running' || !trace.attempts.some(a => a.status === 'running' && a.idempotencyKey === input.idempotencyKey && a.invocationId === input.node)) reject('TFCT1004','A retrospective purchase requires its active MAS attempt.');
      const record = await createRetrospectiveEditor({ host,...options.retrospectiveEditor(request),now: options.now,clock: options.clock }).run(resolution.id,request.budget,input.signal), saved = forecastMust(await forecastRetrospectiveRecord(host,record));
      await after('retrospective-run',saved.id); return { request,retrospective: saved.id };
    },
    'harness-promote-or-retain': async input => {
      const { request } = await context(input), record = forecastMust(await forecastGet(host.store,'retrospectives',String(input.value.retrospective)));
      if (!record || record.questionId !== request.resolution.questionId) reject('TFCT1003','The promotion task crosses its retrospective owner.');
      const saved = forecastMust(await forecastPromoteOrRetain(host,record.id)); await after('harness-promote-or-retain',saved.id); return { completed: { resolutionId: saved.resolutionId,retrospectiveId: saved.id,outcome: saved.outcome } };
    },
  };
}
export async function createForecastLifecycleHost(options: ForecastLifecycleOptions) {
  const prepared = await prepareForecastLifecycleWorkflow(options.profile), { workflow,snapshot,catalog,validated,plan } = prepared;
  const runtime = valid(compileMasRuntime(validated,plan,snapshot,{ store: options.masStore,taskHandlers: createForecastLifecycleHandlers({ ...options,executableRevision: plan.executableRevision }),toolBindings: {},contextProviders: {},now: options.now,clock: options.clock }));
  const saved = await options.masStore.putWorkflowVersion(workflow); if (!saved.ok) throw new TypeError(JSON.stringify(saved.issue));
  const registered = await options.masStore.putRegistrySnapshot(snapshot.document as unknown as Record<string,unknown>,snapshot.revision); if (!registered.ok) throw new TypeError(JSON.stringify(registered.issue));
  const check = new JarenValidator({ collectErrors: true }).compile(FORECAST_LIFECYCLE_REQUEST);
  async function deliver(request: ForecastLifecycleRequest): Promise<ForecastCommandResult<{ runId: string;duplicate: boolean }>> {
    try {
      if (!check(request).valid) reject('TFCT1001','Invalid forecast lifecycle request.');
      await options.outcomeHost.question(request.resolution.questionId);
      if (request.resolution.receivedAt > options.now()) reject('TFCT1004','The resolution is not yet received.');
      const runId = await forecastLifecycleRunId(request.resolution), input = { request }, previous = await options.masStore.getRun(runId);
      if (previous && (previous.executableRevision !== plan.executableRevision || !equalsJson(previous.input,input))) reject('TFCT1010','Different resolution bytes own this lifecycle run.');
      const created = await options.masStore.createRun({ runId,workflowId: workflow.workflowId,workflowVersionId: workflow.versionId,registryRevision: snapshot.revision,executableRevision: plan.executableRevision,configRegistryRevision: catalog.revision,profile: options.profile,input,limits: { ...workflow.limits } });
      if (!created.ok && created.issue.code !== 'TMAS2001') reject('TFCT1012',created.issue.detail);
      const run = created.ok ? created.value : await options.masStore.getRun(runId);
      if (!run || !equalsJson(run.input,input)) reject('TFCT1010','Concurrent lifecycle admission differs.');
      if (['queued','running'].includes(run.status)) await options.segments.enqueue(run);
      return { ok: true,value: { runId,duplicate: !created.ok },writes: created.ok ? 1 : 0 };
    } catch (error) { return failure(error); }
  }
  return { ...prepared,runtime,deliver,async drain() { await options.segments.reconcile(); await options.segments.drain(runtime); },resume: () => options.segments.reconcile() };
}
