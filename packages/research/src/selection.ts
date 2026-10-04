/** Selection is frozen before execution and retains the complete candidate cost. */
import type { Analysis, ExperimentBranch, ResearchContract, ResearchBranchSelection, ResearchCost } from './contracts.gen.ts';
import { immutableResearchJson, researchRevisionOf } from './identity.ts';
import { researchRefuse, type ResearchOutcome } from './errors.ts';
import { validateResearchShape } from './schema.ts';

export interface ResearchBranchCandidate { analysis: Analysis; branches: ExperimentBranch[] }
export const researchCostTotal = (rows: readonly ResearchCost[]): ResearchCost => rows.reduce((sum, row) => ({
  calls: sum.calls + row.calls, tokens: sum.tokens + row.tokens, ms: sum.ms + row.ms, physical: sum.physical + row.physical,
}), { calls: 0, tokens: 0, ms: 0, physical: 0 });

export async function selectBranch(candidates: readonly ResearchBranchCandidate[], contract: ResearchContract): Promise<ResearchOutcome<ResearchBranchSelection>> {
  try {
  contract = immutableResearchJson(contract); candidates = immutableResearchJson(candidates);
  const rule = contract.branchSelectionRule;
  if (!rule || !validateResearchShape('ResearchBranchSelectionRule', rule).valid || !candidates.length
    || candidates.length > (rule.kind === 'single' ? 1 : rule.n))
    return researchRefuse('TRSH1006', '/branchSelectionRule', 'Branch selection requires its declared candidate count and scientific selector.');
  const contractShape = validateResearchShape('ResearchContract', contract); if (!contractShape.valid) return contractShape;
  const { contractHash, ...contractBody } = contract;
  if (contractHash !== await researchRevisionOf(contractBody)) return researchRefuse('TRSH1002', '/contract', 'Selection requires the unchanged frozen contract.');
  const rows: ResearchBranchSelection['candidates'] = [], seen = new Set<string>();
  for (const { analysis, branches } of immutableResearchJson(candidates)) {
    if (!validateResearchShape('Analysis', analysis).valid || analysis.contractHash !== contract.contractHash || analysis.projectId !== contract.projectId
      || analysis.movement.metric !== contract.successRule.metric || seen.has(analysis.branchId)
      || branches.length !== analysis.branchIds.length || new Set(branches.map(row => row.id)).size !== branches.length
      || branches.some(row => !analysis.branchIds.includes(row.id) || row.contractHash !== contract.contractHash
        || row.projectId !== analysis.projectId || row.planHash !== analysis.planHash || row.hypothesisHash !== analysis.hypothesisHash || !validateResearchShape('ExperimentBranch', row).valid))
      return researchRefuse('TRSH1006', '/candidates', 'Candidates must retain their complete, distinct preregistered branch lineage and costs.');
    const { id, ...body } = analysis;
    if (id !== 'analysis-' + await researchRevisionOf(body)) return researchRefuse('TRSH1002', '/analysis', 'Selection requires an immutable analysis content address.');
    for (const row of branches) {
      if (seen.has(row.id)) return researchRefuse('TRSH1006', '/candidates', 'A replication ancestor cannot be a separate selection candidate.');
      seen.add(row.id);
    }
    const values = analysis.metrics.find(row => row.condition === contract.successRule.condition && row.metric === contract.successRule.metric);
    rows.push({ branchId: analysis.branchId, analysisId: analysis.id, branchIds: analysis.branchIds, cost: researchCostTotal(branches.map(row => row.spend)),
      estimate: analysis.movement.estimate, variance: values?.sampleStddev == null ? null : values.sampleStddev ** 2,
      eligible: analysis.execution.success && analysis.diagnostics.length === 0 && analysis.support !== 'exploratory' });
  }
  rows.sort((a, b) => a.branchId.localeCompare(b.branchId));
  const ranked = [...rows].sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    const left = rule.kind === 'best-of-n' && rule.selector === 'lowest-variance' ? a.variance : a.estimate;
    const right = rule.kind === 'best-of-n' && rule.selector === 'lowest-variance' ? b.variance : b.estimate;
    if (left === null || right === null) return left === right ? a.branchId.localeCompare(b.branchId) : left === null ? 1 : -1;
    return (rule.kind === 'best-of-n' && rule.selector === 'lowest-variance' ? left - right : right - left) || a.branchId.localeCompare(b.branchId);
  });
  const body = { projectId: contract.projectId, contractHash: contract.contractHash, rule,
    selectedBranchId: ranked[0].branchId, candidates: rows, totalCost: researchCostTotal(rows.map(row => row.cost)) };
  return validateResearchShape<ResearchBranchSelection>('ResearchBranchSelection', { id: 'selection-' + await researchRevisionOf(body), ...body });
  } catch (cause) { return researchRefuse('TRSH1002', '/selection', 'Selection requires finite immutable registered candidates.', cause); }
}
