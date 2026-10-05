/** Keyless lesson fixtures obtain authority only through native research and outcome records. */
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { extractTextDocument, type DocumentVersion } from '@tangleai/documents';
import { createOutcomeService, outcomeRevision, type OutcomeStore, type Source, type EvaluationSlot, type Json,
  type OutcomeResult, type OutcomeIssue } from '@tangleai/outcomes';
import { createResearchLessonAdapter, prepareResearchLessonSlot, recordLessonActivation, researchLessonOutcomeScope,
  researchLessonArtifactKey, lessonInputHash, researchRevisionOf, researchValue, planProjectCreate, planContractFreeze,
  planStateTransition, planStageCommit, inputManifestHashOf, stageAttemptIdOf, proposeLessons,
  type ResearchStore, type ResearchLessonScope, type ResearchLessonV2, type ResearchLessonDraft, type ResearchContract,
  extractEvidenceCards, type ExperimentPlan, type ResearchProject, type ResearchDecision, type StageAttempt, type InputManifest,
  type SourceAcquisition, type LiteratureRecord } from '@tangleai/research';
import type { SkillSnapshot } from '@tangleai/trace2skill';

export const LESSON_FIXTURE_TIME = '2026-01-02T00:00:00.000Z';
export const LESSON_FIXTURE_TRUTH = Object.freeze({ claimSupport: 1, registryAccuracy: 1, preregistrationIntegrity: 1, completion: true });
export const LESSON_FIXTURE_ZERO = Object.freeze({ ...LESSON_FIXTURE_TRUTH, claimSupport: 0, completion: false });
export const zeroLessonSpend = () => ({ calls: 0, tokens: 0, ms: 0, physical: 0, replayed: 0, cost: null });

export async function materializeLessonCorrection(options: { store: ResearchStore; scope: ResearchLessonScope; id: string;
  procedure: SkillSnapshot; contract: ResearchContract; plan: ExperimentPlan; finding: string; topicId?: string; input?: Record<string, Json> }) {
  const { store, scope, id } = options;
  const project: ResearchProject = { id, topic: 'registered metric integrity', domainProfile: scope.domainProfileId,
    question: 'Does this recorded correction support a reusable procedure?', owner: 'authored-lesson-fixture', mode: 'gate-only',
    safetyClass: 'computational', status: 'CREATED', budget: { calls: 8, tokens: 32768, physical: 0, ms: 60000 }, createdAt: LESSON_FIXTURE_TIME,
    lessonContext: { topicId: options.topicId ?? id + '-topic', taskFamily: scope.taskFamily,
      input: options.input ?? { experiment: 'authored metric-unit correction', origin: id } } };
  let state = researchValue(await store.createProject(researchValue(planProjectCreate(project))));
  const { contractHash: _contractHash, ...contractBody } = structuredClone(options.contract);
  Object.assign(contractBody, { id: id + '-contract', projectId: id });
  const contract = { ...contractBody, contractHash: await researchRevisionOf(contractBody) };
  const { planHash: _planHash, ...planBody } = structuredClone(options.plan);
  Object.assign(planBody, { id: id + '-plan', projectId: id, contractHash: contract.contractHash });
  const plan = { ...planBody, planHash: await researchRevisionOf(planBody) };
  state = researchValue(await store.freezeContract(researchValue(await planContractFreeze(state, contract, plan, []))));
  for (const status of ['DISCOVERY', 'LITERATURE_GATE', 'SYNTHESIS', 'HYPOTHESIS_GATE', 'DESIGN', 'DESIGN_GATE', 'EXECUTE', 'ANALYZE'] as const)
    state = researchValue(await store.transition(researchValue(planStateTransition(state, status))));
  researchValue(await store.lessons.putProcedure(options.procedure));
  const revision = await researchRevisionOf({ host: 'authored-lesson-correction/v1' });
  const decision: ResearchDecision = { id: id + '-correction', projectId: id, contractHash: contract.contractHash,
    kind: 'Refine', reason: options.finding, observationIds: [], exploratory: false };
  const records = [{ kind: 'ResearchDecision' as const, value: decision }];
  const manifest: InputManifest = { projectId: id, stage: 'ANALYZE', inputs: [], promptRevision: revision, runIdentityId: revision,
    toolVersions: [{ name: 'authored-lesson-fixture', version: '1' }], evaluator: plan.evaluator,
    reservation: { calls: 0, tokens: 0, ms: 0, physical: 0 } };
  const key = { projectId: id, stage: manifest.stage, attemptOrdinal: 1, inputManifestHash: await inputManifestHashOf(manifest) };
  const artifact = researchValue(await store.stageArtifact(new TextEncoder().encode(canonicalizeJson({ kind: 'analysis-records', value: records })), {
    projectId: id, attempt: key, mediaType: 'application/json', verification: 'verified', parents: [{ artifactId: id, admissionId: null }] }));
  const attempt: StageAttempt = { ...key, id: await stageAttemptIdOf(key), masPath: id + '/analysis', promptRevision: revision,
    runIdentityId: revision, toolVersions: manifest.toolVersions, spend: { calls: 0, tokens: 0, ms: 0, physical: 0 },
    stopReason: 'completed', interventions: [], outputArtifactIds: [artifact.artifact.id], error: null, mode: 'scripted' };
  researchValue(await store.commitStage(researchValue(await planStageCommit({ state, attempt, manifest, nextStatus: 'DECIDE',
    artifactAdmissionIds: [artifact.id], records }))));
  return { project, artifact, decision };
}

