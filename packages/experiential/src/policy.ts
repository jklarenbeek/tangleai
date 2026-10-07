/** Explicit host ticks use native admission; durable reservations belong to the store. */
import { createScheduler } from '@jarenjs/core/schedule';
import { deepFreeze } from '@jarenjs/core/object';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { experientialSchema, validateExperientialShape } from './schema.ts';
import { experientialIssue, refuseExperiential, type ExperientialResult } from './errors.ts';
import type { TrainingBackend } from './backend.ts';
import type { ExperientialStore } from './store-types.ts';
import type { ExperientialTrainingPlan } from './pipeline.ts';
import type { ExperientialTrigger, ExperientialTriggerPolicy, ExperientialTriggerNoopReason, ExperientialTrainingRecipe,
  ExperientialTrainingRunBackendIdentity, ExperientialIssue } from './contracts.gen.ts';

export const DEFAULT_EXPERIENTIAL_TRIGGER_POLICY: Readonly<Omit<ExperientialTriggerPolicy, 'revision'>> = deepFreeze({
  enabled: false, triggers: ['manual', 'count', 'time', 'outcome'], minimumEligible: 10, maxCadenceMs: 60000,
  scopeCooldownMs: 60000, computeBudget: { maxRunsPerDay: 1, maxSpend: 0 }, maxQueued: 1, concurrency: 1, maxQueue: 32,
  onStaleParent: 'cancel',
});
export const EXPERIENTIAL_TRIGGER_NOOP_REASONS = deepFreeze([...experientialSchema.$defs.ExperientialTriggerNoopReason.enum]);
export async function sealExperientialTriggerPolicy(input: Omit<ExperientialTriggerPolicy, 'revision'>): Promise<ExperientialResult<ExperientialTriggerPolicy>> {
  const shape = validateExperientialShape<ExperientialTriggerPolicy>('ExperientialTriggerPolicy', { ...input, revision: '0'.repeat(64) });
  if (!shape.ok) return shape;
  const { revision: _, ...body } = shape.value;
  return { ok: true, value: deepFreeze({ ...body, revision: await canonicalSha256(body) }) };
}
export async function checkExperientialTriggerPolicy(input: unknown): Promise<ExperientialResult<ExperientialTriggerPolicy>> {
  const shape = validateExperientialShape<ExperientialTriggerPolicy>('ExperientialTriggerPolicy', input);
  if (!shape.ok) return shape;
  const { revision, ...body } = shape.value;
  if (await canonicalSha256(body) !== revision) return refuseExperiential('TEXP1002', '/policy/revision', 'Trigger policy bytes differ from their registered revision.');
  return shape;
}
export interface ExperientialTriggerAdmission {
  policy: ExperientialTriggerPolicy;
  trigger: ExperientialTrigger;
  recipe: ExperientialTrainingRecipe;
  backendIdentity: ExperientialTrainingRunBackendIdentity;
  at: number;
}
export interface ExperientialTriggerCounts { enqueued: number; replayed: number; noops: number; rebased: number; cancelled: number }
export interface ExperientialTriggerOutcome {
  action: 'enqueued' | 'replayed' | 'no-op' | 'rebased' | 'cancelled';
  reason: ExperientialTriggerNoopReason | 'accepted' | 'duplicate' | 'stale-parent';
  jobId: string | null;
  counts: ExperientialTriggerCounts;
  issue: ExperientialIssue | null;
}
export interface ExperientialTriggerReservation extends ExperientialTriggerOutcome {
  plan: ExperientialTrainingPlan | null;
  cancelledJobIds: string[];
}
export interface ExperientialTrainingJobs {
  /** A host binds enqueueExperientialTraining to the native database owner. */
  enqueue(plan: ExperientialTrainingPlan): Promise<string>;
}
export function experientialTriggerOutcome(action: ExperientialTriggerOutcome['action'], reason: ExperientialTriggerOutcome['reason'],
  plan: ExperientialTrainingPlan | null = null, cancelledJobIds: string[] = []): ExperientialTriggerReservation {
  return { action, reason, jobId: plan?.idempotencyKey ?? null, plan, cancelledJobIds,
    counts: { enqueued: Number(action === 'enqueued' || action === 'rebased'), replayed: Number(action === 'replayed'),
      noops: Number(action === 'no-op'), rebased: Number(action === 'rebased'), cancelled: cancelledJobIds.length },
    issue: reason === 'clock-skew' ? experientialIssue('TEXP1009', '/clock', 'clock-skew: the clock is invalid or precedes retained timing state.') : null };
}
export async function createExperientialRunner(options: { store: ExperientialStore; jobs: ExperientialTrainingJobs; backend: TrainingBackend;
  recipe: ExperientialTrainingRecipe; policy?: ExperientialTriggerPolicy | Partial<Omit<ExperientialTriggerPolicy, 'revision'>>;
  now(): number; sleep(ms: number, signal?: AbortSignal): Promise<void> }) {
  // Capture values and host seams before policy hashing yields to the caller.
  const { store, jobs, now, sleep, policy: requestedPolicy } = options;
  const recipe = validateExperientialShape<ExperientialTrainingRecipe>('ExperientialTrainingRecipe', options.recipe);
  const backend = validateExperientialShape<ExperientialTrainingRunBackendIdentity>('ExperientialTrainingRunBackendIdentity', options.backend?.identity);
  const checked = requestedPolicy && 'revision' in requestedPolicy ? await checkExperientialTriggerPolicy(requestedPolicy)
    : await sealExperientialTriggerPolicy({ ...DEFAULT_EXPERIENTIAL_TRIGGER_POLICY, ...requestedPolicy });
  if (!checked.ok || !recipe.ok || !backend.ok || typeof now !== 'function' || typeof sleep !== 'function')
    throw new TypeError('A runner requires a checked policy, training recipe, backend identity and injected clock/sleep.');
  const policy = checked.value, trainingRecipe = recipe.value, backendIdentity = backend.value;
  let observed = 0;
  const counts: ExperientialTriggerCounts = { enqueued: 0, replayed: 0, noops: 0, rebased: 0, cancelled: 0 };
  const byReason = Object.fromEntries(EXPERIENTIAL_TRIGGER_NOOP_REASONS.map(reason => [reason, 0])) as Record<ExperientialTriggerNoopReason, number>;
  function clock(): number | null {
    try { const at = now(); if (!Number.isSafeInteger(at) || at < observed || !Number.isFinite(new Date(at).getTime())) return null; observed = at; return at; }
    catch { return null; }
  }
  const schedulingClock = () => { try { const at = now(); return Number.isFinite(at) ? Math.max(observed, at) : observed; } catch { return observed; } };
  const scheduler = createScheduler({ concurrency: policy.concurrency, maxQueue: policy.maxQueue, now: schedulingClock, sleep });
  const finish = (value: ExperientialTriggerReservation): ExperientialResult<ExperientialTriggerOutcome> => {
    for (const name of Object.keys(counts) as Array<keyof ExperientialTriggerCounts>) counts[name] += value.counts[name];
    if (value.action === 'no-op') byReason[value.reason as ExperientialTriggerNoopReason]++;
    const { plan: _plan, cancelledJobIds: _cancelled, ...result } = value;
    return { ok: true, value: deepFreeze(result) };
  };
  const noop = (reason: ExperientialTriggerNoopReason) => finish(experientialTriggerOutcome('no-op', reason));
  async function run(input: ExperientialTrigger, context: { signal?: AbortSignal; deadline?: number } = {}): Promise<ExperientialResult<ExperientialTriggerOutcome>> {
    const valid = validateExperientialShape<ExperientialTrigger>('ExperientialTrigger', input); if (!valid.ok) return valid;
    if (!policy.enabled) return noop('disabled');
    if (!policy.triggers.includes(valid.value.kind)) return noop('trigger-disabled');
    try {
      return await scheduler.run(async () => {
        const at = clock(); if (at === null) return noop('clock-skew');
        const retained = await store.schedule({ policy, trigger: valid.value, recipe: trainingRecipe, backendIdentity, at });
        if (!retained.ok) return retained;
        const value = retained.value;
        if (value.plan) {
          // The durable domain reservation is an outbox: a failed enqueue is
          // recovered by the same tick after restart, without another budget debit.
          let id: string;
          try { id = await jobs.enqueue(value.plan); }
          catch {
            counts.cancelled += value.counts.cancelled; counts.rebased += value.counts.rebased;
            return refuseExperiential('TEXP1009', '/jobs', 'The reserved training job could not be enqueued; replay the same trigger to resume.');
          }
          if (id !== value.jobId) {
            counts.cancelled += value.counts.cancelled; counts.rebased += value.counts.rebased;
            return refuseExperiential('TEXP1002', '/jobId', 'The native queue returned a different registered job identity.');
          }
        }
        return finish(value);
      }, { scope: valid.value.scope, ...context });
    } catch (error) {
      const reason = error instanceof Error ? error.message : '';
      if (reason === 'queue-full' || reason === 'scope-limit') return noop('queue-full');
      if (reason === 'closed' || reason === 'cancelled' || reason === 'deadline') return noop(reason);
      return refuseExperiential('TEXP1009', '/runner', 'The admitted trigger could not complete.');
    }
  }
  return Object.freeze({ run, policy, close: () => scheduler.close(), stats: () => ({ ...scheduler.stats(), ...counts, byReason: { ...byReason } }) });
}
