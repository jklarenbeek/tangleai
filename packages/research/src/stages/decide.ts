/** One bounded planner; findings are evidence to retain, never a scientific score. */
import type { GmplFinding } from '@tangleai/gmpl';
import type { Analysis, ResearchContract, ResearchBranchSelection, ResearchCost, ResearchDecision, ResearchDecisionDetails } from '../contracts.gen.ts';
import { immutableResearchJson, researchRevisionOf } from '../identity.ts';
import { researchRefuse, type ResearchOutcome } from '../errors.ts';
import { validateResearchShape } from '../schema.ts';

export interface ResearchDecisionLedger { attempt: number; pivot: number; selection: ResearchBranchSelection }
export interface ResearchDecisionBudget { remaining: ResearchCost; nextAttempt: ResearchCost; nextPivot: ResearchCost; nextWrite?: ResearchCost }
export interface ResearchResultReview { reviewerIdentityId: string; findings: GmplFinding[]; artifactIds: string[] }
const dimensions = ['calls', 'tokens', 'ms', 'physical'] as const;

export function validateResearchDecision(decision: ResearchDecision, analysis: Analysis, contract: ResearchContract,
  ledger: ResearchDecisionLedger, budget: ResearchDecisionBudget): ResearchOutcome<ResearchDecision> {
  const details = decision?.details;
  if (!details || dimensions.some(key => !Number.isFinite(details.budgetEffect?.[key]) || details.budgetEffect[key] > 0
    || -details.budgetEffect[key] > budget.remaining[key]))
    return researchRefuse('TRSH1006', '/budgetEffect', 'A decision can only consume its remaining grant.');
  const shape = validateResearchShape<ResearchDecision>('ResearchDecision', decision); if (!shape.valid) return shape;
  if (decision.kind === 'Proceed' && (analysis.support !== 'supported' || analysis.evidence.underpowered || analysis.evidence.n < 2
    || analysis.evidence.missingSeeds.length || details.reviewerFindings.some(row => row.critical && row.disposition !== 'rejected-with-reason')))
    return researchRefuse('TRSH1006', '/kind', 'Proceed requires supported declared replications and no unresolved critical finding.');
  if (decision.kind === 'Refine' && ledger.attempt >= contract.attemptCap || decision.kind === 'Pivot' && ledger.pivot >= contract.pivotCap)
    return researchRefuse('TRSH1006', '/kind', 'A continuation exceeds the frozen attempt or pivot cap.');
  if (details.reviewerIdentityId === analysis.analystIdentityId || !details.reviewArtifactIds.length)
    return researchRefuse('TRSH1005', '/review', 'Result review requires separate identity and retained native artifacts.');
  if (decision.projectId !== analysis.projectId || decision.contractHash !== analysis.contractHash || decision.contractHash !== contract.contractHash
    || details.analysisId !== analysis.id || details.selectionId !== ledger.selection.id || details.selectedBranchId !== analysis.branchId
    || ledger.selection.selectedBranchId !== analysis.branchId || details.attemptOrdinal !== ledger.attempt || details.pivotOrdinal !== ledger.pivot)
    return researchRefuse('TRSH1002', '/decision', 'The decision must bind its selected analysis and frozen lineage.');
  return validateResearchShape<ResearchDecision>('ResearchDecision', decision);
}

