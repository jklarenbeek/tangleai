/** Independent preregistration checks; no model judgment can waive a constraint. */
import { equalsJson } from '@jarenjs/core/object';
import type { ResearchContract, ExperimentPlan, ResearchHypothesis, ResearchCost, ResearchDesignProposal } from '../contracts.gen.ts';
import { immutableResearchJson, researchRevisionOf } from '../identity.ts';
import { researchRefuse, type ResearchOutcome } from '../errors.ts';
import { validateResearchShape } from '../schema.ts';

export interface ResearchDesignBounds { contract: ResearchContract; plan: ExperimentPlan; budget: ResearchCost }
export function checkResearchDesignPaths(paths: readonly string[], allowed: readonly string[]): ResearchOutcome<null> {
  for (const [i, path] of paths.entries()) if (path.split(/[\\/]/).includes('hidden') || !allowed.includes(path))
    return researchRefuse('TRSH1005', `/plan/inputPaths/${i}`, 'Pre-execution input must be admitted and cannot name a reserved hidden dataset.');
  return { valid: true, value: null };
}
export async function createResearchDesign(projectId: string, proposal: unknown, hypotheses: readonly ResearchHypothesis[],
  bounds: ResearchDesignBounds): Promise<ResearchOutcome<{ contract: ResearchContract; plan: ExperimentPlan }>> {
  const shape = validateResearchShape<ResearchDesignProposal>('ResearchDesignProposal', proposal);
  if (!shape.valid) return { valid: false, issues: shape.issues.map(issue => ({ ...issue, code: 'TRSH1009' })) };
  const input = shape.value, { contract, plan } = input;
  const paths = checkResearchDesignPaths(plan.inputPaths, bounds.plan.inputPaths); if (!paths.valid) return paths;
  const hypothesis = hypotheses.find(row => row.id === input.hypothesisId && row.projectId === projectId);
  if (!hypothesis) return researchRefuse('TRSH1003', '/hypothesisId', 'The design names no admitted hypothesis in this project.');
  const { hypothesisHash, ...hypothesisBody } = hypothesis;
  if (hypothesisHash !== await researchRevisionOf(hypothesisBody)) return researchRefuse('TRSH1002', '/hypothesisId', 'Selected hypothesis content changed.');
  if (!hypothesis.nullHypothesis.trim() || !hypothesis.disconfirmingObservation.trim())
    return researchRefuse('TRSH1009', '/hypothesisId', 'The selected hypothesis needs a null and a disconfirming observation.');
  if (!contract.hypothesisSpace.includes(hypothesis.statement))
    return researchRefuse('TRSH1009', '/contract/hypothesisSpace', 'The preregistration must include the selected statement.');
  for (const field of ['attemptCap', 'pivotCap', 'reviewCap'] as const) if (contract[field] > bounds.contract[field])
    return researchRefuse('TRSH1009', '/contract/' + field, 'A design cannot widen its admitted workflow limits.');
  if (!equalsJson(contract.datasets, bounds.contract.datasets) || !equalsJson(contract.splits, bounds.contract.splits))
    return researchRefuse('TRSH1009', '/contract/datasets', 'The design must retain the declared datasets and evaluation split.');
  if (contract.splits.train.some(id => contract.splits.test.includes(id)))
    return researchRefuse('TRSH1009', '/contract/splits', 'Training and evaluation splits overlap.');
  if (new Set(contract.metrics.map(row => row.id)).size !== contract.metrics.length
    || contract.metrics.some(row => !bounds.contract.metrics.some(allowed => equalsJson(row, allowed))))
    return researchRefuse('TRSH1009', '/contract/metrics', 'Metric ids, directions and units must retain evaluator authority.');
  for (const [i, baseline] of contract.requiredBaselines.entries()) if (!bounds.contract.requiredBaselines.some(row => equalsJson(row, baseline)))
    return researchRefuse('TRSH1009', `/contract/requiredBaselines/${i}`, 'Baseline provenance differs from the admitted implementation.');
  for (const id of hypothesis.baselineIds) if (!contract.requiredBaselines.some(row => row.condition === id))
    return researchRefuse('TRSH1009', '/contract/requiredBaselines', 'Every hypothesized baseline must remain preregistered.');
  if (new Set(plan.conditions.map(row => row.id)).size !== plan.conditions.length
    || plan.conditions.some(row => !contract.datasets.some(dataset => dataset.id === row.datasetId)))
    return researchRefuse('TRSH1009', '/plan/conditions', 'Conditions need unique ids and declared datasets.');
  for (const baseline of contract.requiredBaselines) if (!plan.conditions.some(row => row.id === baseline.condition && row.programId === baseline.programId))
    return researchRefuse('TRSH1009', '/plan/conditions', 'The required baseline implementation is missing from the experiment.');
  if (!contract.metrics.some(row => row.id === contract.successRule.metric) || !contract.metrics.some(row => row.id === contract.selectionRule.metric)
    || !plan.conditions.some(row => row.id === contract.successRule.condition)
    || !contract.requiredBaselines.some(row => row.condition === contract.successRule.baseline)
    || contract.successRule.condition === contract.successRule.baseline)
    return researchRefuse('TRSH1009', '/contract/successRule', 'Success and selection must name the registered comparison and metrics.');
  if (contract.replicatePolicy.minimum < bounds.contract.replicatePolicy.minimum
    || contract.replicatePolicy.seeds.length < contract.replicatePolicy.minimum
    || new Set(contract.replicatePolicy.seeds).size !== contract.replicatePolicy.seeds.length)
    return researchRefuse('TRSH1009', '/contract/replicatePolicy', 'The declared distinct replicates do not meet the minimum.');
  if (contract.selectionRule.n > contract.attemptCap * contract.replicatePolicy.seeds.length)
    return researchRefuse('TRSH1009', '/contract/selectionRule/n', 'Selection cannot exceed the declared attempt and replicate opportunities.');
  if (bounds.contract.stopConditions.some(value => !contract.stopConditions.includes(value)))
    return researchRefuse('TRSH1009', '/contract/stopConditions', 'A design cannot drop a declared stop condition.');
  if (!equalsJson(plan.evaluator, bounds.plan.evaluator))
    return researchRefuse('TRSH1009', '/plan/evaluator', 'The design cannot replace its independent evaluator.');
  for (const dimension of ['calls', 'tokens', 'ms', 'physical'] as const) if (plan.design.resources[dimension] > bounds.budget[dimension])
    return researchRefuse('TRSH1009', '/plan/design/resources/' + dimension, 'The requested design exceeds its resource ceiling.');
  if (plan.design.variables.independent.some(value => plan.design.variables.controlled.includes(value)))
    return researchRefuse('TRSH1009', '/plan/design/variables', 'An independent variable cannot also be held fixed.');
  for (const confound of hypothesis.confounds) if (!plan.design.controls.some(row => row.confound === confound))
    return researchRefuse('TRSH1009', '/plan/design/controls', 'Every declared confound needs an explicit control.');
  const contractContent = { projectId, ...contract }, contractBody = { id: 'contract-' + await researchRevisionOf(contractContent), ...contractContent };
  const frozen: ResearchContract = { ...contractBody, contractHash: await researchRevisionOf(contractBody) };
  const planContent = { projectId, contractHash: frozen.contractHash, hypothesisHash, ...plan };
  const planBody = { id: 'plan-' + await researchRevisionOf(planContent), ...planContent };
  return { valid: true, value: immutableResearchJson({ contract: frozen, plan: { ...planBody, planHash: await researchRevisionOf(planBody) } }) };
}
