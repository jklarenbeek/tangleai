/** Frozen evaluation registrations and pure approval plans, applied atomically by the store. */
import { deepFreeze, equalsJson } from '@jarenjs/core/object';
import { checkExperientialRecord, experientialEvaluationRegistrationId, sealExperientialRecord } from './identity.ts';
import { evaluateExperientialGates, EXPERIENTIAL_EVALUATION_ROWS } from './gates.ts';
import { validateExperientialRecord, validateExperientialShape } from './schema.ts';
import { experientialIssue, refuseExperiential, type ExperientialResult } from './errors.ts';
import type { ExperientialArtifact, ExperientialDataset, ExperientialEvaluation, ExperientialEvaluationMetrics,
  ExperientialEvaluationRegistration, ExperientialGatePolicy, ExperientialHead, ExperientialIssue } from './contracts.gen.ts';

export interface ExperientialEvaluationInput {
  artifact: ExperientialArtifact;
  baseline: ExperientialArtifact;
  dataset: ExperientialDataset;
  policy: ExperientialGatePolicy;
  head: ExperientialHead;
  evaluatorRevision: string;
  questionSetId: string;
  sampleCount: number;
  recordedAt: string;
  migrationExperiment?: boolean;
}
export interface ExperientialEvaluationPlan {
  before: ExperientialArtifact;
  after: ExperientialArtifact;
  baseline: ExperientialArtifact;
  dataset: ExperientialDataset;
  policy: ExperientialGatePolicy;
  head: ExperientialHead;
  registration: ExperientialEvaluationRegistration;
}
export interface ExperientialEvaluationResultPlan {
  before: ExperientialArtifact;
  after: ExperientialArtifact;
  evaluation: ExperientialEvaluation;
  issues: ExperientialIssue[];
}
const baseOf = (artifact: ExperientialArtifact) => artifact.kind === 'base' ? artifact.id : artifact.baseArtifactId;

export async function planExperientialEvaluation(input: ExperientialEvaluationInput): Promise<ExperientialResult<ExperientialEvaluationPlan>> {
  // Each validator snapshots synchronously, before the first digest can suspend.
  const pending = [checkExperientialRecord('artifact', input?.artifact), checkExperientialRecord('artifact', input?.baseline),
    checkExperientialRecord('dataset', input?.dataset), checkExperientialRecord('gatePolicy', input?.policy), checkExperientialRecord('head', input?.head)] as const;
  const raw = { evaluatorRevision: input?.evaluatorRevision, questionSetId: input?.questionSetId, sampleCount: input?.sampleCount,
    recordedAt: input?.recordedAt, migrationExperiment: input?.migrationExperiment ?? false };
  const [a, b, d, p, h] = await Promise.all(pending);
  for (const result of [a, b, d, p, h]) if (!result.ok) return result;
  if (!a.ok || !b.ok || !d.ok || !p.ok || !h.ok) throw new TypeError('Unreachable record validation.');
  const artifact = a.value, baseline = b.value, dataset = d.value, policy = p.value, head = h.value;
  if (new Set([artifact.scope, baseline.scope, dataset.scope, policy.scope, head.scope]).size !== 1)
    return refuseExperiential('TEXP1005', '/scope', 'Every evaluation input must share the registered scope.');
  if (artifact.kind === 'base' || artifact.state !== 'staged' || artifact.evaluationRegistration)
    return refuseExperiential('TEXP1006', '/artifact', 'Only an unregistered staged learned artifact may start evaluation.');
  if (!raw.migrationExperiment && baseOf(artifact) !== baseOf(baseline))
    return refuseExperiential('TEXP1002', '/baselineArtifactId', 'Different base identities require an explicit migration experiment.');
  if (head.head.versionId === null ? baseline.kind !== 'base' : head.head.versionId !== baseline.id || baseline.state !== 'active')
    return refuseExperiential('TEXP1002', '/baselineArtifactId', 'The baseline must be the captured active artifact or registered base.');
  const shape = validateExperientialShape<ExperientialEvaluationRegistration>('ExperientialEvaluationRegistration', {
    id: '0'.repeat(64), scope: artifact.scope, artifactId: artifact.id, baselineArtifactId: baseline.id, datasetId: dataset.id,
    gatePolicyId: policy.id, profile: head.profile, expectedHead: head.head, ...raw,
  });
  if (!shape.ok) return shape;
  const registration = { ...shape.value, id: await experientialEvaluationRegistrationId(shape.value) };
  const after = validateExperientialRecord('artifact', { ...artifact, state: 'evaluating', evaluationRegistration: registration });
  if (!after.ok) return after;
  return { ok: true, value: deepFreeze({ before: artifact, after: after.value, baseline, dataset, policy, head, registration }) };
}

