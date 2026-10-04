import { createMemoryResearchStore, planProjectCreate, planStateTransition, planStageCommit, planContractFreeze, planAmendment,
  researchArtifactIdOf, inputManifestHashOf, type ResearchProject, type ResearchState, type StageAttempt, type InputManifest,
  type ResearchContract, type ExperimentPlan, type Amendment, type StageArtifactDescriptor, type ResearchStore } from '@tangleai/research';
import type { ResearchClaim } from '@tangleai/research/contracts';
import { createResearchBinding, prepareResearchWorkflow, initialResearchFrame, inputManifestOf, createResearchTaskHandlers,
  createResearchHostBindings, gateResponseSchema, applyOverduePolicy, type ResearchTaskTools } from '@tangleai/research';
import type { RunIdentity } from '@tangleai/config';
import { discoverCrossref, createReplayTransport, createQueryPlan, createInclusionCriteria, createDiscoveryStageTools,
  extractEvidenceCards, toAdmittedArtifact, type DiscoveryQuery, type ResearchProviderHost, type ResearchAdapterContext,
  type ResearchDiscoveryOptions, type EvidenceCard } from '@tangleai/research';
import type { MasStore, WorkflowLimits } from '@tangleai/mas';
import { createResearchReasoningTools, researchReasoningRevisionOf, createResearchSynthesis, createResearchHypotheses, createResearchDesign,
  createResearchNoveltyPlan, executeResearchNovelty, researchArtifacts, type ResearchReasoningPolicy, type ResearchDesignProposal,
  type HypothesisSetProposal, type SynthesisProposal, type Synthesis, type ResearchHypothesis, type HypothesisSet } from '@tangleai/research';
import schema from '@tangleai/research/schemas/research' with { type: 'json' };
import { createResearchStore, createResearchDbPersistence, researchRunLogId, type TangleDb } from '@tangleai/store';
declare const project: ResearchProject, state: ResearchState, attempt: StageAttempt, manifest: InputManifest,
  contract: ResearchContract, plan: ExperimentPlan, amendment: Amendment, descriptor: StageArtifactDescriptor, claim: ResearchClaim, db: TangleDb;
const memory: ResearchStore = createMemoryResearchStore(), sqlite: ResearchStore = createResearchStore(db);
const created = planProjectCreate(project); if (created.valid) await memory.createProject(created.value);
const edge = planStateTransition(state, 'DISCOVERY'); if (edge.valid) await sqlite.transition(edge.value);
const frozen = await planContractFreeze(state, contract, plan, []); if (frozen.valid) await sqlite.freezeContract(frozen.value);
const amended = await planAmendment(state, amendment, contract, plan, []); if (amended.valid) await sqlite.amendContract(amended.value);
const stage = await planStageCommit({ state, attempt, manifest, nextStatus: 'LITERATURE_GATE', artifactAdmissionIds: [] });
if (stage.valid) { const saved = await sqlite.commitStage(stage.value); if (saved.ok) { const hash: string = saved.value.operationHash; void hash; } }
await memory.stageArtifact(new Uint8Array([1]), descriptor);
await memory.putRecord(project.id, { kind: 'ResearchClaim', value: claim });
const read = await memory.getRecord(project.id, 'ResearchClaim', claim.id); if (read.ok && read.value) { const text: string = read.value.text; void text; }
await researchArtifactIdOf(new Uint8Array([1])); await inputManifestHashOf(manifest);
await researchRunLogId(db, project.id); createResearchDbPersistence(db);
declare const identity: RunIdentity, masStore: MasStore, limits: WorkflowLimits, taskTools: ResearchTaskTools;
const binding = await createResearchBinding(contract, { identity, promptRevision: manifest.promptRevision,
  toolVersions: manifest.toolVersions, evaluator: manifest.evaluator, reservation: manifest.reservation });
const prepared = await prepareResearchWorkflow(contract, { binding, profile: 'scripted', limits });
const frame = await initialResearchFrame(project, plan, binding);
await inputManifestOf(frame.status, frame, binding.promptRevision, binding.runIdentityId, binding.toolVersions, binding.evaluator, binding.reservation);
const taskHandlers = createResearchTaskHandlers(sqlite, taskTools);
createResearchHostBindings({ masStore, researchStore: sqlite, taskHandlers, prepared, now: () => '', clock: () => 0 });
gateResponseSchema('literature', manifest.promptRevision);
await applyOverduePolicy({ masStore, researchStore: sqlite, runId: project.id, now: '', policy: { kind: 'pause', afterMs: 1000 } });
// @ts-expect-error Lifecycle states are a closed union.
planStateTransition(state, 'INVENTED');
// @ts-expect-error The byte identity does not accept text as a byte view.
researchArtifactIdOf('abc');
// @ts-expect-error Kind and record shape must agree.
memory.putRecord(project.id, { kind: 'ResearchClaim', value: project });
void schema;
declare const discoveryQuery: DiscoveryQuery, providerHost: ResearchProviderHost, adapterContext: ResearchAdapterContext,
  discoveryOptions: ResearchDiscoveryOptions, evidenceCard: EvidenceCard;