export async function planResearchDecision(analysis: Analysis, contract: ResearchContract, ledger: ResearchDecisionLedger,
  budget: ResearchDecisionBudget, review: ResearchResultReview): Promise<ResearchOutcome<ResearchDecision>> {
  try {
  ({ analysis, contract, ledger, budget, review } = immutableResearchJson({ analysis, contract, ledger, budget, review }));
  const shape = validateResearchShape<Analysis>('Analysis', analysis); if (!shape.valid) return shape;
  for (const [name, value] of [['ResearchContract', contract], ['ResearchBranchSelection', ledger.selection],
    ['ResearchId', review.reviewerIdentityId]] as const) {
    const checked = validateResearchShape(name, value); if (!checked.valid) return checked;
  }
  for (const finding of review.findings) {
    const checked = validateResearchShape('ResearchGmplFinding', finding); if (!checked.valid) return checked;
  }
  const { id: analysisId, ...analysisBody } = analysis, { id: selectionId, ...selectionBody } = ledger.selection;
  const { contractHash, ...contractBody } = contract;
  if (analysisId !== 'analysis-' + await researchRevisionOf(analysisBody) || selectionId !== 'selection-' + await researchRevisionOf(selectionBody)
    || contractHash !== await researchRevisionOf(contractBody)
    || !ledger.selection.candidates.some(row => row.analysisId === analysis.id && row.branchId === analysis.branchId))
    return researchRefuse('TRSH1002', '/decision', 'Decision evidence must retain its selected content addresses.');
  for (const value of [budget.remaining, budget.nextAttempt, budget.nextPivot, ...(budget.nextWrite ? [budget.nextWrite] : [])]) {
    const checked = validateResearchShape('ResearchCost', value); if (!checked.valid) return researchRefuse('TRSH1006', '/budget', 'Decision accounts must be finite nonnegative costs.');
  }
  if (![ledger.attempt, ledger.pivot].every(value => Number.isSafeInteger(value) && value >= 1))
    return researchRefuse('TRSH1006', '/ledger', 'Decision counters must name a completed attempt and lineage.');
  let kind: ResearchDecision['kind'] = 'Stop', action: ResearchDecisionDetails['action'] = 'none', reason = 'The registered evidence does not support proceeding.';
  const diagnostic = analysis.diagnostics.find(row => row.kind === 'invalid-execution')
    ?? analysis.diagnostics.find(row => row.kind === 'confound') ?? analysis.diagnostics[0];
  if (analysis.support === 'exploratory') reason = 'Amended results are exploratory and cannot support the original preregistration.';
  else if (diagnostic?.kind === 'invalid-execution') reason = 'Execution was not safely settled: ' + diagnostic.reason;
  else if (diagnostic?.kind === 'confound') {
    kind = contract.analysisPolicy?.confoundAction ?? 'Stop'; action = kind === 'Pivot' ? 'pivot' : 'none'; reason = diagnostic.reason;
  } else if (diagnostic?.kind === 'degenerate' || diagnostic?.kind === 'program-error' && contract.analysisPolicy?.recoverProgramFailure) {
    kind = 'Refine'; action = 'repair'; reason = diagnostic.reason;
  } else if (analysis.evidence.missingSeeds.length && !analysis.execution.failed && contract.analysisPolicy) {
    kind = 'Refine'; action = 'replicate'; reason = 'Complete the remaining declared seeds without re-running settled experiments.';
  } else if (analysis.support === 'supported') {
    kind = 'Proceed'; action = 'write'; reason = 'The complete preregistered comparison meets statistical and practical significance.';
  } else if (analysis.support === 'not-supported') reason = 'The preregistered comparison is negative; retain the result and stop.';
  else if (analysis.evidence.underpowered) reason = 'The completed seed policy is underpowered; a single seed cannot support the hypothesis.';
  else reason = 'The registered interval is inconclusive; further attempts cannot be selected after seeing the result.';
  if (kind === 'Proceed' && review.findings.some(row => row.critical && row.disposition !== 'rejected-with-reason')) {
    kind = 'Stop'; action = 'none'; reason = 'An unresolved critical reviewer finding prevents proceeding.';
  }
  let cost = kind === 'Refine' ? budget.nextAttempt : kind === 'Pivot' ? budget.nextPivot : kind === 'Proceed' ? budget.nextWrite ?? budget.nextAttempt : { calls: 0, tokens: 0, ms: 0, physical: 0 };
  if (kind === 'Refine' && ledger.attempt >= contract.attemptCap || kind === 'Pivot' && ledger.pivot >= contract.pivotCap
    || action === 'repair' && (contract.branchSelectionRule?.kind !== 'best-of-n' || ledger.selection.candidates.length >= contract.branchSelectionRule.n)
    || dimensions.some(key => cost[key] > budget.remaining[key])) {
    kind = 'Stop'; action = 'none'; reason = 'The remaining grant or preregistered continuation cap is exhausted.';
    cost = { calls: 0, tokens: 0, ms: 0, physical: 0 };
  }
  const supporting: string[] = [], opposing: string[] = [];
  const baseline = analysis.metrics.find(row => row.condition === contract.successRule.baseline && row.metric === contract.successRule.metric)!;
  const candidate = analysis.metrics.find(row => row.condition === contract.successRule.condition && row.metric === contract.successRule.metric)!;
  if (!baseline || !candidate) return researchRefuse('TRSH1009', '/metrics', 'The analysis must retain both registered comparison conditions.');
  for (const row of candidate.values) {
    const control = baseline.values.find(value => value.seed === row.seed); if (!control) continue;
    const delta = (row.value - control.value) * (analysis.movement.direction === 'maximize' ? 1 : -1);
    (delta > 0 ? supporting : opposing).push(control.observationId, row.observationId);
  }
  const body: Omit<ResearchDecision, 'id'> = { projectId: analysis.projectId, contractHash: contract.contractHash, kind, reason,
    observationIds: analysis.observationIds, exploratory: analysis.support === 'exploratory', details: {
      analysisId: analysis.id, selectionId: ledger.selection.id, selectedBranchId: analysis.branchId, supporting: supporting.sort(), opposing: opposing.sort(),
      attemptOrdinal: ledger.attempt, pivotOrdinal: ledger.pivot,
      budgetEffect: { calls: -cost.calls || 0, tokens: -cost.tokens || 0, ms: -cost.ms || 0, physical: -cost.physical || 0 },
      targetStage: kind === 'Proceed' ? 'WRITE' : kind === 'Refine' ? 'EXECUTE' : kind === 'Pivot' ? 'SYNTHESIS' : 'STOPPED', action,
      reviewerIdentityId: review.reviewerIdentityId, reviewerFindings: review.findings, reviewArtifactIds: review.artifactIds } };
  return validateResearchDecision(immutableResearchJson({ id: 'decision-' + await researchRevisionOf(body), ...body }), analysis, contract, ledger, budget);
  } catch (cause) { return researchRefuse('TRSH1002', '/decision', 'Decision inputs must be finite immutable registered evidence.', cause); }
}
