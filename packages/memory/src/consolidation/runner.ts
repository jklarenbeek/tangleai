/** Host-driven eligibility over a Jaren scheduler; the store remains the CAS authority. */
import { createScheduler } from '@jarenjs/core/schedule';
import { checkConsolidation, consolidationRefusal as refuse, consolidationSuccess as success,
  type ConsolidationResult, type ConsolidationReceipt, type ConsolidationSource, type ConsolidationTriggerPolicy,
  type ConsolidationTriggerRequest, type ConsolidationRunRequest, type ConsolidationResolution,
  type ConsolidationExecutionResult } from './contracts.ts';
import type { ConsolidationStore } from './types.ts';
import { applyDeterministicConsolidation, DEFAULT_CONSOLIDATION_TIER, type DeterministicConsolidationOptions } from './deterministic.ts';
import type { createConsolidationExecutor } from './execution.ts';
export const DEFAULT_CONSOLIDATION_TRIGGER_POLICY: Readonly<ConsolidationTriggerPolicy> = Object.freeze({ enabled: false,
  tier: 'deterministic', countThreshold: 10, intervalMs: 60000, cooldownMs: 0, maxPending: 100,
  maxBatchSources: 10, concurrency: 1, maxQueue: 32 });
export interface ConsolidationRunContext { signal?: AbortSignal; deadline?: number }
function executionResult(result: ConsolidationResult<ConsolidationReceipt> | ConsolidationExecutionResult): ConsolidationExecutionResult {
  if ('accounting' in result) return result;
  return { ...result, operationId: result.status === 'success' ? result.value.passId : null,
    accounting: { reservedCalls: 0, completedCalls: 0, refusedCalls: 0, failedCalls: 0, unknownCalls: 0, invoked: 0, embeddingItems: 0 } };
}
export function createConsolidationRunner(options: {
  store: ConsolidationStore; executor?: ReturnType<typeof createConsolidationExecutor>;
  policy?: Partial<ConsolidationTriggerPolicy>; deterministic?: Partial<DeterministicConsolidationOptions>; now?: () => number;
}) {
  const checked = checkConsolidation<ConsolidationTriggerPolicy>('consolidationTriggerPolicy',
    { ...DEFAULT_CONSOLIDATION_TRIGGER_POLICY, ...options.policy }, 'budget');
  if (checked.status !== 'success') throw new TypeError(checked.detail);
  const policy = Object.freeze(checked.value), store = options.store, executor = options.executor;
  if (executor && executor.store !== store) throw new TypeError('runner and executor must use the same store handle');
  const deterministic = Object.freeze({ ...DEFAULT_CONSOLIDATION_TIER, ...options.deterministic });
  if (policy.tier !== 'deterministic' && !executor) throw new TypeError('semantic triggers need a configured executor');
  if (policy.maxBatchSources > policy.maxPending || policy.maxBatchSources > (policy.tier === 'deterministic' ? deterministic.maxSources : executor!.bounds.maxSources))
    throw new TypeError('trigger batch exceeds pending or tier source capacity');
  const now = options.now ?? Date.now;
  let observed = 0;
  const clock = (): ConsolidationResult<number> => {
    let at: number;
    try { at = now(); } catch { return refuse('clock-skew', 'host clock threw'); }
    if (!Number.isSafeInteger(at) || at < observed) return refuse('clock-skew', 'clock is invalid or precedes a prior observation');
    observed = at; return success(at);
  };
  // Keep scheduler time finite even when the injected domain clock is faulty.
  // The worker still reports the original invalid/regressed observation.
  const schedulingClock = () => { try { const at = now(); return Number.isFinite(at) ? Math.max(observed, at) : observed; } catch { return observed; } };
  const scheduler = createScheduler({ concurrency: policy.concurrency, maxQueue: policy.maxQueue, now: schedulingClock });
  async function admit<T>(scope: string, task: () => Promise<ConsolidationResult<T>>, context: ConsolidationRunContext = {}): Promise<ConsolidationResult<T>> {
    try { return await scheduler.run(task, { scope, ...context }); }
    catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      return refuse(detail === 'closed' ? 'closed' : detail === 'cancelled' ? 'cancelled' : detail === 'deadline' ? 'budget'
        : detail === 'queue-full' || detail === 'scope-limit' ? 'backpressure' : 'invalid-operation', detail);
    }
  }
  async function run(input: ConsolidationTriggerRequest, context: ConsolidationRunContext = {}): Promise<ConsolidationExecutionResult> {
    const valid = checkConsolidation<ConsolidationTriggerRequest>('consolidationTriggerRequest', input, 'invalid-operation');
    if (valid.status !== 'success') return executionResult(valid);
    const request = valid.value;
    return executionResult(await admit<ConsolidationReceipt>(request.scope, async () => {
      if (!policy.enabled) return refuse('disabled', 'consolidation triggers are disabled');
      const at = clock(); if (at.status !== 'success') return at;
      const snapshot = await store.snapshot(request.scope); if (snapshot.status !== 'success') return snapshot;
      const { buffer, sources, operations } = snapshot.value;
      if (at.value < (buffer.completedAt ?? 0) || at.value < (buffer.pendingSince ?? 0)) return refuse('clock-skew', 'clock precedes durable timing state');
      const prior = operations.find(operation => operation.key === request.key);
      const completedReplay = prior?.phase === 'completed';
      if (!completedReplay && buffer.completedAt !== null && at.value - buffer.completedAt < policy.cooldownMs)
        return refuse('cooldown', 'successful completion cooldown has not elapsed');
      if (!prior) {
        if (!buffer.pending.length) return refuse('empty', 'there is no pending evidence');
        if (request.trigger === 'count' && buffer.pending.length < policy.countThreshold) return refuse('below-count', 'pending count has not reached the threshold');
        const anchor = buffer.completedAt === null && buffer.pendingSince == null ? null : Math.max(buffer.completedAt ?? 0, buffer.pendingSince ?? 0);
        if (request.trigger === 'time' && (anchor === null || at.value - anchor < policy.intervalMs)) return refuse('not-due', 'the persisted interval has not elapsed');
      }
      const finish = () => { const completed = clock(); if (completed.status !== 'success') throw new Error(completed.detail); return completed.value; };
      const sourceIds = prior?.sourceIds ?? buffer.pending.slice(0, policy.maxBatchSources);
      const expectedGeneration = prior?.expectedGeneration ?? buffer.generation;
      if (policy.tier !== 'deterministic') return executor!.execute({ scope: request.scope, key: request.key, sourceIds,
        expectedGeneration, completedAt: at.value, tier: policy.tier, signal: context.signal }, { completionClock: finish });
      if (context.signal?.aborted) return refuse('cancelled', 'cancelled before deterministic activation');
      const lookup = new Map(sources.map(source => [source.id, source]));
      if (sourceIds.some(id => !lookup.has(id))) return refuse('invalid-source', 'pending evidence is missing');
      return applyDeterministicConsolidation(store, sourceIds.map(id => lookup.get(id)!), { key: request.key,
        expectedGeneration, completedAt: at.value, options: deterministic, completionClock: finish });
    }, context));
  }
  const enqueue = (sources: ConsolidationSource[], context: ConsolidationRunContext = {}) => admit(Array.isArray(sources) ? sources[0]?.scope ?? '' : '', async () => {
    const at = clock(); if (at.status !== 'success') return at;
    return store.enqueue(sources, { maxPending: policy.maxPending, enqueuedAt: at.value });
  }, context);
  const inspect = (scope: string, context: ConsolidationRunContext = {}) => admit(scope, () => store.snapshot(scope), context);
  const resolve = (request: ConsolidationRunRequest, resolution: ConsolidationResolution, context: ConsolidationRunContext = {}) => {
    const checked = checkConsolidation<ConsolidationRunRequest>('consolidationRunRequest', request, 'invalid-operation');
    if (checked.status !== 'success') return Promise.resolve(checked);
    return admit(checked.value.scope, () => executor ? executor.resolve(checked.value, resolution) : Promise.resolve(refuse('invalid-operation', 'this runner has no synthesis executor')), context);
  };
  return Object.freeze({ run, enqueue, inspect, resolve, policy, close: () => scheduler.close(), stats: () => scheduler.stats() });
}
export type ConsolidationRunner = ReturnType<typeof createConsolidationRunner>;
