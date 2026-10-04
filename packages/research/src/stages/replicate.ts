/** Declared missing seeds use the existing execution graph and its native checkpoints. */
import type { Analysis, ResearchContract, ExperimentPlan, ExperimentBranch } from '../contracts.gen.ts';
import { researchRefuse, type ResearchOutcome } from '../errors.ts';

export function planResearchReplication(analysis: Analysis, contract: ResearchContract, plan: ExperimentPlan,
  branches: readonly ExperimentBranch[], attempt: number): ResearchOutcome<number[]> {
  if (!contract.analysisPolicy || attempt >= contract.attemptCap)
    return researchRefuse('TRSH1006', '/replication', 'Replication requires a frozen batch policy and an available attempt.');
  if (analysis.contractHash !== contract.contractHash || analysis.planHash !== plan.planHash || analysis.hypothesisHash !== plan.hypothesisHash
    || analysis.execution.failed || analysis.support === 'exploratory' || analysis.diagnostics.length
    || branches.length !== analysis.branchIds.length || branches.some(row => !analysis.branchIds.includes(row.id)
      || row.contractHash !== contract.contractHash || row.planHash !== plan.planHash || row.hypothesisHash !== plan.hypothesisHash))
    return researchRefuse('TRSH1009', '/replication', 'Replication must preserve the successful frozen lineage, code, data and evaluator.');
  const missing = contract.replicatePolicy.seeds.filter(seed => !analysis.evidence.seeds.includes(seed));
  if (!missing.length || JSON.stringify(missing) !== JSON.stringify(analysis.evidence.missingSeeds))
    return researchRefuse('TRSH1006', '/replication/seeds', 'Replication can schedule only declared, absent seeds.');
  return { valid: true, value: missing.slice(0, contract.analysisPolicy.seedBatchSize) };
}
