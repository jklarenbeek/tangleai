/** Pure transition plans. Applying a plan requires a fresh transactional read. */
import { deepFreeze } from '@jarenjs/core/object';
import { assertHead, planHeadTransition, type Head, type OutcomeIssue } from '@tangleai/outcomes';
import { validateExperientialRecord, type ExperientialRecordMap } from './schema.ts';
import { refuseExperiential, type ExperientialResult } from './errors.ts';
import type { ExperientialApproval, ExperientialArtifact, ExperientialEvaluation, ExperientialHead, ExperientialDeployment } from './contracts.gen.ts';

export const EXPERIENCE_TRANSITIONS = deepFreeze({
  observed: ['quarantined', 'eligible'], quarantined: [], eligible: ['selected', 'excluded'], selected: [], excluded: [], archived: [],
} as const);
export const TRAINING_TRANSITIONS = deepFreeze({
  queued: ['preparing', 'failed', 'cancelled'], preparing: ['training', 'failed', 'cancelled'],
  training: ['materializing', 'failed', 'cancelled'], materializing: ['complete', 'failed', 'cancelled'],
  complete: [], failed: [], cancelled: [],
} as const);
export const ARTIFACT_TRANSITIONS = deepFreeze({
  staged: ['evaluating'], evaluating: ['rejected', 'approved'], rejected: [], approved: ['canary'],
  canary: ['active'], active: ['archived'], archived: [],
} as const);

export type ExperientialStateKind = 'experience' | 'trainingRun' | 'artifact';
export interface ExperientialTransitionPlan<K extends ExperientialStateKind = ExperientialStateKind> {
  kind: K;
  before: ExperientialRecordMap[K];
  after: ExperientialRecordMap[K];
}
const edges = { experience: EXPERIENCE_TRANSITIONS, trainingRun: TRAINING_TRANSITIONS, artifact: ARTIFACT_TRANSITIONS };

function transition<K extends ExperientialStateKind>(kind: K, record: ExperientialRecordMap[K], next: ExperientialRecordMap[K]['state']): ExperientialResult<ExperientialTransitionPlan<K>> {
  const checked = validateExperientialRecord(kind, record);
  if (!checked.ok) return checked;
  const before = checked.value;
  const allowed = (edges[kind] as Record<string, readonly string[]>)[before.state];
  if (!allowed?.includes(next)) return refuseExperiential('TEXP1006', '/state', `The ${before.state} → ${String(next)} transition is not allowed.`);
  const after = validateExperientialRecord(kind, { ...before, state: next });
  if (!after.ok) return after;
  return { ok: true, value: deepFreeze({ kind, before, after: after.value }) };
}

export const planExperienceTransition = (record: ExperientialRecordMap['experience'], next: ExperientialRecordMap['experience']['state']) => transition('experience', record, next);
export const planTrainingTransition = (record: ExperientialRecordMap['trainingRun'], next: ExperientialRecordMap['trainingRun']['state']) => transition('trainingRun', record, next);
export const planArtifactTransition = (record: ExperientialRecordMap['artifact'], next: ExperientialRecordMap['artifact']['state']) => transition('artifact', record, next);

/** Native comparison is the sole CAS owner; capacity is checked separately. */
function headOperation(actual: Head, expected: Head, target?: string): ExperientialResult<Head> {
  let head: Head;
  try { if (target === undefined) { assertHead(actual, expected); head = actual; } else head = planHeadTransition(actual, expected, target); }
  catch (error) {
    const cause = (error as { issues?: OutcomeIssue[] })?.issues?.find(issue => issue.code === 'OUTC1013');
    if (!cause) throw error;
    return refuseExperiential('TEXP1007', '/expectedHead', 'The deployment head has changed.', cause);
  }
  if (!Number.isSafeInteger(head.revision)) return refuseExperiential('TEXP1009', '/head/revision', 'The head revision capacity is exhausted.');
  return { ok: true, value: deepFreeze(head) };
}

export const planExperientialHead = (actual: Head, expected: Head, target: string) => headOperation(actual, expected, target);
export const checkExperientialHead = (actual: Head, expected: Head) => headOperation(actual, expected);

export interface ExperientialActivationInput {
  head: ExperientialHead;
  deployment: ExperientialDeployment;
  artifact: ExperientialArtifact;
  evaluation: ExperientialEvaluation;
  approval: ExperientialApproval;
}
export interface ExperientialRollbackInput extends ExperientialActivationInput { reason: string }
export interface ExperientialActivationPlan extends ExperientialActivationInput {
  action: 'canary' | 'activate' | 'rollback';
  reason: string | null;
  nextHead: Head;
  nextDeployment: ExperientialDeployment;
}

