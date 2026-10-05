/** Exact admissions, deterministic checks and retained native review records. */
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { equalsJson } from '@jarenjs/core/object';
import type { GmplInput } from '@tangleai/gmpl';
import type { ResearchTaskTools, ResearchStageOperation, ResearchStageAccess, ResearchStageResult } from './handlers.ts';
import type { ResearchRecordWrite } from './records.ts';
import type { ResearchCost, ResearchDraftProposal } from './contracts.gen.ts';
import { immutableResearchJson, researchRevisionOf } from './identity.ts';
import { researchIssue, researchRefuse } from './errors.ts';
import { ResearchFailure, researchFail, researchValue } from './workflow-contract.ts';
import { buildClaimLedger } from './stages/claims.ts';
import { writeResearchDraft, researchDraftProposal } from './stages/write.ts';
import { verifyResearchDraft } from './stages/verify.ts';
import { createResearchReviews } from './stages/review.ts';
import { researchWritingView, researchWritingLedgerView } from './writing-view.ts';
import { readResearchWritingInputs, RESEARCH_WRITING_RECORDS_MEDIA } from './writing-records.ts';
import { readResearchDirective } from './directives.ts';
import { researchWritingRole, researchWritingRevisionOf, RESEARCH_WRITING_CALLS, type ResearchWritingPolicy, type ResearchWritingRuntime } from './writing-contract.ts';

