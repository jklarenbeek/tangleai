/** Pure transition plans. Applying a plan requires a fresh transactional read. */
import { deepFreeze } from '@jarenjs/core/object';
import { planHeadTransition, type Head, type OutcomeIssue } from '@tangleai/outcomes';
import { validateExperientialRecord, type ExperientialRecordMap } from './schema.ts';
import { refuseExperiential, type ExperientialResult } from './errors.ts';
import type { ExperientialApproval, ExperientialArtifact, ExperientialEvaluation, ExperientialHead } from './contracts.gen.ts';

export const EXPERIENCE_TRANSITIONS = deepFreeze({
  observed: ['quarantined', 'eligible'], quarantined: [], eligible: ['selected', 'excluded'], selected: [], excluded: [],
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
export function planExperientialHead(actual: Head, expected: Head, target: string): ExperientialResult<Head> {
  let head: Head;
  try { head = planHeadTransition(actual, expected, target); }
  catch (error) {
    const cause = (error as { issues?: OutcomeIssue[] })?.issues?.find(issue => issue.code === 'OUTC1013');
    if (!cause) throw error;
    return refuseExperiential('TEXP1007', '/expectedHead', 'The deployment head has changed.', cause);
  }
  if (!Number.isSafeInteger(head.revision)) return refuseExperiential('TEXP1009', '/head/revision', 'The head revision capacity is exhausted.');
  return { ok: true, value: deepFreeze(head) };
}

export interface ExperientialActivationInput {
  head: ExperientialHead;
  artifact: ExperientialArtifact;
  evaluation: ExperientialEvaluation;
  approval: ExperientialApproval;
}
export interface ExperientialActivationPlan extends ExperientialActivationInput {
  action: 'activate' | 'rollback';
  nextHead: Head;
}

function activation(input: ExperientialActivationInput, action: 'activate' | 'rollback'): ExperientialResult<ExperientialActivationPlan> {
  const head = validateExperientialRecord('head', input?.head);
  const artifact = validateExperientialRecord('artifact', input?.artifact);
  const evaluation = validateExperientialRecord('evaluation', input?.evaluation);
  const approval = validateExperientialRecord('approval', input?.approval);
  for (const result of [head, artifact, evaluation, approval]) if (!result.ok) return result;
  if (!head.ok || !artifact.ok || !evaluation.ok || !approval.ok) throw new TypeError('Unreachable validation state.');
  const h = head.value, a = artifact.value, e = evaluation.value, p = approval.value;
  if (new Set([h.scope, a.scope, e.scope, p.scope]).size !== 1 || h.profile !== p.profile)
    return refuseExperiential('TEXP1005', '/scope', 'Head, artifact, evaluation and approval must share one profile and scope.');
  // Check before state: a competing activation may already have changed the
  // artifact state. That contender must retain the native stale-head refusal.
  const next = planExperientialHead(h.head, p.expectedHead, a.id);
  if (!next.ok) return next;
  if (p.action !== action || p.artifactId !== a.id || p.evaluationId !== e.id || e.artifactId !== a.id
    || !e.passed || e.failures.length || !p.reason.trim())
    return refuseExperiential('TEXP1006', '/approval', 'The approval must bind a passing evaluation of this artifact and action.');
  if (!a.evaluationRegistration || a.evaluationRegistration.id !== e.registrationId || e.profile !== h.profile
    || action !== 'rollback' && (e.expectedHead.versionId !== p.expectedHead.versionId || e.expectedHead.revision !== p.expectedHead.revision))
    return refuseExperiential('TEXP1002', '/evaluation', 'Activation must bind the registered evaluation, profile and expected head.');
  if (action === 'activate' ? !['approved', 'canary'].includes(a.state) : a.state !== 'archived')
    return refuseExperiential('TEXP1006', '/artifact/state', 'The target is not in a state eligible for this action.');
  if (h.head.versionId === a.id) return refuseExperiential('TEXP1006', '/artifactId', 'The target is already active.');
  return { ok: true, value: deepFreeze({ action, head: h, artifact: a, evaluation: e, approval: p, nextHead: next.value }) };
}

export const planExperientialActivation = (input: ExperientialActivationInput) => activation(input, 'activate');
/** Store application additionally proves the target was active in this profile's history. */
export const planExperientialRollback = (input: ExperientialActivationInput) => activation(input, 'rollback');