const discovery = await discoverCrossref(discoveryQuery, providerHost, adapterContext);
const complete: 'complete' | 'incomplete' | 'refused' = discovery.outcome.state;
const rawHashes: string[] = discovery.outcome.rawHashes;
const replayTransport = await createReplayTransport([], { scope: 'public-fixture' });
await createQueryPlan(discoveryOptions.plan);
await createInclusionCriteria({ reviewer: 'rules', titleTerms: ['term'], dateFrom: null, dateTo: null, requireSource: true });
await createDiscoveryStageTools(taskTools, discoveryOptions);
const admitted = toAdmittedArtifact(evidenceCard);
void [complete, rawHashes, replayTransport, admitted, extractEvidenceCards];
// @ts-expect-error Unknown providers cannot enter a frozen query.
const unregisteredQuery: DiscoveryQuery = { ...discoveryQuery, provider: 'unknown' };
void unregisteredQuery;
declare const reasoningPolicy: ResearchReasoningPolicy, synthesisProposal: SynthesisProposal, hypothesisProposal: HypothesisSetProposal,
  designProposal: ResearchDesignProposal, synthesis: Synthesis, hypotheses: ResearchHypothesis[], hypothesisSet: HypothesisSet;
const reasoningTools: ResearchTaskTools = await createResearchReasoningTools(taskTools, { project, policy: reasoningPolicy, provider: providerHost });
await prepareResearchWorkflow(contract, { binding, profile: 'scripted', limits, reasoning: reasoningPolicy });
await researchReasoningRevisionOf(reasoningPolicy);
await createResearchSynthesis(project.id, project.question, synthesisProposal, [evidenceCard]);
await createResearchHypotheses(synthesis, hypothesisProposal, [evidenceCard], ['control'], 'single-agent');
await createResearchDesign(project.id, designProposal, hypotheses, { contract, plan, budget: project.budget });
await createResearchNoveltyPlan(hypothesisSet, reasoningPolicy.novelty);
await executeResearchNovelty(hypothesisSet, reasoningPolicy.novelty, [], { provider: providerHost,
  admitPlan: async query => { await sqlite.putRecord(project.id, { kind: 'QueryPlan', value: query }); } }, new AbortController().signal);
void [reasoningTools, researchArtifacts];
// @ts-expect-error A model cannot choose an arbitrary reasoning topology.
const unknownReasoning: ResearchReasoningPolicy = { ...reasoningPolicy, mode: 'unregistered' };
void unknownReasoning;
import { createResearchWorkspace, buildExecutionManifest, createFixtureExecutor, createEvaluationRegistry, createRemoteResearchExecutor,
  createResearchExecutionTools, researchExecutionRevisionOf, validateResearchExecutionResult, type ResearchExecutor, type ResearchExecutionPolicy,
  type ResearchWorkspace, type ExecutionManifest, type ResearchExecutionResult } from '@tangleai/research';
declare const executionPolicy: ResearchExecutionPolicy, workspace: ResearchWorkspace, executionManifest: ExecutionManifest, executionResult: ResearchExecutionResult;
const executor: ResearchExecutor = createFixtureExecutor({ fixture: async () => ({ kind: 'clusters', assignments: [0], centroids: [[0, 0]], iterations: 0 }) }, { now: () => 0 });
await researchExecutionRevisionOf(executionPolicy);
await createResearchWorkspace({ projectId: project.id, datasetIds: [], splitIds: [], files: [] });
await buildExecutionManifest({ contract, plan, workspace, branchId: 'branch', condition: 'candidate', seed: 1,
  imageDigest: executionPolicy.imageDigest, dependencyLockHash: executionPolicy.dependencyLockHash, resources: executionPolicy.resources });
const executionContext = { contract, plan, signal: new AbortController().signal };
await executor.run(executionManifest, workspace, executionContext);
await validateResearchExecutionResult(executionResult, executionManifest, workspace, executionContext);
const evaluator = { id: 'evaluator', version: '1', evaluate: async () => ({ valid: true as const, value: [{ metric: 'm', value: 1, unit: 'items' }] }) };
const registry = createEvaluationRegistry([evaluator]);
await registry.evaluate({ ...executionContext, manifest: executionManifest, workspace, result: executionResult, hiddenLabels: {} });
await createResearchExecutionTools(taskTools, { researchStore: sqlite, policy: executionPolicy, executor, evaluators: [evaluator], hiddenLabels: {}, evaluatorBytes: new Uint8Array() });
await prepareResearchWorkflow(contract, { binding, profile: 'scripted', limits, execution: executionPolicy });
void createRemoteResearchExecutor;
// @ts-expect-error Measured execution cannot enable the network.
const unsafeExecution: ExecutionManifest = { ...executionManifest, network: { setup: 'off', measured: 'on' } };
void unsafeExecution;

import { createResearchAnalysis, verifyResearchAnalysis, planResearchDecision, selectBranch, createResearchAnalysisTools,
  researchAnalysisRevisionOf, planResearchReplication, type ResearchAnalysisInput, type ResearchPairedStatistic,
  type ResearchAnalysisRuntimePolicy, type ResearchBranchCandidate, type ResearchDecisionLedger, type ResearchDecisionBudget,
  type ResearchResultReview, type Analysis, type ExperimentBranch } from '@tangleai/research';
declare const analysisInput: ResearchAnalysisInput, statistic: ResearchPairedStatistic, analysisPolicy: ResearchAnalysisRuntimePolicy,
  analysis: Analysis, candidates: ResearchBranchCandidate[], ledger: ResearchDecisionLedger, budget: ResearchDecisionBudget,
  resultReview: ResearchResultReview, branches: ExperimentBranch[];
await createResearchAnalysis(analysisInput, statistic); await verifyResearchAnalysis(analysisInput, analysis, statistic);
await selectBranch(candidates, contract); await planResearchDecision(analysis, contract, ledger, budget, resultReview);
planResearchReplication(analysis, contract, plan, branches, 1); await researchAnalysisRevisionOf(analysisPolicy);
await createResearchAnalysisTools(taskTools, { researchStore: sqlite, policy: analysisPolicy, statistic });
await prepareResearchWorkflow(contract, { binding, profile: 'scripted', limits, execution: executionPolicy, analysis: analysisPolicy });
