/** Deterministic decision identities over an injected native MAS segment host. */
import { equalsJson } from '@jarenjs/core/object';
import { compileMasRuntime, type MasRun, type MasStore, type MasHostBindings, type MasSegmentHost, type TraceView, type WorkflowLimits } from '@tangleai/mas';
import { tradingRevisionOf, immutableTradingJson } from './identity.ts';
import { validateTradingShape } from './schema.ts';
import { tradingRefuse, tradingWorkflowIssue, type TradingOutcome } from './errors.ts';
import type { MaterializedTradingDecision } from './workflow.ts';
import type { TradingDecisionRequest, TradingDecisionOutput, TradingSpend, TradingIssue } from './contracts.gen.ts';

/** The queue owner retains leases/checkpoints; the runner supplies no queue or timer. */
export interface TradingDecisionSegments {
  enqueue(run: MasRun): Promise<unknown>;
  /** A terminal run is usable only after its native segment job is complete. */
  settled(run: MasRun): Promise<boolean>;
  drive(executableRevision: string, execute: (segment: MasSegmentHost) => Promise<void>, signal: AbortSignal): Promise<boolean>;
}
export interface TradingDecisionRun {
  runId: string; status: 'completed' | 'failed'; output: TradingDecisionOutput | null; spend: TradingSpend; errors: TradingIssue[]; trace: TraceView;
}
export interface TradingDecisionRunnerInput {
  materialized: MaterializedTradingDecision; masStore: MasStore; segments: TradingDecisionSegments;
  hostFor: (request: TradingDecisionRequest, runId: string) => Promise<{ valid: true; value: Omit<MasHostBindings, 'store'> } | { valid: false; issues: readonly unknown[] }>;
  /** Observed price/retry/repair attribution; native counters are checked independently. */
  spendFor: (trace: TraceView) => TradingOutcome<TradingSpend> | Promise<TradingOutcome<TradingSpend>>;
  maxSegments?: number;
  limits?: Partial<WorkflowLimits>;
  /** Cancellation for another queued decision this runner may help execute. */
  signalFor?: (runId: string) => AbortSignal;
}
export async function tradingDecisionRunId(request: TradingDecisionRequest, workflowVersionId: string): Promise<string> {
  return `trading-${await tradingRevisionOf({ manifestId: request.manifestId, asset: request.asset, sessionId: request.sessionId, workflowVersionId })}`;
}
export function createDecisionRunner(input: TradingDecisionRunnerInput) {
  const { materialized, masStore: store, segments, hostFor, spendFor } = input, maxSegments = input.maxSegments ?? 64;
  if (!Number.isSafeInteger(maxSegments) || maxSegments < 1) throw new TypeError('Decision segment bound must be a positive integer');
  return { async run(value: TradingDecisionRequest, signal: AbortSignal): Promise<TradingOutcome<TradingDecisionRun>> {
    const request = validateTradingShape<TradingDecisionRequest>('tradingDecisionRequest', value); if (!request.valid) return request;
    if (request.value.manifestId !== materialized.manifestId) return tradingRefuse('TTRD1002', '/manifestId', 'Decision request belongs to another immutable manifest');
    const w = materialized.workflow, runId = await tradingDecisionRunId(request.value, w.versionId);
    const limits = { ...w.limits, ...input.limits };
    if (Object.entries(limits).some(([key, value]) => !Number.isSafeInteger(value) || value < 0 || value > w.limits[key as keyof WorkflowLimits]))
      return tradingRefuse('TTRD1009', '/limits', 'Decision limits can only narrow the immutable workflow ceilings');
    for (const saved of [await store.putWorkflowVersion(w), await store.putRegistrySnapshot(materialized.snapshot.document as unknown as Record<string, unknown>, materialized.snapshot.revision)])
      if (!saved.ok) return tradingRefuse('TTRD1002', '/workflow', 'Native workflow retention refused', saved.issue);
    const plan = { runId, workflowId: w.workflowId, workflowVersionId: w.versionId, registryRevision: materialized.snapshot.revision,
      executableRevision: materialized.plan.executableRevision, configRegistryRevision: materialized.catalog.revision, profile: w.config.profile,
      input: { request: request.value }, limits };
    if (!await store.getRun(runId)) {
      const created = await store.createRun(plan);
      if (!created.ok && !await store.getRun(runId)) return tradingRefuse('TTRD1006', '/run', 'Native decision creation refused', created.issue);
    }
    let trace = await store.readTrace(runId);
    if (!trace) return tradingRefuse('TTRD1006', '/trace', 'Retained decision trace is missing');
    if (!equalsJson(trace.run.input, plan.input) || !equalsJson(trace.run.budget.limits, limits)
      || (['workflowId', 'workflowVersionId', 'registryRevision', 'executableRevision', 'configRegistryRevision', 'profile'] as const).some(key => trace!.run[key] !== plan[key]))
      return tradingRefuse('TTRD1006', '/request', 'Retained decision input or configuration differs from its requested snapshot');
    if (!['completed', 'failed', 'cancelled'].includes(trace.run.status)) await segments.enqueue(trace.run);
    for (let count = 0; count < maxSegments && (!['completed', 'failed', 'cancelled'].includes(trace.run.status) || !await segments.settled(trace.run)); count++) {
      if (trace.run.status === 'waiting_for_input' || trace.interactions.length) return tradingRefuse('TTRD1008', '/interactions', 'Trading decisions cannot create an interaction');
      const executed = await segments.drive(materialized.plan.executableRevision, async segment => {
        // A shared queue can claim a different decision under this same executable.
        // Resolve that run's own immutable context before binding its runtime.
        const current = await store.getRun(segment.run.id);
        if (!current || current.workflowVersionId !== w.versionId || current.executableRevision !== materialized.plan.executableRevision)
          throw new Error('Claimed decision does not match the registered executable');
        const payload = validateTradingShape<TradingDecisionRequest>('tradingDecisionRequest', (current.input as { request?: unknown }).request);
        if (!payload.valid) throw new Error('Claimed decision has invalid request content', { cause: payload.issues });
        const host = await hostFor(payload.value, current.id);
        if (!host.valid) throw new Error('Decision host refused its immutable input', { cause: host.issues });
        const runtime = compileMasRuntime(materialized.validated, materialized.plan, materialized.snapshot, { ...host.value, store });
        if (!runtime.valid) throw new Error('Native decision runtime refused', { cause: runtime.issues });
        await runtime.value.executeSegment({ ...segment, signal: current.id === runId ? signal : input.signalFor?.(current.id) ?? new AbortController().signal });
      }, signal);
      trace = await store.readTrace(runId);
      if (!trace) return tradingRefuse('TTRD1006', '/trace', 'Decision trace disappeared after a native segment');
      if (!executed) break;
    }
    if (!['completed', 'failed', 'cancelled'].includes(trace.run.status) || !await segments.settled(trace.run))
      return tradingRefuse('TTRD1006', '/run', 'Decision or its native segment is still unfinished; resume it before committing financial results');
    const observed = await spendFor(trace); if (!observed.valid) return observed;
    const spend = validateTradingShape<TradingSpend>('tradingSpend', observed.value); if (!spend.valid) return spend;
    const calls = trace.attempts.reduce((n, a) => n + a.usage.calls, 0), tools = trace.attempts.reduce((n, a) => n + a.usage.toolCalls, 0);
    const tokens = trace.attempts.reduce((n, a) => n + a.usage.promptTokens + a.usage.completionTokens + (a.usage.estimatedTokens ?? 0), 0);
    if (spend.value.calls !== calls || spend.value.toolCalls !== tools || spend.value.tokens !== tokens || spend.value.ms !== trace.run.budget.spent.ms
      || trace.attempts.some(a => (a.usage.unknownTokenRequests ?? 0) > 0 && !(a.usage.estimatedTokens! > 0)))
      return tradingRefuse('TTRD1002', '/spend', 'Decision spend must include every durable request and unknown-token estimate');
    const error = tradingWorkflowIssue(trace.run);
    let output: TradingDecisionOutput | null = null;
    if (!error) {
      const checked = validateTradingShape<TradingDecisionOutput>('tradingDecisionOutput', (trace.run.output as { output?: unknown })?.output);
      if (!checked.valid) return checked; output = checked.value;
    }
    return { valid: true, value: immutableTradingJson({ runId, status: error ? 'failed' : 'completed', output, spend: spend.value, errors: error ? [error] : [], trace }) };
  } };
}
