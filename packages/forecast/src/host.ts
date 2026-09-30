/** Manual admission over the existing MAS runtime and an injected queue adapter. */
import { cloneJson, equalsJson } from '@jarenjs/core/object';
import { createMasRegistrySnapshot, createMasConfigCatalog, validateMasWorkflow, planMasWorkflow, compileMasRuntime, type MasRuntime, type MasRun, type MasIssue, type MasHostBindings } from '@tangleai/mas';
import { defineForecastWorkflow, FORECAST_HANDLER_POLICY } from './workflow.ts';
import { createForecastHandlers, forecastRunId, type ForecastHandlerOptions } from './handlers.ts';
import { forecastGet, forecastQuery, type ForecastStore, type ForecastQuery } from './store.ts';
import { type ForecastTables, type ForecastTable, sealForecastRecord } from './identity.ts';
import { forecastCheckpointPlan } from './commands.ts';
import { forecastPromptRevisions } from './prompts.ts';
import { forecastExecutorToolset } from './toolbox.ts';
import { selectForecastHarness } from './selection.ts';
import { dueCheckpoints } from './transitions.ts';
import { checkShape, checkTime } from './schema.ts';
import { forecastMust, ForecastRefusal, reject, issue } from './errors.ts';
import type { ForecastQuestion, ForecastCheckpoint, ForecastWorkflowRequest, ForecastIssue, Configuration, CheckpointBudget } from './contracts.gen.ts';

function checked<T>(result: { valid: true; value: T } | { valid: false; issues: unknown }): T {
  if (!result.valid) throw new TypeError(JSON.stringify(result.issues));
  return result.value;
}
export async function prepareForecastWorkflow(profile: string) {
  const snapshot = checked(await createMasRegistrySnapshot({ $masRegistry: '0.1',registryId: 'forecast-checkpoint-v1',roles: [],handlers: FORECAST_HANDLER_POLICY.map(h => ({ ...h,title: h.id,idempotency: h.effect === 'effectful' ? 'honored' as const : 'not-required' as const })),tools: [],messageAdapters: [{ id: 'json-schema',version: '0.1' }],contextAdapters: [],templates: [],subgraphs: [] }));
  const catalog = checked(await createMasConfigCatalog({ profiles: [profile],tools: [],contexts: [] }));
  const workflow = await defineForecastWorkflow({ registryRevision: snapshot.revision,configRegistryRevision: catalog.revision,profile });
  const validated = checked(await validateMasWorkflow(workflow,snapshot,catalog)), plan = checked(await planMasWorkflow(validated));
  return { workflow,snapshot,catalog,validated,plan };
}
export interface ForecastSegments {
  enqueue(run: MasRun): Promise<unknown>;
  reconcile(): Promise<unknown>;
  /** One bounded pass over admitted jobs, delegated to the host's MAS worker. */
  drain(runtime: MasRuntime): Promise<void>;
}
export interface ForecastHostPolicy {
  treatment: ForecastCheckpoint['treatment']; configuration: Configuration; budget: CheckpointBudget; revise: boolean;
}
export interface ForecastHostOptions extends Omit<ForecastHandlerOptions,'executableRevision'> {
  profile: string; policy: (question: ForecastQuestion) => ForecastHostPolicy;
  segments: ForecastSegments; observer?: MasHostBindings['observer'];
}
export type ForecastDelivery =
  | { kind: 'started'; runId: string; checkpointId: string }
  | { kind: 'duplicate'; runId: string; checkpointId: string; cause: MasIssue }
  | { kind: 'refused'; runId: string | null; issues: ForecastIssue[]; cause: string | null };
