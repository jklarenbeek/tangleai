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