/** The wire sees exactly the same bounded source-class request as a provider client. */
export function scriptedLessonClient(edit: ResearchLessonDraft['proposal']['edit'], decayHypothesisId: ResearchLessonDraft['decayHypothesisId'],
  alter?: (draft: ResearchLessonDraft) => void) {
  const requests: string[] = [];
  const client = { endpoint: { provider: 'scripted' }, async complete(request: unknown) {
    const messages = (request as { messages: Array<{ role: string; content: string }> }).messages;
    const inputText = messages.find(row => row.role === 'user')!.content; requests.push(inputText);
    const input = JSON.parse(inputText) as { scope: ResearchLessonScope; baseHash: string; sourceKind: ResearchLessonV2['origin']['kind'];
      sources: Array<{ artifact: ResearchLessonV2['origin']['envelope']['artifacts'][number]; evidence: Array<{ selector: string; quote: string }> }> };
    const source = input.sources[0], evidence = source.evidence[0];
    const draft: ResearchLessonDraft = { scope: input.scope, origin: { kind: input.sourceKind, envelope: {
      version: 1, artifacts: [source.artifact], evidence: [{ id: 'checked-correction', artifact: source.artifact.id, ...evidence }],
      claims: [{ id: 'reusable-correction', text: 'Apply the recorded correction to the research procedure.', critical: true,
        status: 'supported', evidence: ['checked-correction'] }], visibleEvidence: ['checked-correction'] } },
      proposal: { baseHash: input.baseHash, edit: structuredClone(edit) }, severity: 'high', decayHypothesisId };
    alter?.(draft);
    return { message: { role: 'assistant', content: JSON.stringify({ proposals: [draft] }) }, finishReason: 'stop',
      usage: { prompt_tokens: 32, completion_tokens: 16 } };
  } };
  return { client, requests };
}
export async function proposeFixtureLesson(options: { store: ResearchStore; scope: ResearchLessonScope; runId: string;
  procedure: SkillSnapshot; edit: ResearchLessonDraft['proposal']['edit']; decayHypothesisId: ResearchLessonDraft['decayHypothesisId'];
  alter?: (draft: ResearchLessonDraft) => void }) {
  const wire = scriptedLessonClient(options.edit, options.decayHypothesisId, options.alter);
  const result = await proposeLessons({ store: options.store, profile: options.scope, run: options.runId, bundleHash: options.procedure.bundle.id,
    client: wire.client, now: () => LESSON_FIXTURE_TIME, clock: () => 0, physicalRequests: () => 0,
    budget: { calls: 8, tokens: 32768, ms: 60000 } });
  return { ...result, requests: wire.requests };
}