export interface ForecastTick {
  now: string; due: number; started: number; duplicateDeliveries: number;
  deliveries: ForecastDelivery[]; refused: Extract<ForecastDelivery,{ kind: 'refused' }>[];
  failed: { runId: string; failure: MasRun['failure'] }[];
}
async function all<K extends ForecastTable>(store: ForecastStore, table: K, query: ForecastQuery = {}) {
  const rows: ForecastTables[K][] = []; let after: string | undefined;
  for (;;) {
    const page = forecastMust(await forecastQuery(store,table,{ ...query,limit: 1000,...(after ? { after } : {}) }));
    rows.push(...page); if (page.length < 1000) return rows; after = page.at(-1)!.id;
  }
}
export async function createForecastHost(options: ForecastHostOptions) {
  const prepared = await prepareForecastWorkflow(options.profile), { workflow,snapshot,catalog,validated,plan } = prepared;
  const handlers = createForecastHandlers({ ...options,executableRevision: plan.executableRevision });
  const runtime = checked(compileMasRuntime(validated,plan,snapshot,{ store: options.masStore,taskHandlers: handlers,toolBindings: {},contextProviders: {},now: options.now,clock: options.clock,observer: options.observer }));
  const saved = await options.masStore.putWorkflowVersion(workflow); if (!saved.ok) throw new TypeError(JSON.stringify(saved.issue));
  const registered = await options.masStore.putRegistrySnapshot(snapshot.document as unknown as Record<string,unknown>,snapshot.revision); if (!registered.ok) throw new TypeError(JSON.stringify(registered.issue));

  async function deliver(questionId: string, ordinal: number): Promise<ForecastDelivery> {
    let runId: string | null = null;
    try {
      const question = forecastMust(await forecastGet(options.forecastStore,'questions',questionId));
      if (!question) reject('TFCT1002','The scheduled forecast question is missing.');
      const schedule = (await all(options.forecastStore,'schedules',{ questionId })).find(s => s.ordinal === ordinal);
      if (!schedule) reject('TFCT1004','The ordinal has no registered schedule.');
      checkTime(options.now());
      if (schedule.scheduledAt > options.now()) reject('TFCT1004','The checkpoint is not due.');
      runId = await forecastRunId(questionId,schedule.scheduledAt);
      const existing = await options.masStore.getRun(runId), policy = cloneJson(options.policy(question));
      checkShape('checkpointBudget',policy.budget); checkShape('configuration',policy.configuration);
      const prompts = await forecastPromptRevisions(), toolset = await forecastExecutorToolset(policy.treatment);
      const prior = (await all(options.forecastStore,'checkpoints',{ questionId })).find(c => c.ordinal === ordinal);
      let checkpoint: ForecastCheckpoint;
      if (prior) {
        checkpoint = prior;
        if (prior.treatment !== policy.treatment || !equalsJson(prior.configuration,policy.configuration) || prior.promptRevision !== prompts.executor || prior.toolsetRevision !== toolset.revision || prior.noteSchemaRevision !== prompts.noteSchema) reject('TFCT1010','The delivery changes the retained checkpoint configuration.');
      } else {
        const harness = forecastMust(await selectForecastHarness(question,policy.treatment,await all(options.forecastStore,'harnesses',{ scopeKey: question.scopeKey }),schedule.scheduledAt));
        checkpoint = await sealForecastRecord('checkpoints',{ questionId,ordinal,scheduledAt: schedule.scheduledAt,cutoffAt: schedule.cutoffAt,startedAt: null,endedAt: null,inputHarnessVersionId: harness?.id ?? null,inputHarnessDigest: harness?.digest ?? null,traceId: null,noteId: null,predictionId: null,evidenceIds: [],spend: { calls: 0,tokens: 0,ms: 0,usageKnown: true },stopReason: null,status: 'planned',failure: null,noteFailure: null,treatment: policy.treatment,configuration: policy.configuration,promptRevision: prompts.executor,toolsetRevision: toolset.revision,noteSchemaRevision: prompts.noteSchema,decisionId: null });
      }
      const request = checkShape<ForecastWorkflowRequest>('forecastWorkflowRequest',{ questionId,checkpointId: checkpoint.id,ordinal,scheduledAt: schedule.scheduledAt,cutoffAt: schedule.cutoffAt,treatment: policy.treatment,revise: policy.revise,budget: policy.budget });
      const input = { request };
      if (existing && (existing.executableRevision !== plan.executableRevision || !equalsJson(existing.input,input))) reject('TFCT1010','Different input already owns this canonical forecast run.');
      if (!existing) forecastMust(await forecastCheckpointPlan(options.forecastStore,checkpoint));
      const created = await options.masStore.createRun({ runId,workflowId: workflow.workflowId,workflowVersionId: workflow.versionId,registryRevision: snapshot.revision,executableRevision: plan.executableRevision,configRegistryRevision: catalog.revision,profile: options.profile,input,limits: { ...workflow.limits } });
      if (!created.ok) {
        if (created.issue.code !== 'TMAS2001') return { kind: 'refused',runId,issues: [issue('TFCT1004',created.issue.detail)],cause: created.issue.code };
        const retained = await options.masStore.getRun(runId);
        if (!retained || !equalsJson(retained.input,input)) reject('TFCT1010','Concurrent delivery changed the canonical forecast run.');
        if (['queued','running'].includes(retained.status)) await options.segments.enqueue(retained);
        return { kind: 'duplicate',runId,checkpointId: checkpoint.id,cause: created.issue };
      }
      await options.segments.enqueue(created.value);
      return { kind: 'started',runId,checkpointId: checkpoint.id };
    } catch (error) {
      if (!(error instanceof ForecastRefusal)) throw error;
      return { kind: 'refused',runId,issues: error.issues,cause: error.code === 'TFCT1010' ? runId : null };
    }
  }
  async function tick(now: string): Promise<ForecastTick> {
    checkTime(now);
    if (now !== options.now()) reject('TFCT1001','The tick instant must match the injected host clock.');
    await options.segments.reconcile(); await options.segments.drain(runtime);
    const due = forecastMust(dueCheckpoints(await all(options.forecastStore,'schedules'),now)), deliveries: ForecastDelivery[] = [];
    const failed: ForecastTick['failed'] = [];
    for (const schedule of due) {
      const delivery = await deliver(schedule.questionId,schedule.ordinal); deliveries.push(delivery);
      await options.segments.reconcile(); await options.segments.drain(runtime);
      if (delivery.runId) {
        const run = await options.masStore.getRun(delivery.runId);
        if (run?.status === 'failed') failed.push({ runId: run.id,failure: run.failure });
      }
    }
    return { now,due: due.length,started: deliveries.filter(d => d.kind === 'started').length,duplicateDeliveries: deliveries.filter(d => d.kind === 'duplicate').length,deliveries,refused: deliveries.filter(d => d.kind === 'refused'),failed };
  }
  return { workflow,plan,snapshot,catalog,runtime,deliver,tick,resume: () => options.segments.reconcile() };
}
