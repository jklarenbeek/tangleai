import { equalsJson } from '@jarenjs/core/object';
import type { Amendment, ExperimentPlan, InputManifest, ResearchContract, ResearchLifecycle,
  ResearchProject, ResearchState, StageAttempt } from './contracts.gen.ts';
import { researchRefuse } from './errors.ts';
import type { ResearchOutcome } from './errors.ts';
import { immutableResearchJson, inputManifestHashOf, researchRevisionOf, stageAttemptIdOf } from './identity.ts';
import { validateResearchShape } from './schema.ts';
import type { ResearchRecordWrite } from './records.ts';

/** This is a storage projection of the lifecycle; MAS owns execution and loops. */
export const RESEARCH_EDGES: Readonly<Record<ResearchLifecycle, readonly ResearchLifecycle[]>> = immutableResearchJson({
  CREATED: ['DISCOVERY', 'STOPPED'], DISCOVERY: ['LITERATURE_GATE', 'STOPPED'],
  LITERATURE_GATE: ['SYNTHESIS', 'STOPPED'], SYNTHESIS: ['HYPOTHESIS_GATE', 'STOPPED'],
  HYPOTHESIS_GATE: ['DESIGN', 'STOPPED'], DESIGN: ['DESIGN_GATE', 'STOPPED'],
  DESIGN_GATE: ['EXECUTE', 'STOPPED'], EXECUTE: ['ANALYZE', 'STOPPED'],
  ANALYZE: ['DECIDE', 'STOPPED'], DECIDE: ['WRITE', 'EXECUTE', 'SYNTHESIS', 'STOPPED'],
  WRITE: ['VERIFY', 'STOPPED'], VERIFY: ['QUALITY_GATE', 'STOPPED'],
  QUALITY_GATE: ['COMPLETE', 'WRITE', 'STOPPED'], COMPLETE: [], STOPPED: [],
});
export interface ProjectCreatePlan { project: ResearchProject; state: ResearchState }
export interface StateTransitionPlan { expectedState: ResearchState; nextState: ResearchState }
export interface ContractFreezePlan extends StateTransitionPlan { contract: ResearchContract; plan: ExperimentPlan }
export interface AmendmentPlan extends ContractFreezePlan { amendment: Amendment }
export interface ResearchProjection { stage: ResearchLifecycle; status: 'ok' | 'error' | 'cancelled'; ms: number }
export interface StageCommitPlan extends StateTransitionPlan {
  attempt: StageAttempt;
  manifest: InputManifest;
  artifactAdmissionIds: string[];
  records: ResearchRecordWrite[];
  projection: ResearchProjection;
  /** Activated with the design receipt, never in a preceding transaction. */
  preregistration?: { contract: ResearchContract; plan: ExperimentPlan };
}

export function planProjectCreate(input: unknown): ResearchOutcome<ProjectCreatePlan> {
  const checked = validateResearchShape<ResearchProject>('ResearchProject', input);
  if (!checked.valid) return checked;
  if (checked.value.status !== 'CREATED') return researchRefuse('TRSH1004', '/status', 'A new project starts at CREATED.');
  return { valid: true, value: immutableResearchJson({ project: checked.value,
    state: { projectId: checked.value.id, status: 'CREATED', revision: 0, contractHash: null, planHash: null, exploratoryObservationIds: [] } }) };
}
export function planStateTransition(current: ResearchState, edge: ResearchLifecycle): ResearchOutcome<StateTransitionPlan> {
  const checked = validateResearchShape<ResearchState>('ResearchState', current);
  if (!checked.valid) return checked;
  const state = checked.value;
  if (!RESEARCH_EDGES[state.status].includes(edge)) return researchRefuse('TRSH1004', '/status', `Illegal lifecycle edge ${state.status} → ${String(edge)}.`);
  if (!Number.isSafeInteger(state.revision + 1)) return researchRefuse('TRSH1004', '/revision', 'State revision exhausted.');
  if (edge === 'EXECUTE' && (state.contractHash === null || state.planHash === null))
    return researchRefuse('TRSH1009', '/contractHash', 'Execution requires a frozen contract and plan.');
  return { valid: true, value: immutableResearchJson({ expectedState: state, nextState: { ...state, status: edge, revision: state.revision + 1 } }) };
}

