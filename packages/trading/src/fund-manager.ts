/** The only model decision forwarded to deterministic order admission. */
import { validateGmplPromptArtifact, type GmplPromptArtifact } from '@tangleai/gmpl';
import { immutableTradingJson } from './identity.ts';
import { checkTradingArtifactScope } from './evidence.ts';
import { createTradingRecord } from './records.ts';
import { validateTradingShape } from './schema.ts';
import { tradingRefuse, type TradingOutcome } from './errors.ts';
import type { TradingAnalystProvenance } from './analysts.ts';
import type { TradeProposal, RiskVerdict, FundManagerDecision, FundManagerOutput, MarketSnapshot } from './contracts.gen.ts';

export async function checkFundManagerDecision(input: { output: unknown; proposal: TradeProposal; riskVerdict: RiskVerdict;
  snapshot: MarketSnapshot; artifact: GmplPromptArtifact; provenance: TradingAnalystProvenance }): Promise<TradingOutcome<FundManagerDecision>> {
  try { input = immutableTradingJson(input); }
  catch (cause) { return tradingRefuse('TTRD1001', '', 'Fund-manager checking requires finite JSON', cause); }
  const output = validateTradingShape<FundManagerOutput>('fundManagerOutput', input.output); if (!output.valid) return output;
  const artifact = await validateGmplPromptArtifact(input.artifact);
  if (!artifact.valid || artifact.value.id !== 'trading-fund-manager') return tradingRefuse('TTRD1002', '/artifact', 'Fund manager requires its declared prompt');
  const scope = await checkTradingArtifactScope([input.proposal, input.riskVerdict], input.snapshot); if (!scope.valid) return scope;
  const value = output.value;
  if (input.riskVerdict.proposalId !== input.proposal.id || !input.riskVerdict.adjustedIntent || !input.riskVerdict.judgments?.length
    || value.inputProposalId !== input.proposal.id || value.inputRiskVerdictId !== input.riskVerdict.id)
    return tradingRefuse('TTRD1004', '/inputProposalId', 'Fund manager must preserve the exact proposal and terminal risk verdict');
  for (const citation of value.citations) if (![input.proposal, input.riskVerdict].some(a => a.id === citation.id && a.revision === citation.digest))
    return tradingRefuse('TTRD1004', '/citations', 'Fund manager may cite only its visible proposal and risk verdict');
  const citations = [...new Set(value.citations.map(c => c.id))], action = value.decision === 'rejected' ? 'reject'
    : value.finalIntent.action === 'hold' ? 'hold' : value.decision === 'modified' ? 'modify' : 'approve';
  return createTradingRecord('fund-manager-decision', { ...value, citations, action, quantity: value.finalIntent.quantity ?? 0,
    manifestId: input.snapshot.manifestId, snapshotId: input.snapshot.id, role: artifact.value.role.id,
    key: { ...input.proposal.key, stage: 'fund-manager-decision' }, proposalId: input.proposal.id, riskVerdictId: input.riskVerdict.id,
    violations: [], rationale: value.reasons.join('\n'), claims: value.reasons.map(text => ({ text, citations })),
    model: input.provenance.model, spend: input.provenance.spend, promptRevision: artifact.value.revision });
}