/** Bound web evidence exercises the ordinary document, acquisition and committed-card lane. */
export async function materializeLessonWebOrigin(store: ResearchStore, prototype: ResearchProject, finding: string) {
  const project = { ...prototype, id: prototype.id + '-web', lessonContext: { ...prototype.lessonContext!,
    topicId: prototype.id + '-web-topic', input: { source: 'authored-web-correction' } } };
  let state = researchValue(await store.createProject(researchValue(planProjectCreate(project))));
  state = researchValue(await store.transition(researchValue(planStateTransition(state, 'DISCOVERY'))));
  const revision = await researchRevisionOf({ fixture: 'bound-web-correction/v1' });
  const manifest: InputManifest = { projectId: project.id, stage: 'DISCOVERY', inputs: [], promptRevision: revision,
    runIdentityId: revision, toolVersions: [{ name: 'authored-web-correction', version: '1' }], evaluator: { id: 'fixture', version: '1' },
    reservation: { calls: 0, tokens: 0, ms: 0, physical: 0 } };
  const key = { projectId: project.id, stage: manifest.stage, attemptOrdinal: 1, inputManifestHash: await inputManifestHashOf(manifest) };
  const descriptor = { projectId: project.id, attempt: key, verification: 'verified' as const, parents: [{ artifactId: project.id, admissionId: null }] };
  const bytes = new TextEncoder().encode(finding), source = researchValue(await store.stageArtifact(bytes, { ...descriptor, mediaType: 'text/plain' }));
  const version: DocumentVersion = { id: await researchRevisionOf({ source: source.artifact.id }), sourceId: 'authored-lesson-source',
    contentHash: source.artifact.id.slice(4), extractionVersion: 'fixture-extraction/v1', chunkerVersion: 'fixture-chunker/v1',
    chunkerConfig: { maxTokens: 100, overlapTokens: 0 }, embeddedBy: { model: 'fixture', dims: 1 }, status: 'active', fetchedAt: LESSON_FIXTURE_TIME,
    metrics: { bytes: bytes.length, elements: 1, chunks: 0, extractionMs: 0, chunkingMs: 0, embeddingMs: 0, embeddingCalls: 0,
      estimatedEmbeddingTokens: 0, partial: false, warnings: [] } };
  const elements = extractTextDocument(finding, false).elements.map((element, order) => ({ ...element, id: 'correction-element-' + order,
    versionId: version.id, sourceId: version.sourceId, order }));
  const literature: LiteratureRecord = { id: 'authored-lesson-literature', title: 'Registered metric integrity', authors: ['Tangle fixture'],
    date: '2026-01-01', canonicalIds: {}, rawHashes: [{ source: 'openalex', sha256: revision }],
    sourcePath: 'https://fixture.example.test/lesson', resolution: 'resolved',
    licence: { spdx: 'MIT', provenance: 'tangle-authored-synthetic', source: 'Authored lesson refusal control.' } };
  const card = researchValue(await extractEvidenceCards({ literatureId: literature.id, version, elements, bytes, promptRevision: revision, maxCards: 1 }))[0];
  const body: Omit<SourceAcquisition, 'id'> = { literatureId: literature.id, status: 'resolved', versionId: version.id,
    contentHash: version.contentHash, artifactId: source.artifact.id, issues: [] };
  const records = [{ kind: 'LiteratureRecord' as const, value: literature },
    { kind: 'SourceAcquisition' as const, value: { ...body, id: 'acquisition-' + await researchRevisionOf(body) } },
    { kind: 'EvidenceCard' as const, value: card }];
  const encode = (value: unknown) => new TextEncoder().encode(canonicalizeJson(value));
  const projection = researchValue(await store.stageArtifact(encode({ kind: 'source-versions', value: [{ id: version.id,
    sourceId: version.sourceId, contentHash: version.contentHash, extractionVersion: version.extractionVersion, elements }] }), { ...descriptor, mediaType: 'application/json' }));
  const artifact = researchValue(await store.stageArtifact(encode({ kind: 'discovery-records', value: records }), { ...descriptor, mediaType: 'application/json' }));
  const attempt: StageAttempt = { ...key, id: await stageAttemptIdOf(key), masPath: project.id + '/discovery',
    promptRevision: revision, runIdentityId: revision, toolVersions: manifest.toolVersions, spend: { calls: 0, tokens: 0, ms: 0, physical: 0 },
    stopReason: 'completed', interventions: [], outputArtifactIds: [source.artifact.id, projection.artifact.id, artifact.artifact.id], error: null, mode: 'scripted' };
  researchValue(await store.commitStage(researchValue(await planStageCommit({ state, attempt, manifest, nextStatus: 'LITERATURE_GATE',
    artifactAdmissionIds: [source.id, projection.id, artifact.id], records }))));
  return project;
}