function activation(input: ExperientialActivationInput, action: 'canary' | 'activate' | 'rollback', reason: unknown = null): ExperientialResult<ExperientialActivationPlan> {
  const head = validateExperientialRecord('head', input?.head);
  const deployment = validateExperientialRecord('deployment', input?.deployment);
  const artifact = validateExperientialRecord('artifact', input?.artifact);
  const evaluation = validateExperientialRecord('evaluation', input?.evaluation);
  const approval = validateExperientialRecord('approval', input?.approval);
  for (const result of [head, deployment, artifact, evaluation, approval]) if (!result.ok) return result;
  if (!head.ok || !deployment.ok || !artifact.ok || !evaluation.ok || !approval.ok) throw new TypeError('Unreachable validation state.');
  const h = head.value, d = deployment.value, a = artifact.value, e = evaluation.value, p = approval.value;
  if (action === 'rollback' && (typeof reason !== 'string' || !reason.trim() || reason.length > 4096))
    return refuseExperiential('TEXP1001', '/reason', 'Rollback requires a bounded nonempty reason.');
  if (new Set([h.scope, d.scope, a.scope, e.scope, p.scope]).size !== 1 || h.profile !== p.profile || h.profile !== d.profile)
    return refuseExperiential('TEXP1005', '/scope', 'Deployment, head, artifact, evaluation and approval must share one profile and scope.');
  // Native CAS runs before state checks so a competing activation retains its
  // stale-head cause even when it has already changed the artifact state.
  const next = planExperientialHead(h.head, p.expectedHead, a.id);
  if (!next.ok) return next;
  const revision = planExperientialHead({ versionId: d.id, revision: d.revision },
    { versionId: p.deploymentId, revision: p.expectedDeploymentRevision }, d.id);
  if (!revision.ok) return revision;
  if (d.activeArtifactId !== h.head.versionId || d.headRevision !== h.head.revision)
    return refuseExperiential('TEXP1002', '/deployment', 'The deployment does not reproduce the retained head.');
  if (p.action !== action || p.artifactId !== a.id || p.evaluationId !== e.id || e.artifactId !== a.id
    || !e.passed || e.failures.length || !p.reason.trim())
    return refuseExperiential('TEXP1006', '/approval', 'The approval must bind a passing evaluation of this artifact and action.');
  if (!a.evaluationRegistration || a.evaluationRegistration.id !== e.registrationId || e.profile !== h.profile
    || action !== 'rollback' && (e.expectedHead.versionId !== p.expectedHead.versionId || e.expectedHead.revision !== p.expectedHead.revision))
    return refuseExperiential('TEXP1002', '/evaluation', 'Activation must bind the registered evaluation, profile and expected head.');
  if (a.kind === 'base' || action !== 'rollback' && a.baseArtifactId !== d.baseArtifactId && a.baseArtifactId !== h.head.versionId)
    return refuseExperiential('TEXP1002', '/artifact/baseArtifactId', 'The candidate must extend the registered base or the captured active artifact.');
  if (a.runtime.provider !== d.base.provider || a.runtime.base !== d.base.base)
    return refuseExperiential('TEXP1008', '/artifact/runtime', 'The artifact must use the registered deployment endpoint.');
  if (action === 'canary') {
    if (a.state !== 'approved' || d.canaryArtifactId !== null)
      return refuseExperiential('TEXP1006', '/canaryArtifactId', 'Canary admission requires an approved artifact and an empty canary slot.');
  } else if (action === 'activate') {
    if (!['approved', 'canary'].includes(a.state) || a.state === 'canary' && d.canaryArtifactId !== a.id
      || d.canaryArtifactId !== null && d.canaryArtifactId !== a.id)
      return refuseExperiential('TEXP1006', '/artifact/state', "Activation requires an approved artifact or this deployment's canary.");
    if (h.head.versionId === a.id) return refuseExperiential('TEXP1006', '/artifactId', 'The target is already active.');
  } else {
    if (a.id !== d.expectedParentArtifactId || !['active', 'archived'].includes(a.state) || p.reason !== reason)
      return refuseExperiential('TEXP1006', '/expectedParentArtifactId', 'Rollback must restore the exact prior artifact for the approved reason.');
    if (a.id === h.head.versionId && d.canaryArtifactId === null)
      return refuseExperiential('TEXP1006', '/artifactId', 'The rollback target is already active without a canary to withdraw.');
  }
  const nextHead = action === 'canary' ? h.head : next.value;
  const nextDeployment = validateExperientialRecord('deployment', { ...d,
    activeArtifactId: nextHead.versionId, headRevision: nextHead.revision,
    canaryArtifactId: action === 'canary' ? a.id : null, rolloutFraction: action === 'canary' ? p.rolloutFraction : 0,
    expectedParentArtifactId: action === 'rollback' && a.id === h.head.versionId ? null : h.head.versionId,
    approvalId: p.id, revision: revision.value.revision, rollbackReason: action === 'rollback' ? reason : null });
  if (!nextDeployment.ok) return nextDeployment;
  return { ok: true, value: deepFreeze({ action, reason: action === 'rollback' ? reason as string : null,
    head: h, deployment: d, artifact: a, evaluation: e, approval: p, nextHead, nextDeployment: nextDeployment.value }) };
}

/** Canary and full activation share one approval and CAS planner. */
export const planExperientialActivation = (input: ExperientialActivationInput) => activation(input, input?.approval?.action === 'canary' ? 'canary' : 'activate');
/** Application additionally proves the target's retained activation history. */
export const planExperientialRollback = (input: ExperientialRollbackInput) => activation(input, 'rollback', input?.reason);
