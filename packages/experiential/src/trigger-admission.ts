/** Atomic cadence decisions over retained domain rows, independent of queue execution. */
import { equalsJson, deepFreeze } from '@jarenjs/core/object';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { validateExperientialShape } from './schema.ts';
import { planExperientialSelection } from './selection.ts';
import { planExperientialTraining, type ExperientialTrainingPlan } from './pipeline.ts';
import { initialTrainingProgress, trainingTerminal } from './training.ts';
import { checkExperientialHead } from './lifecycle.ts';
import { checkExperientialTriggerPolicy, experientialTriggerOutcome, type ExperientialTriggerAdmission,
  type ExperientialTriggerReservation } from './policy.ts';
import { experientialIssue, type ExperientialResult } from './errors.ts';
import type { ExperientialTable, ExperientialTables } from './store-types.ts';
import type { ExperientialTrigger, ExperientialTrainingRecipe, ExperientialTrainingRunBackendIdentity,
  ExperientialTrainingRun, ExperientialDataset, ExperientialExpectedHead, ExperientialDeployment,
  ExperientialTriggerPolicy, ExperientialEvent, ExperientialIssue } from './contracts.gen.ts';

interface TriggerBinding {
  trigger: ExperientialTrigger; policy: ExperientialTriggerPolicy; recipe: ExperientialTrainingRecipe;
  backendIdentity: ExperientialTrainingRunBackendIdentity; head: ExperientialExpectedHead; deploymentId: string;
}
export interface ExperientialTriggerContext {
  list<K extends ExperientialTable>(table: K, scope: string): Promise<ExperientialTables[K][]>;
  get<K extends ExperientialTable>(table: K, id: string, scope: string): Promise<ExperientialTables[K]>;
  deployment(id: string, scope: string): Promise<ExperientialDeployment>;
  putRun(run: ExperientialTrainingRun): Promise<void>;
  cancel(run: ExperientialTrainingRun): Promise<void>;
  event(scope: string, kind: string, recordId: string, detail: string): Promise<void>;
  at(): string;
}
class AdmissionRefusal extends Error {
  readonly issues: ExperientialIssue[];
  constructor(issues: ExperientialIssue[]) { super('Training admission refused.'); this.issues = issues; }
}
const need = <T>(result: ExperientialResult<T>): T => { if (!result.ok) throw new AdmissionRefusal(result.issues); return result.value; };
function refuse(code: ExperientialIssue['code'], path: string, detail: string): never { throw new AdmissionRefusal([experientialIssue(code, path, detail)]); }
const receiptKinds = ['training-trigger-admitted', 'training-trigger-rebased'];

export async function experientialTriggerBinding(event: ExperientialEvent): Promise<ExperientialResult<TriggerBinding>> {
  try {
    const input: TriggerBinding = JSON.parse(event.detail);
    if (!input || !equalsJson(Object.keys(input).sort(), ['backendIdentity', 'deploymentId', 'head', 'policy', 'recipe', 'trigger']))
      refuse('TEXP1002', '/event/detail', 'A retained trigger binding has unexpected fields.');
    const trigger = need(validateExperientialShape<ExperientialTrigger>('ExperientialTrigger', input.trigger));
    const policy = need(await checkExperientialTriggerPolicy(input.policy));
    const recipe = need(validateExperientialShape<ExperientialTrainingRecipe>('ExperientialTrainingRecipe', input.recipe));
    const backendIdentity = need(validateExperientialShape<ExperientialTrainingRunBackendIdentity>('ExperientialTrainingRunBackendIdentity', input.backendIdentity));
    const head = need(validateExperientialShape<ExperientialExpectedHead>('ExperientialExpectedHead', input.head));
    if (trigger.scope !== event.scope || !/^[a-f0-9]{64}$/.test(input.deploymentId))
      refuse('TEXP1002', '/event/detail', 'A retained trigger binding differs from its scope or deployment.');
    return { ok: true, value: deepFreeze({ trigger, policy, recipe, backendIdentity, head, deploymentId: input.deploymentId }) };
  } catch (error) {
    return { ok: false, issues: error instanceof AdmissionRefusal ? error.issues : [experientialIssue('TEXP1002', '/event/detail', 'The retained trigger binding is malformed.')] };
  }
}
function originalPlan(run: ExperientialTrainingRun): ExperientialTrainingPlan {
  if (!run.spec || !run.pipelineRevision || !run.progress || !run.runtime) refuse('TEXP1002', '/trainingRun', 'A trigger requires the exact managed training specification.');
  const original = { ...run, state: 'queued' as const, startedAt: null, finishedAt: null, logRefs: [], metricsRef: null,
    stopReason: null, submissions: 0, progress: initialTrainingProgress(run.recordedAt) };
  return { run: original, idempotencyKey: run.idempotencyKey, pipelineRevision: run.pipelineRevision!,
    input: { runId: run.id, idempotencyKey: run.idempotencyKey, pipelineRevision: run.pipelineRevision! } };
}

