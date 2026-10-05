/** Native record/store conformance; these synthetic rows make no quality claim. */
import { canonicalizeJson } from '@jarenjs/json/canonical';
import type { SkillSnapshot } from '@tangleai/trace2skill';
import { createLessonRefiner, planProjectCreate, planStateTransition, planContractFreeze, planStageCommit,
  researchRevisionOf, sealResearchLesson, sealLessonValidationRun,
  type ResearchStore, type ResearchDecision, type ResearchLessonV2, type LessonRefinerOptions } from '@tangleai/research';
import { attempt, checked, frozen, hash, manifest, project } from './fixtures.ts';
import { stored } from './store-harness.ts';
import { procedure, lessonScope, lessonNow, validationFixture } from './lessons-store-fixtures.ts';

export async function correctionFixture(store: ResearchStore, options: { id?: string; kind?: ResearchDecision['kind']; text?: string } = {}) {
  const owner = { ...project(options.id ?? 'guarded-origin'), lessonContext: { topicId: 'training-topic', taskFamily: lessonScope.taskFamily,
    input: { question: 'registered training experiment', partition: 1 } } };
  let state = stored(await store.createProject(checked(planProjectCreate(owner))));
  const registration = await frozen(owner.id);
  state = stored(await store.freezeContract(checked(await planContractFreeze(state, registration.contract, registration.plan, []))));
  for (const next of ['DISCOVERY', 'LITERATURE_GATE', 'SYNTHESIS', 'HYPOTHESIS_GATE', 'DESIGN', 'DESIGN_GATE', 'EXECUTE', 'ANALYZE'] as const)
    state = stored(await store.transition(checked(planStateTransition(state, next))));
  const snapshot = await procedure(); stored(await store.lessons.putProcedure(snapshot));
  const decision: ResearchDecision = { id: 'native-correction-' + owner.id, projectId: owner.id, contractHash: registration.contract.contractHash,
    kind: options.kind ?? 'Refine', reason: 'Retain every registered seed output.', observationIds: [], exploratory: false };
  const records = [{ kind: 'ResearchDecision' as const, value: decision }];
  const input = manifest(owner.id, 'ANALYZE'), row = await attempt(input);
  const artifact = stored(await store.stageArtifact(new TextEncoder().encode(canonicalizeJson({ kind: 'analysis-records', value: records })), {
    projectId: owner.id, attempt: { projectId: owner.id, stage: row.stage, attemptOrdinal: row.attemptOrdinal, inputManifestHash: row.inputManifestHash },
    mediaType: 'application/vnd.tangleai.research-analysis-records+json', verification: 'verified', parents: [{ artifactId: owner.id, admissionId: null }] }));
  row.outputArtifactIds = [artifact.artifact.id];
  stored(await store.commitStage(checked(await planStageCommit({ state, attempt: row, manifest: input, nextStatus: 'DECIDE', artifactAdmissionIds: [artifact.id], records }))));
  const lesson = checked(await sealResearchLesson({ projectId: owner.id, schemaVersion: 2, parentId: null, scope: lessonScope,
    origin: { kind: 'decision', runId: owner.id, topicIds: [owner.lessonContext.topicId], topicContentHashes: [await researchRevisionOf(owner.lessonContext.input)],
      artifactIds: [artifact.artifact.id], hashes: [artifact.artifact.id.slice(4)], envelope: {
        version: 1, artifacts: [{ id: artifact.artifact.id, kind: 'decision', locator: artifact.id, digest: artifact.artifact.id.slice(4) }],
        evidence: [{ id: 'native-correction', artifact: artifact.artifact.id, selector: '/value/0/value/reason', quote: decision.reason }],
        claims: [{ id: 'correction', text: 'A retained decision calls for complete seed output.', critical: true, status: 'supported', evidence: ['native-correction'] }], visibleEvidence: ['native-correction'] } },
    corroboration: null, proposal: { baseHash: snapshot.bundle.id, edit: { reasoning: 'Require complete registered output before analysis.',
      operations: [{ op: 'create_file', path: 'references/seed-policy.md', group: 'seed-policy', content: options.text ?? 'Retain every registered seed output.\n' }] } },
    severity: 'high', validation: { state: 'proposed', validationRunIds: [], issues: [] },
    decay: { hypothesisId: 'none', observedAtRun: owner.id, relevanceRows: [] }, promotion: null, recordedAt: lessonNow }));
  stored(await store.lessons.putProposal(lesson));
  const refinerOptions: LessonRefinerOptions = { store, scope: lessonScope, now: () => lessonNow, read: async () => ({ snapshot, set: null }) };
  return { owner, snapshot, artifact, decision, lesson, options: refinerOptions };
}
export async function validatedCorrectionFixture(store: ResearchStore) {
  const fixture = await correctionFixture(store), refiner = createLessonRefiner(fixture.options);
  const materialized = checked(await refiner.materialize({ proposalIds: [fixture.lesson.id] }));
  const validation = await retainCandidateValidation(store, fixture.lesson, materialized.snapshot);
  return { ...fixture, refiner, materialized, validation, request: { proposalIds: [fixture.lesson.id], validationRunIds: [validation.id] } };
}
export async function retainCandidateValidation(store: ResearchStore, lesson: ResearchLessonV2, snapshot: SkillSnapshot, inputs?: Parameters<typeof validationFixture>[1]) {
  stored(await store.lessons.putProcedure(snapshot));
  const original = await validationFixture(lesson, inputs), { id: _id, revision: _revision, ...body } = original;
  const payload = { bundleHash: snapshot.bundle.id, lessonIds: [lesson.id], decayHypothesisId: lesson.decay.hypothesisId,
    rows: Object.fromEntries(body.rows.map(row => [row.inputHash, row.output])) };
  const validation = checked(await sealLessonValidationRun({ ...body, bundleHash: snapshot.bundle.id,
    lessonSetHash: await researchRevisionOf(payload), identityId: hash() }));
  stored(await store.lessons.putValidation(validation));
  return validation;
}
