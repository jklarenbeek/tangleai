/** Compare retained observations with registered limits; statistics belong to the instrument. */
import { createGuardedRefiner } from '@jarenjs/core/guarded';
import { deepFreeze, equalsJson } from '@jarenjs/core/object';
import { checkExperientialRecord } from './identity.ts';
import { validateExperientialRecord, validateExperientialShape } from './schema.ts';
import { experientialNativeCause, refuseExperiential, type ExperientialResult } from './errors.ts';
import type { ExperientialEvaluationMetrics, ExperientialGatePolicy, ExperientialGateFailure } from './contracts.gen.ts';

export const EXPERIENTIAL_EVALUATION_ROWS = Object.freeze([
  'frozen-none', 'frozen-retrieval', 'frozen-distilled-rule', 'active-artifact-no-retrieval', 'candidate-no-retrieval',
] as const);
export const EXPERIENTIAL_RETENTION_LANES = Object.freeze(['cgt-replay', 'base-replay', 'locomo-recall', 'locomo-qa'] as const);
export interface ExperientialGateResult { passed: boolean; failures: ExperientialGateFailure[] }

/** A missing value is a failed observation, never an imputed zero or waived gate. */
export function evaluateExperientialGates(input: ExperientialEvaluationMetrics, rawPolicy: ExperientialGatePolicy): ExperientialGateResult {
  const failures: ExperientialGateFailure[] = [];
  const fail = (gate: ExperientialGateFailure['gate'], detail: string, observed: number | null = null, tolerance: number | null = null) =>
    failures.push({ gate, detail, observed, tolerance });
  const checkedPolicy = validateExperientialRecord('gatePolicy', rawPolicy);
  if (!checkedPolicy.ok) fail('binding', 'The registered gate policy is malformed.');
  const checked = validateExperientialShape<ExperientialEvaluationMetrics>('ExperientialEvaluationMetrics', input);
  if (!checked.ok) {
    for (const path of new Set(checked.issues.map(issue => issue.path))) {
      const family = path.startsWith('/rows') || path.startsWith('/interval') ? 'learning'
        : path.startsWith('/retention') ? 'retention' : path.startsWith('/security') ? 'security'
          : path.startsWith('/operations') || path.startsWith('/cost') ? 'operations' : 'binding';
      fail(family, 'Malformed or missing recorded measurement at ' + (path || '/') + '.');
    }
  }
  if (!checked.ok || !checkedPolicy.ok) return deepFreeze({ passed: false, failures });
  const evaluation = checked.value, policy = checkedPolicy.value;
  if (evaluation.scope !== policy.scope || evaluation.gatePolicyId !== policy.id)
    fail('binding', 'The evaluation does not name this registered policy and scope.');
  if (evaluation.migrationExperiment) fail('binding', 'A migration experiment cannot approve an artifact.');
  for (const rowId of policy.requiredRows) {
    const matches = evaluation.rows.filter(row => row.rowId === rowId), row = matches[0];
    if (matches.length !== 1 || !row || row.status !== 'run' || row.cgc === null || row.failures !== 0 || row.identityId === null || row.samples < 1)
      fail('learning', 'Required row ' + rowId + ' is missing, duplicated, unidentified, incomplete or failed.', row?.failures ?? null, 0);
  }
  if (evaluation.rows.some(row => !policy.rows.includes(row.rowId))) fail('binding', 'An evaluation row was not registered.');
  const candidate = evaluation.rows.find(row => row.rowId === 'candidate-no-retrieval');
  for (const control of policy.controls) {
    const matches = evaluation.interval.filter(value => value.control === control), interval = matches[0];
    const row = evaluation.rows.find(value => value.rowId === control);
    if (matches.length !== 1 || !interval || interval.seed !== policy.interval.seed || interval.resamples !== policy.interval.resamples
      || interval.level !== policy.interval.level || interval.pairs !== candidate?.samples || interval.pairs !== row?.samples) {
      fail('learning', 'The paired interval for ' + control + ' does not reproduce its registered settings and coverage.');
    } else if (interval.low <= policy.learning.minLowerBound) {
      fail('learning', 'The candidate does not strictly improve on ' + control + '.', interval.low, policy.learning.minLowerBound);
    }
  }
  const tolerances = { 'cgt-replay': policy.retention.cgtReplayMaxDrop, 'base-replay': policy.retention.baseReplayMaxDrop,
    'locomo-recall': policy.retention.locomoRecallMaxDrop, 'locomo-qa': policy.retention.locomoQaMaxDrop };
  for (const lane of EXPERIENTIAL_RETENTION_LANES) {
    const matches = evaluation.retention.filter(value => value.lane === lane), result = matches[0], limit = tolerances[lane];
    if (matches.length !== 1 || !result || result.status !== 'run' || result.drop === null)
      fail('retention', 'Required retention lane ' + lane + ' was not measured exactly once.', null, limit);
    else if (result.drop > limit) fail('retention', 'Retention lane ' + lane + ' exceeded its registered drop.', result.drop, limit);
  }
  for (const fixtureId of policy.security.fixtures) {
    const matches = evaluation.security.filter(value => value.fixtureId === fixtureId), result = matches[0];
    if (matches.length !== 1 || !result || !['refused', 'unchanged'].includes(result.outcome))
      fail('security', 'Required security fixture ' + fixtureId + ' was not refused or unchanged.');
  }
  if (evaluation.security.some(value => !policy.security.fixtures.includes(value.fixtureId)))
    fail('security', 'A security result names an unregistered fixture.');
  const observed = evaluation.operations, limits = policy.operations;
  if (observed.status !== 'run') fail('operations', 'Required operational observations were not measured.');
  for (const [key, limit] of [['artifactBytes', limits.maxArtifactBytes], ['trainingMs', limits.maxTrainingMs],
    ['inferenceP95Ms', limits.maxInferenceP95Ms], ['failureRate', limits.maxFailureRate]] as const) {
    const value = observed[key];
    if (value === null || value > limit) fail('operations', 'Operational observation ' + key + ' is missing or exceeds its registered bound.', value, limit);
  }
  if (limits.maxCost !== null && (observed.cost === null || observed.cost > limits.maxCost))
    fail('operations', 'Known cost within the registered monetary bound is required.', observed.cost, limits.maxCost);
  if (evaluation.cost?.amount !== null && evaluation.cost?.amount !== undefined && evaluation.cost.amount !== observed.cost)
    fail('operations', 'The retained cost records disagree.');
  if (observed.runtimeProvider === null || !limits.runtimeProviders.includes(observed.runtimeProvider))
    fail('operations', 'The artifact runtime provider is outside the registered profile.');
  return deepFreeze({ passed: failures.length === 0, failures });
}

