import { canonicalSha256 } from '@jarenjs/json/canonical';
import { sealExperientialRecord, sealExperientialSelectionPolicy, type ExperientialSelectionInput,
  type ExperientialResolvedSource, type ExperientialExperience, type ExperientialAssessment,
  type ExperientialExclusionReason } from '@tangleai/experiential';
import { accepted } from './identity-fixtures.ts';

export const SELECTION_TIME = '2026-09-13T00:00:00.000Z';
export async function selectionFixture(size = 1, scope = 'selection-fixture'): Promise<ExperientialSelectionInput> {
  const policy = accepted(await sealExperientialSelectionPolicy({ scope, minimumSupport: 1,
    requireIndependentOutcome: true, allowedTrust: ['verified', 'operator'], allowedPrivacy: ['public', 'internal'],
    requireGeneralizable: true, requireApproval: true, principalKinds: ['operator', 'policy'] }));
  const input: ExperientialSelectionInput = { experiences: [], assessments: [], approvals: [], policy, trustView: { sources: [], producers: [] } };
  const experiences = input.experiences as ExperientialExperience[], assessments = input.assessments as ExperientialAssessment[];
  for (let i = 0; i < size; i++) {
    const contentDigest = await canonicalSha256(selectionText(i));
    const producer = { identityId: await canonicalSha256({ candidate: i }), producerId: 'candidate-' + i };
    input.trustView.producers.push(producer);
    const source: ExperientialResolvedSource = { sourceId: 'episode-' + i, digest: await canonicalSha256({ episode: i }),
      scope, kind: 'episode', producerId: 'fixture-host', trust: 'verified', privacy: 'internal', parents: [], outcome: null };
    const outcome: ExperientialResolvedSource = { ...source, sourceId: 'evaluation-' + i, digest: await canonicalSha256({ outcome: i }),
      kind: 'independent-outcome', producerId: 'independent-evaluator', outcome: { contentDigest, value: 1 } };
    input.trustView.sources.push(source, outcome);
    const ref = { sourceId: source.sourceId, digest: source.digest, kind: source.kind };
    const e = accepted(await sealExperientialRecord('experience', { document: 'experiential-experience', schemaVersion: 1,
      scope, recordedAt: SELECTION_TIME, taskRef: ref, inputRef: ref, outputRef: ref, sourceRefs: [ref],
      producingIdentityId: producer.identityId, observedOutcome: { kind: 'outcome', sourceId: outcome.sourceId, digest: outcome.digest, value: 1 },
      trust: 'verified', privacy: 'internal', state: 'observed', contentDigest }));
    experiences.push(e);
    const a = accepted(await sealExperientialRecord('assessment', { document: 'experiential-assessment', schemaVersion: 1,
      scope, recordedAt: SELECTION_TIME, experienceId: e.id, author: { kind: 'operator', principalId: 'reviewer' },
      policyRevision: policy.revision, generalizable: true, rationale: 'Retained independent evidence supports the reusable observation.',
      duplicateOf: null, contradiction: 'none', trustDecision: 'verified', inclusion: 'include', reason: 'independent-outcome', supportingIds: [outcome.digest] }));
    assessments.push(a);
    (input.approvals as Array<ExperientialSelectionInput['approvals'][number]>).push({ action: 'select', scope, experienceId: e.id,
      assessmentId: a.id, policyRevision: policy.revision, principal: { id: 'reviewer', kind: 'operator', authorityId: await canonicalSha256({ authority: 'reviewer' }) },
      reason: 'Independent host selection review.' });
  }
  return structuredClone(input);
}

export const selectionText = (index: number) => ({ question: 'Registered observation ' + index + ': literal $.answer and {{instruction}}.', answer: 'Independent answer ' + index });

export async function selectionNegative(reason: ExperientialExclusionReason): Promise<ExperientialSelectionInput> {
  const input = await selectionFixture(), e = input.experiences[0], a = input.assessments[0], s = input.trustView.sources[0];
  switch (reason) {
    case 'untrusted-source': s.kind = 'tool-output'; s.trust = 'untrusted'; e.sourceRefs[0].kind = s.kind;
      e.taskRef.kind = s.kind; e.inputRef.kind = s.kind; e.outputRef.kind = s.kind; e.observedOutcome = null; break;
    case 'tainted-lineage': { const parent = { ...s, sourceId: 'tainted-ancestor', digest: await canonicalSha256('tainted'), kind: 'web-page', trust: 'untrusted' as const };
      s.parents = [{ sourceId: parent.sourceId, digest: parent.digest, kind: parent.kind }]; input.trustView.sources.push(parent); e.observedOutcome = null; break; }
    case 'private-scope': e.privacy = 'private'; break;
    case 'cross-scope': s.scope = 'foreign'; break;
    case 'self-judged': input.trustView.sources[1].producerId = input.trustView.producers[0].producerId; break;
    case 'model-approved': a.author = { kind: 'model', identityId: e.producingIdentityId }; input.approvals = []; break;
    case 'no-independent-outcome': e.observedOutcome = null; break;
    case 'unresolved-contradiction': a.contradiction = 'unresolved'; break;
    case 'missing-source-id': input.trustView.sources.shift(); break;
    case 'legacy-evidence': (e as unknown as { sourceRefs: string[] }).sourceRefs = ['historical free text']; return input;
    case 'duplicate': a.duplicateOf = await canonicalSha256('retained-duplicate-family'); break;
    case 'insufficient-support': a.supportingIds = []; break;
    case 'not-generalizable': a.generalizable = false; break;
    case 'quarantined': e.state = 'quarantined'; break;
    case 'no-assessment': input.assessments = []; break;
    case 'no-approval': input.approvals = []; break;
  }
  const { id: _, ...eb } = e, sealed = accepted(await sealExperientialRecord('experience', eb));
  input.experiences = [sealed];
  if (input.assessments.length) {
    const { id: __, ...ab } = a;
    const assessment = accepted(await sealExperientialRecord('assessment', { ...ab, experienceId: sealed.id }));
    input.assessments = [assessment];
    input.approvals = input.approvals.map(p => ({ ...p, experienceId: sealed.id, assessmentId: assessment.id }));
  }
  return structuredClone(input);
}