export async function admitExperientialTrigger(context: ExperientialTriggerContext, raw: ExperientialTriggerAdmission): Promise<ExperientialResult<ExperientialTriggerReservation>> {
  const c = context, noop = (reason: Parameters<typeof experientialTriggerOutcome>[1]) => experientialTriggerOutcome('no-op', reason);
  try {
    if (!raw || typeof raw !== 'object' || !equalsJson(Object.keys(raw).sort(), ['at', 'backendIdentity', 'policy', 'recipe', 'trigger']))
      refuse('TEXP1001', '', 'Training admission requires its closed request.');
    const policy = need(await checkExperientialTriggerPolicy(raw.policy));
    const trigger = need(validateExperientialShape<ExperientialTrigger>('ExperientialTrigger', raw.trigger));
    const recipe = need(validateExperientialShape<ExperientialTrainingRecipe>('ExperientialTrainingRecipe', raw.recipe));
    const backendIdentity = need(validateExperientialShape<ExperientialTrainingRunBackendIdentity>('ExperientialTrainingRunBackendIdentity', raw.backendIdentity));
    const success = (value: ExperientialTriggerReservation): ExperientialResult<ExperientialTriggerReservation> => ({ ok: true, value: deepFreeze(value) });
    if (!policy.enabled) return success(noop('disabled'));
    if (!policy.triggers.includes(trigger.kind)) return success(noop('trigger-disabled'));
    const atText = c.at(), at = Date.parse(atText);
    if (!Number.isSafeInteger(raw.at) || raw.at < 0 || !Number.isSafeInteger(at) || at < raw.at) return success(noop('clock-skew'));
    const scope = trigger.scope;
    const runs = await c.list('training_runs', scope), events = await c.list('events', scope);
    const dates = [...runs.flatMap(run => [run.recordedAt, run.startedAt, run.finishedAt, run.progress?.updatedAt]), ...events.map(event => event.recordedAt)]
      .filter((date): date is string => typeof date === 'string').map(date => Date.parse(date));
    if (dates.some(date => !Number.isSafeInteger(date) || date > at)) return success(noop('clock-skew'));
    const completions: number[] = [];
    for (const run of runs.filter(run => run.state === 'complete')) {
      // The initial unmanaged lifecycle kept completion in its atomic event.
      // Missing timing authority cannot silently disable the cooldown.
      const event = events.filter(event => event.recordId === run.id && event.kind === 'state-transition').sort((a, b) => b.seq - a.seq).find(event => {
        try { const detail = JSON.parse(event.detail); return detail.table === 'training_runs' && detail.to === 'complete'; }
        catch { return false; }
      });
      const date = run.finishedAt ?? event?.recordedAt;
      if (!date || !Number.isSafeInteger(Date.parse(date)) || Date.parse(date) > at) return success(noop('clock-skew'));
      completions.push(Date.parse(date));
    }
    const deployments = (await c.list('deployments', scope)).filter(row => row.profile === recipe.profile);
    if (deployments.length !== 1) refuse('TEXP1004', '/deployment', 'Exactly one registered deployment must bind this profile and scope.');
    const deployment = await c.deployment(deployments[0].id, scope);
    const head = { versionId: deployment.activeArtifactId, revision: deployment.headRevision };
    const baseId = deployment.activeArtifactId ?? deployment.baseArtifactId;
    const admissions: Array<{ event: ExperientialEvent; binding: TriggerBinding; run: ExperientialTrainingRun }> = [];
    const seenTriggers = new Set<string>();
    for (const event of events.filter(event => receiptKinds.includes(event.kind)).sort((a, b) => b.seq - a.seq)) {
      const binding = need(await experientialTriggerBinding(event));
      const run = runs.find(run => run.id === event.recordId);
      if (!run || !run.spec || !equalsJson(binding.backendIdentity, run.backendIdentity)) refuse('TEXP1002', '/event/recordId', 'A retained trigger no longer binds its exact training run.');
      const key = canonicalizeJson(binding.trigger);
      if (seenTriggers.has(key)) continue;
      seenTriggers.add(key);
      admissions.push({ event, binding, run });
    }
    const prior = admissions.find(row => equalsJson(row.binding.trigger, trigger));
    if (prior && (prior.binding.policy.revision !== policy.revision || !equalsJson(prior.binding.recipe, recipe)
      || !equalsJson(prior.binding.backendIdentity, backendIdentity)))
      refuse('TEXP1002', '/trigger/key', 'The trigger key already binds a different policy, recipe or backend.');
    const staleParent = (row: typeof admissions[number]) => row.binding.deploymentId === deployment.id
      && row.run.progress?.dispatch === 'none' && !checkExperientialHead(head, row.binding.head).ok
      && (!trainingTerminal(row.run) || row.run.state === 'cancelled' && row.binding.policy.onStaleParent === 'rebase'
        && events.some(event => event.kind === 'training-trigger-cancelled' && event.recordId === row.run.id));
    const stale = admissions.find(staleParent);
    const selectedStale = prior && staleParent(prior) ? prior : stale;
    if (prior && !selectedStale) {
      if (prior.run.state === 'cancelled') return success(experientialTriggerOutcome('replayed', 'duplicate'));
      return success(experientialTriggerOutcome('replayed', 'duplicate', originalPlan(prior.run)));
    }
    const cancelled: string[] = [];
    let staleBinding: TriggerBinding | undefined;
    if (selectedStale) {
      if (!equalsJson(selectedStale.binding.backendIdentity, backendIdentity)) refuse('TEXP1008', '/backend', 'A stale reservation requires its registered backend binding.');
      staleBinding = selectedStale.binding;
      if (!trainingTerminal(selectedStale.run)) {
        await c.cancel(selectedStale.run); cancelled.push(selectedStale.run.idempotencyKey);
        await c.event(scope, 'training-trigger-cancelled', selectedStale.run.id, canonicalizeJson({
          trigger: staleBinding.trigger, expectedHead: staleBinding.head, actualHead: head, reason: 'stale-parent', policyRevision: staleBinding.policy.revision }));
      }
      if (staleBinding.policy.onStaleParent === 'cancel') return success(experientialTriggerOutcome('cancelled', 'stale-parent', null, cancelled));
    }
    const decline = (reason: Parameters<typeof noop>[0]) => success(cancelled.length
      ? experientialTriggerOutcome('cancelled', reason, null, cancelled) : noop(reason));
    const effectiveRecipe = staleBinding?.recipe ?? recipe, effectivePolicy = staleBinding?.policy ?? policy;
    const effectiveTrigger = staleBinding?.trigger ?? trigger;
    const pending = runs.filter(run => !trainingTerminal(run) && !cancelled.includes(run.idempotencyKey));
    if (pending.length >= effectivePolicy.maxQueued) return decline('queue-full');
    const day = Math.floor(at / 86400000), dayRuns = runs.filter(run => Math.floor(Date.parse(run.recordedAt) / 86400000) === day);
    if (dayRuns.length >= effectivePolicy.computeBudget.maxRunsPerDay) return decline('budget-exhausted');
    const spendLimit = effectivePolicy.computeBudget.maxSpend;
    if (spendLimit !== null) {
      const charged = runs.filter(run => dayRuns.includes(run) || !trainingTerminal(run));
      const cost = charged.reduce((sum, run) => {
        if (cancelled.includes(run.idempotencyKey) || run.state === 'cancelled' && run.submissions === 0) return sum;
        const observed = run.progress?.backendState?.spend;
        const reserved = run.budget.maxSpend;
        if (reserved === null || trainingTerminal(run) && run.submissions > 0 && observed == null) return Infinity;
        return sum + Math.max(reserved, observed ?? 0);
      }, 0);
      if (effectiveRecipe.budget.maxSpend === null || cost + effectiveRecipe.budget.maxSpend > spendLimit) return decline('budget-exhausted');
    }
    if (!selectedStale) {
      const last = runs.length ? Math.max(...runs.map(run => Date.parse(run.recordedAt))) : null;
      if (last !== null && at - last < effectivePolicy.maxCadenceMs) return decline('cadence');
      const latest = completions.length ? Math.max(...completions) : null;
      if (latest !== null && at - latest < effectivePolicy.scopeCooldownMs) return decline('cooldown');
    }
    const datasets = (await c.list('datasets', scope)).sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt) || a.id.localeCompare(b.id, 'en'));
    const experiences = await c.list('experiences', scope), assessments = await c.list('assessments', scope);
    let dataset: ExperientialDataset | undefined, eligible = 0;
    for (const row of datasets) {
      if (selectedStale && row.id !== selectedStale.run.datasetId || !row.selection) continue;
      const plan = await planExperientialSelection({ experiences, assessments, ...row.selection });
      if (!plan.ok) return plan;
      const selected = new Set(plan.value.selected.filter(row => row.state === 'selected').map(row => row.id));
      if (row.selectedIds.every(id => selected.has(id))) { dataset = row; eligible = plan.value.counts.selected; break; }
    }
    if (!dataset) return decline('no-approved-dataset');
    if (Date.parse(dataset.recordedAt) > at || experiences.some(row => dataset!.selectedIds.includes(row.id) && Date.parse(row.recordedAt) > at)) return decline('clock-skew');
    if (effectiveTrigger.kind === 'count' && eligible < effectivePolicy.minimumEligible) return decline('below-minimum');
    if (effectiveTrigger.kind === 'time') {
      const anchor = completions.length ? Math.max(...completions) : Date.parse(dataset.recordedAt);
      if (at < anchor) return decline('clock-skew');
      if (at - anchor < effectivePolicy.maxCadenceMs) return decline('cadence');
    }
    if (effectiveTrigger.kind === 'outcome' && !experiences.some(row => dataset!.selectedIds.includes(row.id) && row.observedOutcome?.sourceId === effectiveTrigger.key))
      return decline('no-approved-dataset');
    const base = await c.get('artifacts', baseId, scope);
    const { profile: _profile, runtime, ...configuration } = effectiveRecipe;
    const plan = need(await planExperientialTraining({ dataset, base, runtime, backendIdentity, recordedAt: atText,
      spec: { ...configuration, datasetId: dataset.id, manifestDigest: dataset.manifestDigest, baseArtifactId: base.id, baseChecksum: base.checksum,
        tokenizerIdentity: dataset.tokenizerIdentity, chatTemplateIdentity: dataset.chatTemplateIdentity } }));
    const existing = runs.find(run => run.idempotencyKey === plan.idempotencyKey);
    if (existing) {
      if (existing.id !== plan.run.id || existing.state === 'cancelled') return decline('no-approved-dataset');
      return success(experientialTriggerOutcome('replayed', 'duplicate', originalPlan(existing), cancelled));
    }
    await c.putRun(plan.run);
    const binding: TriggerBinding = { trigger: effectiveTrigger, policy: effectivePolicy, recipe: effectiveRecipe, backendIdentity, head, deploymentId: deployment.id };
    await c.event(scope, selectedStale ? 'training-trigger-rebased' : 'training-trigger-admitted', plan.run.id, canonicalizeJson(binding));
    return success(experientialTriggerOutcome(selectedStale ? 'rebased' : 'enqueued', selectedStale ? 'stale-parent' : 'accepted', plan, cancelled));
  } catch (error) {
    if (error instanceof AdmissionRefusal) return { ok: false, issues: error.issues };
    throw error;
  }
}
