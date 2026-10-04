/** A read-only projection: source records occur once; claims refer to their card, citation and observation ids. */
import type { ResearchClaimLedger, ResearchWritingInputs } from './contracts.gen.ts';

export function researchWritingLedgerView(ledger: ResearchClaimLedger) {
  return { id: ledger.id, projectId: ledger.projectId, scope: ledger.scope, decisionId: ledger.decisionId, analysisId: ledger.analysisId,
    visibleEvidence: ledger.envelope.visibleEvidence, claims: ledger.claims.map(claim => {
      const native = ledger.envelope.claims.find(row => row.id === claim.id)!;
      return { id: claim.id, section: claim.section, kind: claim.kind, text: claim.text, strength: claim.strength,
        critical: native.critical, status: native.status, evidenceIds: claim.evidenceIds, metricBinding: claim.metricBinding,
        proof: claim.proof ? { type: claim.proof.type, strength: claim.proof.strength, cardId: claim.proof.cardId,
          citationRecordId: claim.proof.citation?.recordId ?? null, n: claim.proof.n } : null };
    }) };
}
export function researchWritingView(input: ResearchWritingInputs, ledger: ResearchClaimLedger) {
  return { inputs: input, ledger: researchWritingLedgerView(ledger) };
}
