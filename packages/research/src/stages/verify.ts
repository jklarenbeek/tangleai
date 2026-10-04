/** Deterministic identity, quotation and numeric checks precede every advisory model review. */
import { validateClaimEvidence } from '@tangleai/context/evidence';
import { cloneJson, equalsJson } from '@jarenjs/core/object';
import { mean } from '@jarenjs/core/stats';
import type { ResearchWritingInputs, ResearchClaimLedger, ResearchDraftVerification, ResearchClaimCheck, ResearchIssue, Draft } from '../contracts.gen.ts';
import { researchIssue, researchRefuse, type ResearchOutcome, type ResearchCode } from '../errors.ts';
import { researchRevisionOf, immutableResearchJson } from '../identity.ts';
import { validateResearchShape } from '../schema.ts';
import { validateResearchDraftLayout } from './write.ts';
import { validateResearchWritingInputs, researchClaimCritical, researchEvidenceId, researchCardStrength,
  researchObservationArtifact, researchObservationQuote, researchDisplayValue, researchMetricText } from './claims.ts';
import { toAdmittedArtifact } from './cards.ts';

const rank = { suggests: 0, supports: 1, exact: 2 } as const;
/** No semantic-entailment claim: support means exact admitted quotation or registered numeric mapping. */
export async function verifyResearchDraft(value: ResearchWritingInputs, candidate: ResearchClaimLedger, proposed: Draft): Promise<ResearchOutcome<ResearchDraftVerification>> {
  try {
    ({ value, candidate, proposed } = immutableResearchJson({ value, candidate, proposed }));
    const admitted = await validateResearchWritingInputs(value); if (!admitted.valid) return admitted;
    const input = admitted.value, ledgerShape = validateResearchShape<ResearchClaimLedger>('ResearchClaimLedger', candidate);
    if (!ledgerShape.valid) return ledgerShape;
    const draftShape = validateResearchShape<Draft>('Draft', proposed); if (!draftShape.valid) return draftShape;
    const ledger = ledgerShape.value, draft = draftShape.value, issues: ResearchIssue[] = [];
    const { id: ledgerId, ...ledgerBody } = ledger, { id: draftId, ...draftBody } = draft;
    if (ledgerId !== 'ledger-' + await researchRevisionOf(ledgerBody) || draftId !== 'draft-' + await researchRevisionOf(draftBody)
      || draft.ledgerId !== ledgerId || draft.projectId !== input.projectId || ledger.projectId !== input.projectId
      || ledger.scope !== input.scope || ledger.decisionId !== (input.decision?.id ?? null) || ledger.analysisId !== (input.analysis?.id ?? null))
      return researchRefuse('TRSH1002', '/draft', 'The draft and ledger must bind their unchanged admitted decision and analysis.');
    const layout = validateResearchDraftLayout({ sections: draft.sections }, ledger); if (!layout.valid) issues.push(...layout.issues);
    const envelope = cloneJson(ledger.envelope);
    const artifacts = [...input.cards.map(toAdmittedArtifact), ...input.observations.map(researchObservationArtifact)];
    if (!equalsJson(ledger.claims.map(claim => claim.id), envelope.claims.map(claim => claim.id)))
      issues.push(researchIssue('TRSH1005', '/envelope/claims', 'The visible ledger and research claim descriptors must have identical claim inventories.'));
    for (const [index, evidence] of envelope.evidence.entries()) {
      const card = input.cards.find(card => researchEvidenceId(card.id) === evidence.id);
      const row = input.observations.find(row => researchEvidenceId(row.id) === evidence.id);
      const expected = card ? { artifact: card.id, selector: '/excerpt', quote: card.excerpt }
        : row ? { artifact: row.id, selector: '/value', quote: researchObservationQuote(row) } : null;
      if (!expected || evidence.artifact !== expected.artifact || evidence.selector !== expected.selector || evidence.quote !== expected.quote)
        issues.push(researchIssue('TRSH1005', '/envelope/evidence/' + index, 'Evidence must reproduce its exact admitted quotation or registry value.'));
    }
    const checks: ResearchClaimCheck[] = [];
    for (const [index, claim] of ledger.claims.entries()) {
      const errors: ResearchIssue[] = [], path = '/claims/' + index, proof = claim.proof;
      const reject = (code: ResearchCode, member: string, detail: string) => errors.push(researchIssue(code, path + member, detail));
      const critical = researchClaimCritical(claim), visible = envelope.claims.find(row => row.id === claim.id);
      if (!visible || visible.text !== claim.text || visible.critical !== critical || !equalsJson(visible.evidence, claim.evidenceIds))
        reject('TRSH1005', '/evidenceIds', 'The visible claim must preserve its exact text, criticality and evidence references.');
      if (!proof) reject('TRSH1005', '/proof', 'Legacy descriptors remain readable but need explicit admitted proof for writing.');
      if (!claim.evidenceIds.length) reject('TRSH1005', '/evidenceIds', 'An evidence-free claim remains unresolved.');
      if (visible?.status === 'unresolved') reject('TRSH1005', '/status', 'The author-declared unresolved claim remains visibly unresolved.');
      for (const id of claim.literatureIds) if (!input.literature.some(record => record.id === id && record.resolution === 'resolved'))
        reject('TRSH1003', '/literatureIds', 'Citation identity is absent or unresolved in the admitted snapshot.');
      if (claim.kind === 'metric' || proof?.type === 'result') {
        const binding = claim.metricBinding, metric = input.contract?.metrics.find(row => row.id === binding?.metric);
        if (claim.kind !== 'metric' || proof?.type !== 'result' || !binding || !metric || metric.unit !== binding.unit
          || !input.plan?.conditions.some(row => row.id === binding.condition))
          reject('TRSH1006', '/metricBinding', 'A result claim must name a registered condition, metric and unit.');
        else {
          const rows = input.observations.filter(row => row.condition === binding.condition && row.metric === binding.metric)
            .sort((a, b) => a.seed - b.seed);
          const selected = binding.aggregate === 'individual' ? rows.filter(row => binding.seeds.includes(row.seed)) : rows;
          const raw = binding.aggregate === 'individual' ? selected[0]?.value : mean(selected.map(row => row.value));
          if (!rows.length || binding.aggregate === 'individual' && (binding.seeds.length !== 1 || selected.length !== 1)
            || !equalsJson(binding.seeds, selected.map(row => row.seed)) || proof.n !== selected.length
            || !equalsJson(claim.observationIds, selected.map(row => row.id))
            || !equalsJson(claim.evidenceIds, selected.map(row => researchEvidenceId(row.id)))
            || raw === undefined || raw === null || binding.value !== researchDisplayValue(raw, metric.roundingDigits)
            || claim.text !== researchMetricText(binding, selected.length) || claim.strength !== 'descriptive'
            || proof.strength !== 'exact' || proof.cardId !== null || proof.quote !== null || proof.citation !== null || claim.literatureIds.length)
            reject('TRSH1002', '/metricBinding', 'The complete registered value, unit, condition, seed set, aggregate and n must match the result sentence.');
        }
      } else if (proof) {
        const card = input.cards.find(card => card.id === proof.cardId), record = input.literature.find(record => record.id === proof.citation?.recordId);
        if (!record || record.resolution !== 'resolved' || !proof.citation || !Object.keys(record.canonicalIds).length
          || !equalsJson(proof.citation.canonicalIds, record.canonicalIds) || !equalsJson(proof.citation.rawHashes, record.rawHashes)
          || !equalsJson(claim.literatureIds, [record.id]))
          reject('TRSH1003', '/proof/citation', 'Canonical citation identifiers and provider raw hashes must match the admitted snapshot.');
        if (!card || !proof.quote || !card.excerpt.includes(proof.quote) || card.literatureId !== record?.id
          || claim.text !== proof.quote || !equalsJson(claim.evidenceIds, card ? [researchEvidenceId(card.id)] : [])
          || claim.observationIds.length || claim.metricBinding !== null || proof.n !== null)
          reject('TRSH1005', '/proof/quote', 'The exact claim quotation must be byte-present in its admitted evidence card.');
        if (claim.strength !== 'descriptive' || card && rank[proof.strength] > rank[researchCardStrength(card)])
          reject('TRSH1005', '/proof/strength', 'Claim strength exceeds the admitted field type; direct quotations do not establish causal entailment.');
      }
      const status = errors.length ? 'unresolved' as const : 'supported' as const;
      if (visible) { visible.status = status; visible.critical = critical; }
      checks.push({ claimId: claim.id, section: claim.section, text: claim.text, critical, status, issues: errors });
    }
    // Keep the deterministic identity/support/numeric diagnosis primary; retain
    // the native critical-claim refusal as its additional structural evidence.
    issues.push(...checks.filter(check => check.critical).flatMap(check => check.issues));
    const native = validateClaimEvidence(envelope, { artifacts });
    if (!native.valid) for (const error of native.errors ?? []) issues.push(researchIssue('TRSH1005', '/envelope', 'Native evidence validation refused the complete draft view.', error));
    const body = { projectId: input.projectId, draftId, ledgerId, state: issues.length ? 'refused' as const : 'verified' as const,
      claims: checks, envelope, issues };
    return validateResearchShape<ResearchDraftVerification>('ResearchDraftVerification', { id: 'verification-' + await researchRevisionOf(body), ...body });
  } catch (cause) { return researchRefuse('TRSH1001', '/verification', 'Draft verification requires finite immutable evidence.', cause); }
}
