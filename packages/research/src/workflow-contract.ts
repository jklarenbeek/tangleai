import { identityIdOf, validateRunIdentity, type RunIdentity } from '@tangleai/config';
import { immutableResearchJson, researchRevisionOf } from './identity.ts';
import { researchIssue, type ResearchCode, type ResearchOutcome } from './errors.ts';
import { validateResearchShape } from './schema.ts';
import type { ResearchContract, ResearchCost, ResearchEvaluatorIdentity, ResearchIssue,
  ResearchProject, ResearchToolVersions, ResearchWorkflowFrame, ExperimentPlan, LessonProcedureBinding, LessonInjection,
  ResearchDomainBindingManifest } from './contracts.gen.ts';
import { checkLessonRecord } from './lessons/records.ts';
import type { ResearchStoreOutcome } from './store.ts';
import type { MasValidated } from '@tangleai/mas';

/** Domain refusals retain their typed cause when a native MAS task persists failure. */
export class ResearchFailure extends Error {
  readonly issue: ResearchIssue;
  constructor(issue: ResearchIssue) { super(`${issue.code}: ${issue.detail}`); this.issue = immutableResearchJson(issue); }
}
export function researchFail(code: ResearchCode, path: string, detail: string): never {
  throw new ResearchFailure(researchIssue(code, path, detail));
}
export function researchValue<T>(outcome: ResearchOutcome<T> | ResearchStoreOutcome<T>): T {
  if ('ok' in outcome) { if (outcome.ok) return outcome.value; throw new ResearchFailure(outcome.issue); }
  if (outcome.valid) return outcome.value;
  throw new ResearchFailure(outcome.issues[0]);
}
export function researchMasValue<T>(outcome: MasValidated<T>): T {
  if (outcome.valid) return outcome.value;
  const issue = outcome.issues[0];
  throw new ResearchFailure(researchIssue('TRSH1007', issue.path, issue.detail, issue));
}
export interface ResearchWorkflowBinding {
  id: string;
  contractHash: string;
  runIdentityId: string;
  promptRevision: string;
  toolVersions: ResearchToolVersions;
  evaluator: ResearchEvaluatorIdentity;
  reservation: ResearchCost;
  lessonProcedure?: LessonProcedureBinding;
}
export interface ResearchBindingOptions {
  identity: RunIdentity;
  promptRevision: string;
  toolVersions: ResearchToolVersions;
  evaluator: ResearchEvaluatorIdentity;
  reservation: ResearchCost;
  lessonProcedure?: LessonProcedureBinding;
  domain?: ResearchDomainBindingManifest;
}
/** The host supplies a complete CONFIG result, never an asserted opaque identity. */
export async function createResearchBinding(contract: ResearchContract, options: ResearchBindingOptions): Promise<ResearchWorkflowBinding> {
  const pinned = immutableResearchJson(options), checked = validateRunIdentity(pinned.identity);
  if (!checked.ok) researchFail('TRSH1007', '/identity', 'CONFIG identity does not validate.');
  const c = researchValue(validateResearchShape<ResearchContract>('ResearchContract', contract));
  const { identityId, ...identity } = pinned.identity;
  if (identityId !== await identityIdOf(identity)) researchFail('TRSH1002', '/identity/identityId', 'CONFIG identity does not recompute.');
  const { contractHash, ...body } = c;
  if (contractHash !== await researchRevisionOf(body)) researchFail('TRSH1002', '/contractHash', 'Contract identity does not recompute.');
  if (pinned.lessonProcedure) {
    const procedure = researchValue(validateResearchShape<LessonProcedureBinding>('LessonProcedureBinding', pinned.lessonProcedure));
    if (procedure.injection) {
      const injection = researchValue(await checkLessonRecord<LessonInjection>('LessonInjection', procedure.injection));
      if (injection.bundleHash !== procedure.bundleHash || injection.projectId !== c.projectId || injection.runId !== c.projectId)
        researchFail('TRSH2007', '/lessonProcedure', 'The injection must bind this run and frozen procedure.');
    }
  }
  const domain = pinned.domain ? researchValue(validateResearchShape<ResearchDomainBindingManifest>('ResearchDomainBindingManifest', pinned.domain)) : null;
  const tools = [...pinned.toolVersions, ...(domain ? [{ name: 'research-domain-profile', version: domain.profileRevision }] : [])]
    .sort((a, b) => a.name.localeCompare(b.name));
  if (new Set(tools.map(t => t.name)).size !== tools.length) researchFail('TRSH1002', '/toolVersions', 'Tool names must be unique.');
  researchValue(validateResearchShape('InputManifest', { projectId: c.projectId, stage: 'CREATED', inputs: [],
    promptRevision: pinned.promptRevision, runIdentityId: identityId, toolVersions: tools, evaluator: pinned.evaluator, reservation: pinned.reservation }));
  const value = { contractHash, runIdentityId: identityId, promptRevision: pinned.promptRevision,
    toolVersions: tools, evaluator: pinned.evaluator, reservation: pinned.reservation,
    ...(pinned.lessonProcedure ? { lessonProcedure: pinned.lessonProcedure } : {}) };
  return immutableResearchJson({ ...value, id: await researchRevisionOf(value) });
}
export async function researchProjectHash(project: ResearchProject): Promise<string> {
  const { createdAt: _observedAt, ...content } = researchValue(validateResearchShape<ResearchProject>('ResearchProject', project));
  return researchRevisionOf(content);
}
export async function initialResearchFrame(project: ResearchProject, plan: ExperimentPlan, binding: ResearchWorkflowBinding): Promise<ResearchWorkflowFrame> {
  const owner = researchValue(validateResearchShape<ResearchProject>('ResearchProject', project));
  const p = researchValue(validateResearchShape<ExperimentPlan>('ExperimentPlan', plan)), pinned = immutableResearchJson(binding);
  const { planHash, ...body } = p;
  if (planHash !== await researchRevisionOf(body) || p.projectId !== owner.id || p.contractHash !== pinned.contractHash)
    researchFail('TRSH1002', '/plan', 'The initial plan must bind this project and workflow contract.');
  return researchValue(validateResearchShape<ResearchWorkflowFrame>('ResearchWorkflowFrame', { projectId: owner.id,
    projectHash: await researchProjectHash(owner), planHash, bindingId: pinned.id, status: 'CREATED', artifacts: [], checkpoint: null,
    pivot: 0, attempt: 0, review: 0, decision: null, gate: null, response: null,
    ...(pinned.lessonProcedure ? { lessonProcedure: pinned.lessonProcedure } : {}) }));
}