export interface ExperientialGatePolicyRevisionOptions {
  read(): Promise<ExperientialGatePolicy>;
  proposal: ExperientialGatePolicy;
  /** Persist a new immutable policy; existing evaluation registrations keep their original policy id. */
  commit(next: ExperientialGatePolicy, previous: ExperientialGatePolicy): Promise<ExperientialResult<ExperientialGatePolicy>>;
}

/** Native guarded preparation owns cloning, validation order and serialized publication. */
export async function reviseGatePolicy(options: ExperientialGatePolicyRevisionOptions): Promise<ExperientialResult<ExperientialGatePolicy>> {
  if (typeof options?.read !== 'function' || typeof options?.commit !== 'function') throw new TypeError('Gate revision requires injected read and commit.');
  const captured = validateExperientialRecord('gatePolicy', options.proposal);
  if (!captured.ok) return captured;
  const guarded = createGuardedRefiner({
    read: options.read,
    async validateProposal(value: unknown) {
      const checked = await checkExperientialRecord('gatePolicy', value);
      return checked.ok ? true : { valid: false, errors: checked.issues };
    },
    apply: (_before: ExperientialGatePolicy, proposal: ExperientialGatePolicy) => proposal,
    async validateCandidate(next: ExperientialGatePolicy, previous: ExperientialGatePolicy) {
      const prior = await checkExperientialRecord('gatePolicy', previous);
      if (!prior.ok) return { valid: false, errors: prior.issues };
      return next.scope === previous.scope ? true : { valid: false, errors: refuseExperiential('TEXP1005', '/scope', 'A policy revision cannot cross scope.').issues };
    },
    planCommit: (next: ExperientialGatePolicy) => next,
    async commit(plan: ExperientialGatePolicy, context: { previous: ExperientialGatePolicy; next: ExperientialGatePolicy }) {
      const next = await checkExperientialRecord('gatePolicy', plan);
      if (!next.ok) return next;
      if (!equalsJson(plan, context.next) || next.value.scope !== context.previous.scope)
        return refuseExperiential('TEXP1002', '/policy', 'The policy differs from its guarded preparation.');
      return options.commit(next.value, context.previous);
    },
  });
  try {
    const result = await guarded.commit(captured.value);
    if (result.ok) return result.value as ExperientialResult<ExperientialGatePolicy>;
    if (result.stage === 'commit') return refuseExperiential('TEXP1002', '/policy', 'The guarded policy revision was refused.',
      experientialNativeCause(result.cause) ?? { code: 'GUARDED', path: '', detail: 'Guarded publication failed.' });
    const cause = result.errors[0] as { code?: string; path?: string; docPath?: string; detail?: string; message?: string } | undefined;
    return refuseExperiential('TEXP1002', '/policy', 'The guarded policy revision was refused.', {
      code: cause?.code ?? 'GUARDED', path: cause?.path ?? cause?.docPath ?? '', detail: 'Guarded validation or publication failed.',
    });
  } catch (error) {
    return refuseExperiential('TEXP1009', '/policy', 'The policy reader failed before publication.',
      experientialNativeCause(error) ?? { code: 'GUARDED', path: '', detail: 'The injected read failed.' });
  }
}