const bytes = (value: unknown) => new TextEncoder().encode(canonicalizeJson(value));
const proposalMedia = 'application/vnd.tangleai.research-writing-proposal+json';
export async function createResearchWritingTools(base: ResearchTaskTools, options: { policy: ResearchWritingPolicy }): Promise<ResearchTaskTools> {
  const policy = immutableResearchJson(options.policy), revision = await researchWritingRevisionOf(policy);
  if (!base.analysis || policy.modelIdentity !== base.binding.runIdentityId
    || !base.binding.toolVersions.some(row => row.name === 'research-writing' && row.version === revision))
    researchFail('TRSH1007', '/writing', 'Writing requires its pinned analysis owner, prompt catalog and run identity.');
  if (base.binding.reservation.calls < RESEARCH_WRITING_CALLS.verify || base.binding.reservation.physical < RESEARCH_WRITING_CALLS.verify)
    researchFail('TRSH1006', '/writing/reservation', 'The writer policy must admit the complete finite native review call bound.');
  async function scoped(operation: ResearchStageOperation, access: ResearchStageAccess) {
    const current = await readResearchWritingInputs(operation, access, policy);
    const ledger = current.ledger ?? researchValue(await buildClaimLedger(current.input));
    if (ledger.claims.length > policy.maxClaims) researchFail('TRSH1006', '/claims', 'The complete ledger exceeds the admitted claim limit.');
    const directive = await readResearchDirective(operation, access);
    const humanReview = directive ? { interventionId: directive.interventionId, text: directive.text,
      proposal: directive.edit?.kind === 'write' ? directive.edit.candidate.proposal : null } : null;
    const view = canonicalizeJson({ ...researchWritingView(current.input, ledger), ...(humanReview ? { humanReview } : {}) });
    if (view.length > policy.maxViewChars) researchFail('TRSH1006', '/view',
      `The complete admitted writer view needs ${view.length} characters; its declared bound is ${policy.maxViewChars}.`);
    return { ...current, ledger, view, humanReview };
  }
  async function reviewInput(operation: ResearchStageOperation, access: ResearchStageAccess) {
    const current = await scoped(operation, access);
    if (!current.draft) researchFail('TRSH1003', '/draft', 'Verification requires the current committed writer draft.');
    const verification = researchValue(await verifyResearchDraft(current.input, current.ledger, current.draft));
    const input: GmplInput = { caseId: operation.attemptId, query: 'Independently review the unchanged research draft and ledger. Preserve every finding; deterministic verification cannot be overridden.',
      evidence: [{ id: current.ledger.id, digest: await researchRevisionOf(current.ledger), text: canonicalizeJson({
        ledger: researchWritingLedgerView(current.ledger), checks: verification.claims,
        observations: current.input.observations.map(({ id, condition, metric, value, unit, seed }) => ({ id, condition, metric, value, unit, seed })) }) },
        { id: current.draft.id, digest: await researchRevisionOf(current.draft), text: canonicalizeJson(current.draft) }],
      payload: { draftId: current.draft.id, ledgerId: current.ledger.id } };
    if (canonicalizeJson(input).length > policy.maxViewChars) researchFail('TRSH1006', '/reviews/view', 'The complete review input exceeds its admitted bound.');
    return { ...current, draft: current.draft, verification, reviewInput: input };
  }
  const envelope = (operation: ResearchStageOperation, records: ResearchRecordWrite[]) => ({ bytes: bytes({ kind: 'writing-records',
    phase: operation.stage, attemptId: operation.attemptId, reviewOrdinal: operation.frame.review + (operation.stage === 'write' ? 1 : 0), value: records }), mediaType: RESEARCH_WRITING_RECORDS_MEDIA });
  const writing: ResearchWritingRuntime = { policy,
    async prepare(operation, access) {
      if (operation.stage === 'write') { const current = await scoped(operation, access); return { variables: { ledger_id: current.ledger.id }, view: current.view }; }
      const current = await reviewInput(operation, access);
      return { ready: current.verification.state === 'verified', input: current.reviewInput };
    },
    async complete(operation, access, proposed, spend: ResearchCost) {
      const proposal = immutableResearchJson(proposed), artifacts = [{ bytes: bytes({ kind: 'research-writing-proposal', phase: operation.stage, proposal }), mediaType: proposalMedia }];
      if (operation.stage === 'write') {
        const current = await scoped(operation, access), records: ResearchRecordWrite[] = [{ kind: 'ResearchClaimLedger', value: current.ledger }];
        const draft = current.humanReview?.proposal && !equalsJson(current.humanReview.proposal, proposal)
          ? researchRefuse('TRSH1005', '/proposal', 'The writer must preserve the exact reviewed edit before independent claim verification.')
          : policy.mode === 'template' && !equalsJson(proposal, researchDraftProposal(current.ledger))
          ? researchRefuse('TRSH1002', '/proposal', 'The native template proposal differs from its exact admitted ledger.')
          : await writeResearchDraft(current.ledger, researchWritingRole('writer', policy), { mode: policy.mode, proposal: proposal as ResearchDraftProposal });
        if (!draft.valid) return { artifacts: [...artifacts, envelope(operation, records)], records, spend, error: draft.issues[0] };
        records.push({ kind: 'Draft', value: draft.value });
        return { artifacts: [...artifacts, envelope(operation, records)], records, spend };
      }
      const current = await reviewInput(operation, access), records: ResearchRecordWrite[] = [{ kind: 'ResearchDraftVerification', value: current.verification }];
      if (current.verification.state === 'refused') {
        if (!equalsJson(proposal, { peer: null, red: null }) || spend.calls !== 0)
          researchFail('TRSH1005', '/reviews', 'Deterministic refusal must bypass every model review.');
        return { artifacts: [...artifacts, envelope(operation, records)], records, spend, error: current.verification.issues[0] };
      }
      const candidate = proposal as { peer?: unknown; red?: unknown };
      if (!candidate || !equalsJson(Object.keys(candidate).sort(), ['peer', 'red']) || candidate.peer === null || candidate.red === null)
        researchFail('TRSH1005', '/reviews', 'A verified draft requires both completed native review results.');
      const reviewed = researchValue(await createResearchReviews(current.draft, current.ledger, current.reviewInput.evidence, [
        { pattern: 'peer-review', result: candidate.peer, independence: researchWritingRole('critic-peer-review-review', policy) },
        { pattern: 'red-team', result: candidate.red, independence: researchWritingRole('judge-red-team-resilience', policy) },
      ]));
      records.push(...reviewed.reviews.map(value => ({ kind: 'Review' as const, value })));
      return { artifacts: [...artifacts, ...reviewed.artifacts, envelope(operation, records)], records, spend,
        ...(!reviewed.accepted ? { error: reviewed.issues[0] ?? researchIssue('TRSH1005', '/reviews', 'Independent review did not accept the draft.') } : {}) };
    },
  };
  return { ...base, writing,
    async verify(operation, result, access) {
      if (!['write', 'verify'].includes(operation.stage)) return base.verify(operation, result, access);
      try {
        const artifact = result.artifacts.find(row => row.mediaType === proposalMedia);
        if (!artifact) researchFail('TRSH1005', '/proposal', 'Writing must retain the exact native proposal, including a refused proposal.');
        const retained = JSON.parse(new TextDecoder().decode(artifact.bytes));
        if (retained.kind !== 'research-writing-proposal' || retained.phase !== operation.stage) researchFail('TRSH1005', '/proposal', 'Writing proposal phase differs.');
        const expected = await writing.complete(operation, access, retained.proposal, result.spend);
        const comparable = (value: ResearchStageResult) => ({ ...value, artifacts: value.artifacts.map(row => ({ ...row, bytes: [...row.bytes] })) });
        if (!equalsJson(comparable(result), comparable(expected))) researchFail('TRSH1002', '/writing', 'Writing records differ from independent deterministic verification.');
        return { valid: true, value: null };
      } catch (cause) { return cause instanceof ResearchFailure ? { valid: false, issues: [cause.issue] }
        : researchRefuse('TRSH1002', '/writing', 'Writing verification failed.', cause); }
    },
  };
}
