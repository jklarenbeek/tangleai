/**
 * Plan/apply guards for skill lifecycle state.
 *
 * Activation is a revision-fenced compare-and-swap: the head planner and its
 * fence are imported from the outcomes package rather than forked here, so a
 * stale revision loses in exactly one place. Eligibility is never structural —
 * a directory becomes activatable because a held-out evaluation said so, and a
 * refused activation leaves the prior head in place with the candidate still
 * readable.
 */
import { equalsJson } from '@jarenjs/core/object';
import { EMPTY_HEAD, planHeadTransition } from '@tangleai/outcomes';
import { trace2SkillRefuse, type Trace2SkillOutcome } from './errors.ts';
import { refuseStaleBase } from './identity.ts';
import type { EvolutionRun, SkillBundle, SkillCandidate, SkillEvaluation, SkillHead } from './contracts.gen.ts';

export const EMPTY_SKILL_HEAD: Readonly<SkillHead> = Object.freeze({ ...EMPTY_HEAD });

type BundleStatus = SkillBundle['status'];
type RunStatus = EvolutionRun['status'];

/**
 * Superseded directories are archived, never deleted: a rollout pins their
 * hash forever, which is also what makes an archived directory reinstatable —
 * its pages are still there and still address the same bytes. Only the fenced
 * swap moves a directory into `active`, in either direction.
 */
const BUNDLE_TRANSITIONS: Readonly<Record<BundleStatus, readonly BundleStatus[]>> = Object.freeze({
  staged: Object.freeze(['eligible', 'rejected']) as readonly BundleStatus[],
  eligible: Object.freeze(['active', 'rejected']) as readonly BundleStatus[],
  active: Object.freeze(['archived']) as readonly BundleStatus[],
  rejected: Object.freeze([]) as readonly BundleStatus[],
  archived: Object.freeze(['active']) as readonly BundleStatus[],
});

const RUN_TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = Object.freeze({
  planned: Object.freeze(['running', 'refused']) as readonly RunStatus[],
  running: Object.freeze(['completed', 'refused']) as readonly RunStatus[],
  completed: Object.freeze([]) as readonly RunStatus[],
  // A run that stopped is resumable, and a drive that resumed it to the end
  // settles where the run actually stopped rather than where it once stopped.
  // The interrupted attempt is not erased by that: its own run-log header
  // settled as an error when it stopped, and the stages it left behind are
  // reused rather than rewritten.
  refused: Object.freeze(['completed']) as readonly RunStatus[],
});

export function planBundleStatus(current: BundleStatus, next: BundleStatus): Trace2SkillOutcome<BundleStatus> {
  if (!BUNDLE_TRANSITIONS[current]?.includes(next))
    return trace2SkillRefuse('TT2S1001', '/status', `a directory does not move from ${current} to ${next}`);
  return { valid: true, value: next };
}

export function planRunStage(current: RunStatus, next: RunStatus): Trace2SkillOutcome<RunStatus> {
  if (!RUN_TRANSITIONS[current]?.includes(next))
    return trace2SkillRefuse('TT2S1001', '/status', `a run does not move from ${current} to ${next}`);
  return { valid: true, value: next };
}

export interface ActivationCandidate { bundleId: string, parentId: string | null }

/** The revision fence lives in the outcomes head planner; its refusal travels as the cause. */
export function planActivation(head: SkillHead, expectedHead: SkillHead, candidate: ActivationCandidate): Trace2SkillOutcome<SkillHead> {
  if (candidate.parentId !== head.versionId)
    return trace2SkillRefuse('TT2S1010', '/parentId', `the candidate's parent is ${String(candidate.parentId)} while the active directory is ${String(head.versionId)}`);
  try { return { valid: true, value: planHeadTransition(head, expectedHead, candidate.bundleId) }; }
  catch (cause) { return trace2SkillRefuse('TT2S1010', '/expectedHead', 'the expected head version or revision is stale', cause); }
}

/**
 * Reinstating a directory that was active before. It is the same fence as an
 * activation and the opposite direction: the target is archived rather than
 * eligible, and its parent is deliberately NOT checked — a rollback walks back
 * over a descendant, so the ancestry test that guards a promotion would refuse
 * every rollback that mattered.
 */
export function planRollback(head: SkillHead, expectedHead: SkillHead, target: { bundleId: string, status: BundleStatus }): Trace2SkillOutcome<SkillHead> {
  if (head.versionId === null)
    return trace2SkillRefuse('TT2S1010', '/head', 'a scope with no active directory has nothing to roll back from');
  if (target.bundleId === head.versionId)
    return trace2SkillRefuse('TT2S1010', '/bundleId', 'the directory named is already the active one');
  if (target.status !== 'archived')
    return trace2SkillRefuse('TT2S1010', '/status', `a rollback reinstates a previously active directory, not a ${target.status} one`);
  try { return { valid: true, value: planHeadTransition(head, expectedHead, target.bundleId) }; }
  catch (cause) { return trace2SkillRefuse('TT2S1010', '/expectedHead', 'the expected head version or revision is stale', cause); }
}

export interface SkillPromotionRegistration {
  scopeKey: string;
  executorIdentityId: string;
  policyVersion: string;
  testHash: string;
  expectedHead: SkillHead;
}

/** The binding checks a promotion must satisfy before the fence is even consulted. */
export function planSkillPromotion(head: SkillHead, candidate: SkillCandidate, evaluation: SkillEvaluation, registration: SkillPromotionRegistration): Trace2SkillOutcome<SkillHead> {
  if (new Set([candidate.scopeKey, evaluation.scopeKey, registration.scopeKey]).size !== 1)
    return trace2SkillRefuse('TT2S1010', '/scopeKey', 'promotion records cross scope');
  if (evaluation.candidateBundleId !== candidate.bundleId)
    return trace2SkillRefuse('TT2S1010', '/candidateBundleId', 'the evaluation does not bind this candidate');
  if (evaluation.split !== 'test' || evaluation.testHash !== registration.testHash)
    return trace2SkillRefuse('TT2S1010', '/testHash', 'eligibility comes only from the registered held-out split');
  if (evaluation.executorIdentityId !== registration.executorIdentityId)
    return trace2SkillRefuse('TT2S1010', '/executorIdentityId', 'the evaluation ran under another executor identity');
  if (evaluation.policyVersion !== registration.policyVersion)
    return trace2SkillRefuse('TT2S1010', '/policyVersion', 'the evaluation ran under another gate policy');
  if (!equalsJson(evaluation.expectedHead, registration.expectedHead))
    return trace2SkillRefuse('TT2S1010', '/expectedHead', 'the evaluation was registered against another head');
  if (evaluation.leakage > 0)
    return trace2SkillRefuse('TT2S1006', '/leakage', `the evaluation counted ${evaluation.leakage} leakage attempts`);
  if (!evaluation.eligible || evaluation.issues.length)
    return trace2SkillRefuse('TT2S1010', '/eligible', 'the held-out evaluation is ineligible');
  if (!candidate.structural.valid || !candidate.semantic.valid)
    return trace2SkillRefuse('TT2S1010', '/structural', 'the candidate carries unresolved validation issues');
  return planActivation(head, registration.expectedHead, candidate);
}

/** A run refuses any unit whose frozen directory differs from the one it pinned. */
export function assertFrozenBase(run: Pick<EvolutionRun, 's0Hash'>, claimed: string, path: string): Trace2SkillOutcome<null> {
  return refuseStaleBase<null>(run.s0Hash, claimed, path) ?? { valid: true, value: null };
}
