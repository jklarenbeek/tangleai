import assert from 'node:assert/strict';
import { importBundle } from '@tangleai/trace2skill';
import { lessonInputHash, lessonScopeKey, lessonValidity, planProjectCreate, planStageCommit, planStateTransition,
  researchRevisionOf, sealResearchLesson, sealLessonValidationRun, type LessonValidationRun, type ResearchLessonV2,
  type ResearchStore, type LessonValidityOutput } from '@tangleai/research';
import { checked, project, manifest, attempt, hash } from './fixtures.ts';
import { stored } from './store-harness.ts';

export const lessonScope = { domainProfileId: 'computational', taskFamily: 'registered-experiment' };
export const lessonNow = '2026-10-05T00:00:00.000Z';
export const validity: LessonValidityOutput = { claimSupport: 1, registryAccuracy: 1, preregistrationIntegrity: 1, completion: true };
export async function procedure(text = '# Research procedure\n\nRetain every registered result.\n') {
  const value = await importBundle([{ path: 'SKILL.md', bytes: new TextEncoder().encode(text) }],
    { scopeKey: lessonScopeKey(lessonScope), mode: 'deepening', origin: 'human-import' });
  assert.ok(value.valid, JSON.stringify(value)); return value.value;
}
export async function lessonFixture(store: ResearchStore, options: { committed?: boolean; id?: string } = {}) {
  const owner = { ...project(options.id ?? 'lesson-origin'), lessonContext: { topicId: 'training-topic',
    taskFamily: lessonScope.taskFamily, input: { question: 'registered training experiment', partition: 1 } } };
  let state = stored(await store.createProject(checked(planProjectCreate(owner))));
  state = stored(await store.transition(checked(planStateTransition(state, 'DISCOVERY'))));
  const snapshot = await procedure(); stored(await store.lessons.putProcedure(snapshot));
  const input = manifest(owner.id), row = await attempt(input);
  const text = JSON.stringify({ finding: 'Retain every registered seed output.', valid: false });
  const artifact = stored(await store.stageArtifact(new TextEncoder().encode(text), { projectId: owner.id,
    attempt: { projectId: owner.id, stage: row.stage, attemptOrdinal: row.attemptOrdinal, inputManifestHash: row.inputManifestHash },
    mediaType: 'application/json', verification: 'verified', parents: [{ artifactId: owner.id, admissionId: null }] }));
  row.outputArtifactIds = [artifact.artifact.id];
  const plan = checked(await planStageCommit({ state, attempt: row, manifest: input, nextStatus: 'LITERATURE_GATE', artifactAdmissionIds: [artifact.id] }));
  if (options.committed !== false) stored(await store.commitStage(plan));
  const lesson = checked(await sealResearchLesson({ projectId: owner.id, schemaVersion: 2, parentId: null, scope: lessonScope,
    origin: { kind: 'verification', runId: owner.id, topicIds: [owner.lessonContext.topicId],
      topicContentHashes: [await researchRevisionOf(owner.lessonContext.input)], artifactIds: [artifact.artifact.id], hashes: [artifact.artifact.id.slice(4)],
      envelope: { version: 1, artifacts: [{ id: artifact.artifact.id, kind: 'verification', locator: artifact.id, digest: artifact.artifact.id.slice(4) }],
        evidence: [{ id: 'origin-evidence', artifact: artifact.artifact.id, selector: '/finding', quote: 'Retain every registered seed output.' }],
        claims: [{ id: 'origin-finding', text: 'The recorded verification requires complete seed output.', critical: true, status: 'supported', evidence: ['origin-evidence'] }],
        visibleEvidence: ['origin-evidence'] } },
    corroboration: null, proposal: { baseHash: snapshot.bundle.id, edit: { reasoning: 'Require complete registered output before analysis.',
      operations: [{ op: 'create_file', group: 'seed-policy', path: 'references/seed-policy.md', content: 'Retain every registered seed output.\n' }] } },
    severity: 'high', validation: { state: 'proposed', validationRunIds: [], issues: [] },
    decay: { hypothesisId: 'none', observedAtRun: owner.id, relevanceRows: [] }, promotion: null, recordedAt: lessonNow }));
  return { owner, snapshot, artifact, plan, lesson };
}
export async function reviseLesson(value: ResearchLessonV2, change: (value: Omit<ResearchLessonV2, 'id' | 'revision'>) => void) {
  const { id: _id, revision: _revision, ...body } = structuredClone(value); change(body);
  return checked(await sealResearchLesson(body));
}
export async function validationFixture(lesson: ResearchLessonV2, inputs: Array<{ topicId: string; input: LessonValidationRun['rows'][number]['input'] }> = [
  { topicId: 'held-out-topic', input: { question: 'independently registered held-out experiment', partition: 2 } },
]): Promise<LessonValidationRun> {
  const rows = await Promise.all(inputs.map(async value => ({ ...value, inputHash: lessonInputHash(value.input),
    topicContentHash: await researchRevisionOf(value.input), output: validity, baselineOutput: { ...validity, claimSupport: .5 },
    score: lessonValidity(validity), baselineScore: .5, truth: validity,
    spend: { calls: 0, tokens: 0, physical: 0, replayed: 0, ms: 0, cost: 0 } })));
  const payload = { bundleHash: lesson.proposal.baseHash, lessonIds: [lesson.id], decayHypothesisId: lesson.decay.hypothesisId,
    rows: Object.fromEntries(rows.map(row => [row.inputHash, row.output])) };
  return checked(await sealLessonValidationRun({ scope: lesson.scope, baseBundleHash: lesson.proposal.baseHash,
    bundleHash: payload.bundleHash, lessonSetHash: await researchRevisionOf(payload), proposalIds: payload.lessonIds,
    topicIds: rows.map(row => row.topicId), rows, identityId: hash(), evaluatorRevision: hash('b'), registrationId: hash('c'),
    promptVersions: [hash('d')], startedAt: lessonNow, finishedAt: lessonNow, issues: [] }));
}