/** Complete the required-row census before the pure gate records its decision. */
export async function createExperientialEvaluation(input: {
  registration: ExperientialEvaluationRegistration;
  policy: ExperientialGatePolicy;
  measurements: ExperientialEvaluationMetrics;
  reportId: string;
  recordedAt: string;
}): Promise<ExperientialResult<ExperientialEvaluation>> {
  const r = validateExperientialShape<ExperientialEvaluationRegistration>('ExperientialEvaluationRegistration', input?.registration);
  const p = checkExperientialRecord('gatePolicy', input?.policy);
  const m = validateExperientialShape<ExperientialEvaluationMetrics>('ExperientialEvaluationMetrics', input?.measurements);
  const reportId = input?.reportId, recordedAt = input?.recordedAt;
  const policy = await p;
  if (!r.ok) return r; if (!policy.ok) return policy; if (!m.ok) return m;
  const registration = r.value;
  if (registration.id !== await experientialEvaluationRegistrationId(registration) || registration.gatePolicyId !== policy.value.id
    || m.value.gatePolicyId !== registration.gatePolicyId || m.value.scope !== registration.scope
    || policy.value.scope !== registration.scope || m.value.migrationExperiment !== registration.migrationExperiment)
    return refuseExperiential('TEXP1002', '/registration', 'Evaluation observations must use the policy and scope registered before the run.');
  if (new Set(m.value.rows.map(row => row.rowId)).size !== m.value.rows.length)
    return refuseExperiential('TEXP1001', '/rows', 'Each registered row occurs at most once.');
  const rows = EXPERIENTIAL_EVALUATION_ROWS.map(rowId => m.value.rows.find(row => row.rowId === rowId)
    ?? { rowId, status: 'not-run' as const, cgc: null, retention: null, failures: 0, cost: null, identityId: null, samples: 0 });
  const measurements = { ...m.value, rows };
  const gate = evaluateExperientialGates(measurements, policy.value);
  const failures = [...gate.failures];
  if (rows.some(row => row.status === 'run' && row.samples !== registration.sampleCount)
    || measurements.interval.some(interval => interval.pairs !== registration.sampleCount))
    failures.push({ gate: 'binding', detail: 'The observed coverage differs from the frozen question set.', observed: null, tolerance: registration.sampleCount });
  return sealExperientialRecord('evaluation', { document: 'experiential-evaluation', schemaVersion: 1, recordedAt,
    artifactId: registration.artifactId, baselineArtifactId: registration.baselineArtifactId, registrationId: registration.id,
    datasetId: registration.datasetId, evaluatorRevision: registration.evaluatorRevision,
    profile: registration.profile, expectedHead: registration.expectedHead,
    reportId, ...measurements, passed: failures.length === 0, failures });
}

/** The returned rejected plan is still retained; TEXP1010 explains each failed gate. */
export async function recordExperientialEvaluation(input: {
  artifact: ExperientialArtifact;
  baseline: ExperientialArtifact;
  dataset: ExperientialDataset;
  policy: ExperientialGatePolicy;
  evaluation: ExperientialEvaluation;
}): Promise<ExperientialResult<ExperientialEvaluationResultPlan>> {
  const [a, b, d, p, e] = await Promise.all([checkExperientialRecord('artifact', input?.artifact), checkExperientialRecord('artifact', input?.baseline),
    checkExperientialRecord('dataset', input?.dataset), checkExperientialRecord('gatePolicy', input?.policy), checkExperientialRecord('evaluation', input?.evaluation)]);
  for (const result of [a, b, d, p, e]) if (!result.ok) return result;
  if (!a.ok || !b.ok || !d.ok || !p.ok || !e.ok) throw new TypeError('Unreachable record validation.');
  const artifact = a.value, registration = artifact.evaluationRegistration, evaluation = e.value;
  if (artifact.state !== 'evaluating' || !registration) return refuseExperiential('TEXP1006', '/artifact', 'A frozen evaluation registration must precede its result.');
  if (new Set([artifact.scope, b.value.scope, d.value.scope, p.value.scope, evaluation.scope]).size !== 1)
    return refuseExperiential('TEXP1005', '/scope', 'Evaluation records must retain one scope.');
  if (evaluation.artifactId !== artifact.id || evaluation.baselineArtifactId !== b.value.id || evaluation.datasetId !== d.value.id
    || evaluation.gatePolicyId !== p.value.id || evaluation.registrationId !== registration.id || evaluation.datasetId !== registration.datasetId
    || evaluation.baselineArtifactId !== registration.baselineArtifactId || evaluation.gatePolicyId !== registration.gatePolicyId
    || evaluation.evaluatorRevision !== registration.evaluatorRevision || evaluation.profile !== registration.profile
    || !equalsJson(evaluation.expectedHead, registration.expectedHead) || evaluation.migrationExperiment !== registration.migrationExperiment
    || evaluation.recordedAt < registration.recordedAt || !registration.migrationExperiment && baseOf(artifact) !== baseOf(b.value))
    return refuseExperiential('TEXP1002', '/registration', 'The evaluation differs from the pre-registered artifact, baseline, dataset, policy, evaluator or head.');
  if (evaluation.operations.artifactBytes !== null && evaluation.operations.artifactBytes !== artifact.sizeBytes
    || evaluation.operations.runtimeProvider !== null && evaluation.operations.runtimeProvider !== artifact.runtime.provider)
    return refuseExperiential('TEXP1002', '/operations', 'Operational observations must bind the candidate receipt and runtime.');
  const reproduced = await createExperientialEvaluation({ registration, policy: p.value, reportId: evaluation.reportId,
    recordedAt: evaluation.recordedAt, measurements: evaluationMetricsOf(evaluation) });
  if (!reproduced.ok) return reproduced;
  if (!equalsJson(reproduced.value, evaluation)) return refuseExperiential('TEXP1002', '/passed', 'The claimed evaluation decision differs from its recorded measurements.');
  const after = validateExperientialRecord('artifact', { ...artifact, state: evaluation.passed ? 'approved' : 'rejected' });
  if (!after.ok) return after;
  return { ok: true, value: deepFreeze({ before: artifact, after: after.value, evaluation,
    issues: evaluation.failures.map((failure, index) => experientialIssue('TEXP1010', '/failures/' + index,
      failure.gate + ': ' + failure.detail)) }) };
}

export function evaluationMetricsOf(evaluation: ExperientialEvaluation): ExperientialEvaluationMetrics {
  const { scope, gatePolicyId, migrationExperiment, rows, interval, retention, security, operations, cost } = evaluation;
  return { scope, gatePolicyId, migrationExperiment, rows, interval, retention, security, operations, cost };
}
