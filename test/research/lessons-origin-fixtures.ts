/** Authored native-record conformance, independent of measured research rows. */
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { extractTextDocument, type DocumentVersion } from '@tangleai/documents';
import { extractEvidenceCards, planProjectCreate, planStateTransition, planStageCommit, researchRevisionOf,
  type ResearchStore, type ResearchRecordWrite, type LiteratureRecord, type SourceAcquisition, type ResearchClaimLedger,
  type Draft, type ResearchDraftVerification, type Review, type Intervention, type ExperimentRun } from '@tangleai/research';
import { attempt, checked, hash, manifest, project } from './fixtures.ts';
import { stored } from './store-harness.ts';
import { lessonNow, reviseLesson } from './lessons-store-fixtures.ts';
import { correctionFixture } from './lessons-refiner-fixtures.ts';

export async function webOriginFixture(store: ResearchStore) {
  const corroborating = await correctionFixture(store), owner = { ...project('web-origin'), lessonContext: { topicId: 'web-training-topic',
    taskFamily: corroborating.lesson.scope.taskFamily, input: { question: 'authored source correction', partition: 7 } } };
  let state = stored(await store.createProject(checked(planProjectCreate(owner))));
  state = stored(await store.transition(checked(planStateTransition(state, 'DISCOVERY'))));
  const text = 'Retain every registered seed output.', bytes = new TextEncoder().encode(text);
  const input = manifest(owner.id), row = await attempt(input);
  const descriptor = { projectId: owner.id, attempt: { projectId: owner.id, stage: row.stage, attemptOrdinal: row.attemptOrdinal, inputManifestHash: row.inputManifestHash },
    verification: 'verified' as const, parents: [{ artifactId: owner.id, admissionId: null }] };
  const source = stored(await store.stageArtifact(bytes, { ...descriptor, mediaType: 'text/plain' }));
  const version: DocumentVersion = { id: hash('c'), sourceId: 'authored-web-source', contentHash: source.artifact.id.slice(4),
    extractionVersion: 'fixture-extraction/v1', chunkerVersion: 'fixture-chunker/v1', chunkerConfig: { maxTokens: 100, overlapTokens: 0 },
    embeddedBy: { model: 'fixture', dims: 1 }, status: 'active', fetchedAt: lessonNow,
    metrics: { bytes: bytes.length, elements: 1, chunks: 0, extractionMs: 0, chunkingMs: 0, embeddingMs: 0, embeddingCalls: 0,
      estimatedEmbeddingTokens: 0, partial: false, warnings: [] } };
  const elements = extractTextDocument(text, false).elements.map((element, order) => ({ ...element, id: 'authored-element-' + order,
    versionId: version.id, sourceId: version.sourceId, order }));
  const literature: LiteratureRecord = { id: 'authored-literature', title: 'Complete experiment output', authors: ['Tangle fixture'], date: '2026-09-13',
    canonicalIds: {}, rawHashes: [{ source: 'openalex', sha256: hash() }], sourcePath: 'https://fixture.example.test/source', resolution: 'resolved',
    licence: { spdx: 'MIT', provenance: 'tangle-authored-synthetic', source: 'Authored native-record conformance fixture.' } };
  const card = checked(await extractEvidenceCards({ literatureId: literature.id, version, elements, bytes, promptRevision: hash(), maxCards: 1 }))[0];
  const acquisitionBody: Omit<SourceAcquisition, 'id'> = { literatureId: literature.id, status: 'resolved', versionId: version.id,
    contentHash: version.contentHash, artifactId: source.artifact.id, issues: [] };
  const acquisition = { ...acquisitionBody, id: 'acquisition-' + await researchRevisionOf(acquisitionBody) };
  const records: ResearchRecordWrite[] = [{ kind: 'LiteratureRecord', value: literature }, { kind: 'SourceAcquisition', value: acquisition }, { kind: 'EvidenceCard', value: card }];
  const versions = stored(await store.stageArtifact(new TextEncoder().encode(canonicalizeJson({ kind: 'source-versions', value: [{
    id: version.id, sourceId: version.sourceId, contentHash: version.contentHash, extractionVersion: version.extractionVersion, elements,
  }] })), { ...descriptor, mediaType: 'application/json' }));
  const artifact = stored(await store.stageArtifact(new TextEncoder().encode(canonicalizeJson({ kind: 'discovery-records', value: records })), { ...descriptor, mediaType: 'application/json' }));
  row.outputArtifactIds = [source.artifact.id, versions.artifact.id, artifact.artifact.id];
  stored(await store.commitStage(checked(await planStageCommit({ state, attempt: row, manifest: input, nextStatus: 'LITERATURE_GATE', artifactAdmissionIds: [source.id, versions.id, artifact.id], records }))));
  const contentHash = await researchRevisionOf(owner.lessonContext.input);
  const lesson = await reviseLesson(corroborating.lesson, body => {
    body.projectId = owner.id; body.origin = { kind: 'retrieved-web', runId: owner.id, topicIds: [owner.lessonContext.topicId], topicContentHashes: [],
      artifactIds: [artifact.artifact.id], hashes: [artifact.artifact.id.slice(4)], envelope: {
        version: 1, artifacts: [{ id: artifact.artifact.id, kind: 'retrieved-web', locator: artifact.id, digest: artifact.artifact.id.slice(4) }],
        evidence: [{ id: 'web-card', artifact: artifact.artifact.id, selector: '/value/2/value/excerpt', quote: card.excerpt }],
        claims: [{ id: 'web-correction', text: text, critical: true, status: 'supported', evidence: ['web-card'] }], visibleEvidence: ['web-card'] } };
    body.origin.topicContentHashes = [contentHash]; body.decay.observedAtRun = owner.id;
  });
  return { ...corroborating, corroborating, owner, source, card, acquisition, lesson, artifact };
}

