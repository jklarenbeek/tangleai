/** Every HERA activation delegates version-and-revision fencing to outcomes. */
import { planHeadTransition } from '@tangleai/outcomes';
import { heraRefuse, type HeraOutcome } from './errors.ts';
import type { HeraHead, HeraPromptVersion, HeraLearningSnapshot, HeraExperience } from './contracts.gen.ts';
import {heraLibraryRevisionOf} from './identity.ts';

export interface HeraHeadPlan {
  expected: HeraHead;
  next: HeraHead;
  changes: Array<{ kind: 'promptVersion' | 'snapshot' | 'experience'; id: string; from: string; to: string }>;
  membership?:{previousIds:string[];nextIds:string[]};
}
/** JSON tuples keep opaque scopes and keys distinct, including embedded separators. */
export function heraHeadId(scope: string, kind: HeraHead['kind'], key = ''): string {
  return JSON.stringify([scope, kind, key]);
}
export function emptyHeraHead(scope: string, kind: HeraHead['kind'], key = ''): HeraHead {
  return { id: heraHeadId(scope, kind, key), scope, kind, versionId: null, revision: 0 };
}
export function planHeraHeadTransition(actual: HeraHead, expected: HeraHead, target: string): HeraOutcome<HeraHeadPlan> {
  if (actual.id !== expected.id || actual.scope !== expected.scope || actual.kind !== expected.kind)
    return heraRefuse('THERA1006', '/expected', 'The head identity differs.');
  try {
    const next = planHeadTransition({ versionId: actual.versionId, revision: actual.revision }, { versionId: expected.versionId, revision: expected.revision }, target);
    return { valid: true, value: { expected: structuredClone(expected), next: { ...actual, ...next }, changes: [] } };
  } catch (error) {
    const issues = error && typeof error === 'object' && 'issues' in error ? error.issues : null;
    if (Array.isArray(issues) && issues.every(issue => issue.code === 'OUTC1013'))
      return heraRefuse('THERA1006', '/expected', 'The expected head version or revision is stale.', issues);
    throw error;
  }
}
export function planLibraryActivation(actual: HeraHead, expected: HeraHead, revision: string): HeraOutcome<HeraHeadPlan> {
  if (actual.kind !== 'library') return heraRefuse('THERA1006', '/kind', 'A library activation requires a library head.');
  return planHeraHeadTransition(actual, expected, revision);
}
/** Membership is part of a learning transition; pure planning never mutates versions. */
export async function planHeraLibraryTransition(actual:HeraHead,expected:HeraHead,previous:readonly HeraExperience[],next:readonly HeraExperience[]):Promise<HeraOutcome<HeraHeadPlan>>{
  const previousIds=previous.map(e=>e.id).sort(),nextIds=next.map(e=>e.id).sort();
  if(new Set(previousIds).size!==previousIds.length||new Set(nextIds).size!==nextIds.length
    ||[...previous,...next].some(e=>e.scope!==actual.scope||e.status!=='active'))return heraRefuse('THERA1006','/membership','A library transition requires unique active versions in one scope.');
  if(actual.versionId!==await heraLibraryRevisionOf(previousIds)&&!(actual.versionId===null&&previousIds.length===0))return heraRefuse('THERA1006','/membership','The previous membership differs from the library head.');
  const planned=planLibraryActivation(actual,expected,await heraLibraryRevisionOf(nextIds));if(!planned.valid)return planned;
  planned.value.membership={previousIds,nextIds};
  planned.value.changes=previous.filter(e=>!nextIds.includes(e.id)).map(e=>({kind:'experience',id:e.id,from:'active',to:'archived'}));
  return planned;
}
export function planPromptActivation(actual: HeraHead, expected: HeraHead, candidate: HeraPromptVersion, previous?: HeraPromptVersion): HeraOutcome<HeraHeadPlan> {
  if (actual.id !== heraHeadId(candidate.scope, 'prompt', candidate.agentId) || actual.kind !== 'prompt' || candidate.status !== 'candidate' || candidate.parentId !== actual.versionId)
    return heraRefuse('THERA1006', '/promptVersion', 'Prompt scope, parent or candidate status differs from the head.');
  if ((actual.versionId !== null && !previous) || (previous && (previous.id !== actual.versionId || previous.agentId !== candidate.agentId || previous.scope !== candidate.scope || previous.status !== 'active')))
    return heraRefuse('THERA1006', '/previous', 'The active prompt does not match the expected head.');
  const plan = planHeraHeadTransition(actual, expected, candidate.id);
  if (!plan.valid) return plan;
  plan.value.changes = [ ...(previous ? [{ kind: 'promptVersion' as const, id: previous.id, from: 'active', to: 'archived' }] : []),
    { kind: 'promptVersion', id: candidate.id, from: 'candidate', to: 'active' } ];
  return plan;
}
/** Rollback preserves the archived content address and advances the same revision fence. */
export function planPromptRollback(actual:HeraHead,expected:HeraHead,target:HeraPromptVersion,previous:HeraPromptVersion):HeraOutcome<HeraHeadPlan>{
  if(actual.kind!=='prompt'||actual.id!==heraHeadId(target.scope,'prompt',target.agentId)||target.status!=='archived'
    ||previous.id!==actual.versionId||previous.status!=='active'||previous.scope!==target.scope||previous.agentId!==target.agentId||previous.envelopeRevision!==target.envelopeRevision)
    return heraRefuse('THERA1006','/promptVersion','Rollback requires the current active role and an archived version of its same envelope.');
  const plan=planHeraHeadTransition(actual,expected,target.id);if(!plan.valid)return plan;
  plan.value.changes=[{kind:'promptVersion',id:previous.id,from:'active',to:'archived'},{kind:'promptVersion',id:target.id,from:'archived',to:'active'}];return plan;
}
export function planSnapshotActivation(actual: HeraHead, expected: HeraHead, candidate: HeraLearningSnapshot, previous?: HeraLearningSnapshot): HeraOutcome<HeraHeadPlan> {
  if (actual.id !== heraHeadId(candidate.scope, 'snapshot') || actual.kind !== 'snapshot' || candidate.status !== 'staged' || candidate.parentId !== actual.versionId)
    return heraRefuse('THERA1006', '/snapshot', 'Snapshot scope, parent or staged status differs from the head.');
  if ((actual.versionId !== null && !previous) || (previous && (previous.id !== actual.versionId || previous.scope !== candidate.scope || previous.status !== 'active')))
    return heraRefuse('THERA1006', '/previous', 'The active snapshot does not match the expected head.');
  const plan = planHeraHeadTransition(actual, expected, candidate.id);
  if (!plan.valid) return plan;
  plan.value.changes = [ ...(previous ? [{ kind: 'snapshot' as const, id: previous.id, from: 'active', to: 'archived' }] : []),
    { kind: 'snapshot', id: candidate.id, from: 'staged', to: 'active' } ];
  return plan;
}