function outcomeValue(result: OutcomeResult): Record<string, Json> {
  if (!result.ok) throw Error('Native lesson fixture refused: ' + JSON.stringify(result.issues));
  return result.value as Record<string, Json>;
}
export async function lessonOutcomeHost(options: { store: ResearchStore; outcomeStore: OutcomeStore; scope: ResearchLessonScope;
  baseBundleHash: string; validationRunIds: string[]; lessonSetIds: string[]; lesson: ResearchLessonV2 }) {
  const { store, scope, lesson } = options;
  const adapter = researchValue(await createResearchLessonAdapter(options));
  const sources = new Map<string, Source>(), slots = new Map<string, EvaluationSlot>();
  const revision = await researchRevisionOf({ host: 'research-lesson-fixture/v1' }), outcomeScope = researchLessonOutcomeScope(scope);
  const service = await createOutcomeService({ store: options.outcomeStore, scope: outcomeScope, adapters: [adapter],
    principal: { id: 'scripted-conformance-reviewer', authorityId: revision, approve: true, reconcile: false },
    resolver: { revision, async resolve(ref) { return sources.get(ref.sourceId); } },
    authorizeMemoryIds: async ids => ({ allowed: ids.length === 0, authorizationId: revision }),
    evaluationSlot: async id => slots.get(id) });
  const artifactKey = researchLessonArtifactKey(scope);
  const command = (key: string, input: object, at = LESSON_FIXTURE_TIME) => ({ scopeId: service.scopeId, artifactKey, requestKey: key, at, input });
  const decidedAt = '2026-01-01T00:00:00.000Z';
  const decisionId = outcomeValue(await service.create(command('training', { decisionKey: lesson.origin.topicIds[0], adapter: adapter.identity,
    input: { topicId: lesson.origin.topicIds[0], inputHash: lessonInputHash({ origin: lesson.origin.runId }) }, output: LESSON_FIXTURE_ZERO,
    cutoffAt: decidedAt, decidedAt, expectedResolutionAt: LESSON_FIXTURE_TIME, memoryIds: [], usedVersionId: null,
    staticPayload: adapter.staticPayload, configuration: { kind: 'scripted', revision } }, decidedAt))).decisionId as string;
  const body = { sourceId: 'retained-correction-' + lesson.id, scopeId: service.scopeId, subject: outcomeScope.subject,
    issuer: 'authored-correction-fixture', observedAt: LESSON_FIXTURE_TIME, payload: LESSON_FIXTURE_TRUTH as Json, decisionId };
  const source = { ...body, digest: await outcomeRevision(body) }; sources.set(source.sourceId, source);
  const resolutionId = outcomeValue(await service.resolve(command('resolve', { decisionId,
    evidence: [{ sourceId: source.sourceId, digest: source.digest }], receivedAt: LESSON_FIXTURE_TIME }))).resolutionId;
  const scoreId = outcomeValue(await service.score(command('score', { resolutionId }))).scoreId;
  async function candidate(setId: string, validationRunId: string, key: string) {
    const set = researchValue(await store.lessons.getSet(setId)); if (!set) throw Error('Missing native lesson set.');
    const versionId = outcomeValue(await service.reflect(command('reflect-' + key, { mode: 'create', scoreIds: [scoreId], parentVersionId: null,
      payload: set.payload, patch: [], text: 'Validate the retained correction against the independent registered rows.', citations: [scoreId],
      configuration: { kind: 'scripted', revision } }))).versionId as string;
    const prepared = researchValue(await prepareResearchLessonSlot({ store, outcomes: service, scope, adapter, versionId, validationRunId, slotId: key }));
    slots.set(key, prepared.slot); for (const row of prepared.sources) sources.set(row.sourceId, row);
    const evaluated = await service.evaluate(command('evaluate-' + key, { versionId, slotId: key })), evaluation = outcomeValue(evaluated);
    const evaluationId = evaluation.evaluationId as string;
    const approved = await service.approve(command('approve-' + key, { versionId, evaluationId,
      expectedHead: { versionId: null, revision: 0 }, action: 'promote', reason: 'Apply the unchanged native eligibility policy.' }));
    let activationEventId: string | null = null;
    if (approved.ok) {
      const approvalId = (approved.value as Record<string, Json>).approvalId;
      activationEventId = outcomeValue(await service.promote(command('promote-' + key, { approvalId }))).activationEventId as string;
      researchValue(await recordLessonActivation({ store, outcomes: service, scope, activationEventId }));
    }
    const record = outcomeValue(await service.inspect({ scopeId: service.scopeId, artifactKey, input: { id: evaluationId } }));
    return { versionId, evaluationId, activationEventId, eligible: evaluation.eligible === true, prepared,
      eligibilityIssues: (record.issues as unknown as OutcomeIssue[]).map(row => row.detail),
      refused: approved.ok ? [] : approved.issues };
  }
  return { adapter, service, candidate, command, revision };
}