async function frozenRecords(projectId: string, contractInput: unknown, planInput: unknown): Promise<ResearchOutcome<{ contract: ResearchContract; plan: ExperimentPlan }>> {
  const contract = validateResearchShape<ResearchContract>('ResearchContract', contractInput);
  if (!contract.valid) return contract;
  const plan = validateResearchShape<ExperimentPlan>('ExperimentPlan', planInput);
  if (!plan.valid) return plan;
  if (contract.value.projectId !== projectId || plan.value.projectId !== projectId)
    return researchRefuse('TRSH1005', '/projectId', 'Frozen records must belong to this project.');
  const { contractHash, ...contractBody } = contract.value;
  if (contractHash !== await researchRevisionOf(contractBody)) return researchRefuse('TRSH1002', '/contractHash', 'Contract hash does not recompute.');
  const { planHash, ...planBody } = plan.value;
  if (planHash !== await researchRevisionOf(planBody)) return researchRefuse('TRSH1002', '/planHash', 'Plan hash does not recompute.');
  if (plan.value.contractHash !== contractHash) return researchRefuse('TRSH1009', '/plan/contractHash', 'Plan belongs to another preregistration lineage.');
  if (contract.value.splits.train.some(id => contract.value.splits.test.includes(id)))
    return researchRefuse('TRSH1009', '/contract/splits', 'Training and evaluation splits overlap.');
  return { valid: true, value: { contract: contract.value, plan: plan.value } };
}
export async function planContractFreeze(current: ResearchState, contract: ResearchContract,
  plan: ExperimentPlan, observationIds: readonly string[]): Promise<ResearchOutcome<ContractFreezePlan>> {
  const checked = validateResearchShape<ResearchState>('ResearchState', current);
  if (!checked.valid) return checked;
  const state = checked.value;
  if (observationIds.length) return researchRefuse('TRSH1009', '/observations', 'Initial preregistration cannot follow an observation.');
  if (!['CREATED', 'DISCOVERY', 'LITERATURE_GATE', 'SYNTHESIS', 'HYPOTHESIS_GATE', 'DESIGN', 'DESIGN_GATE'].includes(state.status))
    return researchRefuse('TRSH1009', '/status', 'Initial preregistration precedes execution.');
  const records = await frozenRecords(state.projectId, contract, plan);
  if (!records.valid) return records;
  if (state.contractHash !== null && (state.contractHash !== records.value.contract.contractHash || state.planHash !== records.value.plan.planHash))
    return researchRefuse('TRSH1009', '/contractHash', 'Changing a frozen contract requires an amendment.');
  const replay = state.contractHash === records.value.contract.contractHash && state.planHash === records.value.plan.planHash;
  if (!replay && !Number.isSafeInteger(state.revision + 1)) return researchRefuse('TRSH1004', '/revision', 'State revision exhausted.');
  return { valid: true, value: immutableResearchJson({ expectedState: state, ...records.value,
    nextState: { ...state, revision: state.revision + (replay ? 0 : 1), contractHash: records.value.contract.contractHash, planHash: records.value.plan.planHash } }) };
}
export async function planAmendment(current: ResearchState, amendmentInput: Amendment, contract: ResearchContract,
  plan: ExperimentPlan, observationIds: readonly string[]): Promise<ResearchOutcome<AmendmentPlan>> {
  const observations = [...observationIds];
  const checked = validateResearchShape<ResearchState>('ResearchState', current);
  if (!checked.valid) return checked;
  const state = checked.value;
  const amendment = validateResearchShape<Amendment>('Amendment', amendmentInput);
  if (!amendment.valid) return amendment;
  const records = await frozenRecords(state.projectId, contract, plan);
  if (!records.valid) return records;
  if (state.status === 'COMPLETE' || state.status === 'STOPPED' || state.contractHash === null || state.planHash === null)
    return researchRefuse('TRSH1009', '/status', 'Only an active frozen lineage can be amended.');
  if (amendment.value.before !== state.contractHash || amendment.value.after !== records.value.contract.contractHash
    || amendment.value.before === amendment.value.after || records.value.plan.planHash === state.planHash)
    return researchRefuse('TRSH1009', '/amendment', 'An amendment must name this lineage and a distinct frozen replacement.');
  if (observations.some(id => !amendment.value.marksExploratory.includes(id)))
    return researchRefuse('TRSH1009', '/amendment/marksExploratory', 'Every affected observation must remain visibly exploratory.');
  if (!Number.isSafeInteger(state.revision + 1)) return researchRefuse('TRSH1004', '/revision', 'State revision exhausted.');
  return { valid: true, value: immutableResearchJson({ expectedState: state, ...records.value, amendment: amendment.value,
    nextState: { ...state, revision: state.revision + 1, contractHash: records.value.contract.contractHash, planHash: records.value.plan.planHash,
      exploratoryObservationIds: [...new Set([...state.exploratoryObservationIds, ...observations])].sort() } }) };
}