export async function alternateOriginFixture(store: ResearchStore, kind: 'review' | 'verification' | 'intervention' | 'attempt', executionFailure = false) {
  const f = await correctionFixture(store), projectId = f.owner.id;
  let state = stored(await store.getState(projectId))!;
  const envelope = { version: 1 as const, artifacts: [], evidence: [], claims: [], visibleEvidence: [] };
  const records: ResearchRecordWrite[] = [];
  let document: unknown, selector: string, quote: string;
  const finding = 'Retain every registered seed output.';
  if (kind === 'review' || kind === 'verification') {
    state = stored(await store.transition(checked(planStateTransition(state, 'WRITE'))));
    state = stored(await store.transition(checked(planStateTransition(state, 'VERIFY'))));
  }
  if (kind === 'review') {
    const review: Review = { id: 'fixture-review', projectId, reviewerIdentityId: hash('b'), artifactIds: [], claimIds: [], verdict: 'revise', findings: [finding] };
    records.push({ kind: 'Review', value: review }); document = { kind: 'writing-records', value: records }; selector = '/value/0/value/findings/0'; quote = finding;
  } else if (kind === 'verification') {
    const ledgerBody: Omit<ResearchClaimLedger, 'id'> = { projectId, scope: 'research-draft', decisionId: null, analysisId: null, claims: [], envelope };
    const ledger = { ...ledgerBody, id: 'ledger-' + await researchRevisionOf(ledgerBody) };
    const draftBody: Omit<Draft, 'id'> = { projectId, ledgerId: ledger.id, mode: 'template', writer: { roleId: 'fixture-writer', promptRevision: hash(), modelIdentity: 'fixture' }, sections: [] };
    const draft = { ...draftBody, id: 'draft-' + await researchRevisionOf(draftBody) };
    const verificationBody: Omit<ResearchDraftVerification, 'id'> = { projectId, draftId: draft.id, ledgerId: ledger.id, state: 'refused', claims: [], envelope,
      issues: [{ code: 'TRSH1005', path: '/claims', detail: finding }] };
    const verification = { ...verificationBody, id: 'verification-' + await researchRevisionOf(verificationBody) };
    records.push({ kind: 'ResearchClaimLedger', value: ledger }, { kind: 'Draft', value: draft }, { kind: 'ResearchDraftVerification', value: verification });
    document = { kind: 'writing-records', value: records }; selector = '/value/2/value/issues/0/detail'; quote = finding;
  } else if (kind === 'intervention') {
    const intervention: Intervention = { id: 'fixture-guidance', gate: 'design', actor: 'human', action: 'guidance', reviewedManifestHash: hash(),
      approvedManifestHash: null, substantive: true, effect: { kind: 'retry', target: 'DESIGN', editedArtifactId: null, guidanceHash: await researchRevisionOf({ text: finding }) } };
    records.push({ kind: 'Intervention', value: intervention }); document = { responseKey: intervention.id,
      response: { decision: 'guide', actor: 'human', note: finding, approvedManifestHash: hash() }, intervention };
    selector = '/response/note'; quote = finding;
  } else {
    state = stored(await store.transition(checked(planStateTransition(state, executionFailure ? 'EXECUTE' : 'WRITE'))));
    if (executionFailure) {
      const run: ExperimentRun = { id: 'fixture-failed-experiment', projectId, programId: 'fixture-program', condition: 'candidate', seed: 1,
        executionManifestHash: hash(), inputHash: hash(), rawArtifactHash: null, output: null, status: 'failed',
        error: { code: 'TRSH1005', path: '/outputs', detail: finding }, trace: [{ event: 'failure', detail: finding }],
        spend: { calls: 0, tokens: 0, ms: 0, physical: 0 } };
      records.push({ kind: 'ExperimentRun', value: run }); document = { kind: 'execution-records', value: records };
      selector = '/value/0/value/error/detail';
    } else {
      document = { kind: 'native-writing-failure', issue: { code: 'TRSH1005', path: '/claims', detail: finding }, attempts: [] };
      selector = '/issue/detail';
    }
    quote = finding;
  }
  const input = manifest(projectId, state.status), row = await attempt(input);
  if (kind === 'attempt') { row.stopReason = 'failed'; row.error = { code: 'TRSH1005', path: '/claims', detail: finding }; }
  if (kind === 'intervention') row.interventions = ['fixture-guidance'];
  const artifact = stored(await store.stageArtifact(new TextEncoder().encode(canonicalizeJson(document)), { projectId,
    attempt: { projectId, stage: row.stage, attemptOrdinal: row.attemptOrdinal, inputManifestHash: row.inputManifestHash },
    mediaType: kind === 'attempt' && !executionFailure ? 'application/vnd.tangleai.research-native-writing-failure+json' : 'application/json',
    verification: 'verified', parents: [{ artifactId: projectId, admissionId: null }] }));
  row.outputArtifactIds = [artifact.artifact.id];
  stored(await store.commitStage(checked(await planStageCommit({ state, attempt: row, manifest: input, nextStatus: 'STOPPED', artifactAdmissionIds: [artifact.id], records }))));
  const lesson = await reviseLesson(f.lesson, body => {
    body.origin.kind = kind; body.origin.artifactIds = [artifact.artifact.id]; body.origin.hashes = [artifact.artifact.id.slice(4)];
    body.origin.envelope.artifacts = [{ id: artifact.artifact.id, kind, locator: artifact.id, digest: artifact.artifact.id.slice(4) }];
    body.origin.envelope.evidence[0] = { ...body.origin.envelope.evidence[0], artifact: artifact.artifact.id, selector, quote };
  });
  stored(await store.lessons.putProposal(lesson)); return { ...f, lesson, artifact };
}