export async function planStageCommit(input: {
  state: ResearchState; attempt: StageAttempt; manifest: InputManifest; nextStatus: ResearchLifecycle;
  artifactAdmissionIds: readonly string[]; records?: readonly ResearchRecordWrite[];
  preregistration?: { contract: ResearchContract; plan: ExperimentPlan };
}): Promise<ResearchOutcome<StageCommitPlan>> {
  let snapshot: typeof input;
  try { snapshot = immutableResearchJson(input); }
  catch (cause) { return researchRefuse('TRSH1001', '', 'Stage plans must be finite JSON.', cause); }
  const attempt = validateResearchShape<StageAttempt>('StageAttempt', snapshot.attempt);
  if (!attempt.valid) return attempt;
  const manifest = validateResearchShape<InputManifest>('InputManifest', snapshot.manifest);
  if (!manifest.valid) return manifest;
  let activated = snapshot.state;
  let preregistration: StageCommitPlan['preregistration'];
  if (snapshot.preregistration) {
    if (snapshot.state.status !== 'DESIGN' || snapshot.nextStatus !== 'DESIGN_GATE' || attempt.value.stopReason !== 'completed')
      return researchRefuse('TRSH1009', '/preregistration', 'Only a successfully verified design can atomically activate preregistration.');
    const frozen = await planContractFreeze(snapshot.state, snapshot.preregistration.contract, snapshot.preregistration.plan, []);
    if (!frozen.valid) return frozen;
    preregistration = { contract: frozen.value.contract, plan: frozen.value.plan };
    activated = { ...frozen.value.nextState, revision: snapshot.state.revision };
  }
  const transition = planStateTransition(activated, snapshot.nextStatus);
  if (!transition.valid) return transition;
  const state = transition.value.expectedState, row = attempt.value;
  if (row.projectId !== state.projectId || manifest.value.projectId !== state.projectId || row.stage !== state.status || manifest.value.stage !== row.stage)
    return researchRefuse('TRSH1004', '/attempt/stage', 'Attempt and manifest must name the current project stage.');
  if (row.id !== await stageAttemptIdOf(row) || row.inputManifestHash !== await inputManifestHashOf(manifest.value))
    return researchRefuse('TRSH1002', '/attempt/inputManifestHash', 'Attempt identity does not bind the exact input manifest.');
  if (row.promptRevision !== manifest.value.promptRevision || row.runIdentityId !== manifest.value.runIdentityId
    || !equalsJson(row.toolVersions, manifest.value.toolVersions))
    return researchRefuse('TRSH1002', '/attempt', 'Attempt stack differs from its input manifest.');
  if (manifest.value.inputs.some(item => item.artifactId !== 'art-' + item.sha256))
    return researchRefuse('TRSH1002', '/manifest/inputs', 'Input addresses and byte hashes disagree.');
  if (new Set(manifest.value.inputs.map(item => item.artifactId)).size !== manifest.value.inputs.length)
    return researchRefuse('TRSH1005', '/manifest/inputs', 'Input artifact addresses must be unique.');
  if (row.stopReason === 'completed' ? row.error !== null : row.error === null || snapshot.nextStatus !== 'STOPPED')
    return researchRefuse('TRSH1004', '/attempt/stopReason', 'Failed stage attempts retain their cause and stop the projection.');
  for (const key of ['calls', 'tokens', 'ms', 'physical'] as const) {
    if (row.spend[key] > manifest.value.reservation[key] && !(row.stopReason === 'failed' && row.error?.code === 'TRSH1006'))
      return researchRefuse('TRSH1006', '/attempt/spend/' + key, 'Stage spend exceeds its reservation.');
  }
  if (new Set(snapshot.artifactAdmissionIds).size !== snapshot.artifactAdmissionIds.length
    || snapshot.artifactAdmissionIds.some(id => !/^admission-[0-9a-f]{64}$/.test(id)))
    return researchRefuse('TRSH1001', '/artifactAdmissionIds', 'Expected unique immutable artifact admissions.');
  const status = row.stopReason === 'completed' ? 'ok' : row.stopReason === 'cancelled' ? 'cancelled' : 'error';
  return { valid: true, value: immutableResearchJson({ ...transition.value, expectedState: snapshot.state, attempt: row, manifest: manifest.value,
    artifactAdmissionIds: [...snapshot.artifactAdmissionIds], records: [...(snapshot.records ?? [])],
    projection: { stage: row.stage, status, ms: row.spend.ms }, ...(preregistration ? { preregistration } : {}) }) };
}
