/** Synthetic lifecycle conformance uses native stores; these rows make no quality claim. */
import assert from 'node:assert/strict';
import { createOutcomeService, outcomeRevision, type OutcomeStore, type OutcomeService, type OutcomeAdapter,
  type Source, type EvaluationSlot, type Head, type Json } from '@tangleai/outcomes';
import { createLessonRefiner, createResearchLessonAdapter, prepareResearchLessonSlot, recordLessonActivation,
  researchLessonOutcomeScope, researchLessonArtifactKey, lessonInputHash, lessonValidity, researchRevisionOf,
  sealLessonValidationRun, type ResearchStore, type ResearchLessonV2, type LessonValidationRun, type LessonValidityOutput } from '@tangleai/research';
import type { SkillSnapshot } from '@tangleai/trace2skill';
import { id, value } from '../outcomes/fixtures.ts';
import { checked } from './fixtures.ts';
import { stored } from './store-harness.ts';
import { lessonScope, lessonNow, validity, validationFixture, reviseLesson } from './lessons-store-fixtures.ts';
import { correctionFixture } from './lessons-refiner-fixtures.ts';

export const outcomeAt = '2026-10-07T00:00:00.000Z', decisionAt = '2026-10-06T00:00:00.000Z';
export const output = (score: number): LessonValidityOutput => ({ ...validity, claimSupport: score });
export async function retainedValidation(store: ResearchStore, lesson: ResearchLessonV2, snapshot: SkillSnapshot,
  cases: Array<{ id: string; score: number; baseline: number; domain?: string }>) {
  stored(await store.lessons.putProcedure(snapshot));
  const original = await validationFixture(lesson, cases.map(row => ({ topicId: row.id, input: { question: 'registered independent ' + row.id } })));
  const { id: _id, revision: _revision, ...body } = original;
  body.bundleHash = snapshot.bundle.id;
  body.rows = body.rows.map((row, i) => ({ ...row, output: output(cases[i].score), baselineOutput: output(cases[i].baseline),
    score: cases[i].score, baselineScore: cases[i].baseline, ...(cases[i].domain ? { domain: cases[i].domain } : {}) }));
  body.lessonSetHash = await researchRevisionOf({ bundleHash: snapshot.bundle.id, lessonIds: [lesson.id],
    decayHypothesisId: lesson.decay.hypothesisId, rows: Object.fromEntries(body.rows.map(row => [row.inputHash, row.output])) });
  const run = checked(await sealLessonValidationRun(body)); stored(await store.lessons.putValidation(run)); return run;
}

export async function lessonOutcomeFixture(store: ResearchStore, outcomeStore: OutcomeStore,
  cases = [{ id: 'first-held-out', score: 1, baseline: 0, domain: 'default' }]) {
  const origin = await correctionFixture(store), refiner = createLessonRefiner(origin.options);
  const materialized = checked(await refiner.materialize({ proposalIds: [origin.lesson.id] }));
  const firstRun = await retainedValidation(store, origin.lesson, materialized.snapshot, cases);
  const futureRun = await retainedValidation(store, origin.lesson, materialized.snapshot, [{ id: 'future-held-out', score: .5, baseline: 0 }]);
  const staged = stored(await refiner.commit({ proposalIds: [origin.lesson.id], validationRunIds: [firstRun.id, futureRun.id] }));
  const sources = new Map<string, Source>(), slots = new Map<string, EvaluationSlot>();
  const scope = researchLessonOutcomeScope(lessonScope), artifactKey = researchLessonArtifactKey(lessonScope);
  const revision = await researchRevisionOf({ fixture: 'research-lesson-native-lifecycle' });
  let adapter: OutcomeAdapter, service: OutcomeService;
  const runs: LessonValidationRun[] = [firstRun, futureRun], sets = [staged.set];
  async function reload() {
    const previous = adapter;
    adapter = checked(await createResearchLessonAdapter({ store, scope: lessonScope, baseBundleHash: origin.snapshot.bundle.id,
      validationRunIds: runs.map(row => row.id), lessonSetIds: sets.map(row => row.id) }));
    if (previous) assert.deepEqual(adapter.identity, previous.identity, 'Adding a candidate over the frozen pool must preserve adapter identity.');
    service = await createOutcomeService({ store: outcomeStore, scope, adapters: [adapter],
      principal: { id: 'fixture-reviewer', authorityId: revision, approve: true, reconcile: false },
      resolver: { revision, async resolve(reference) { return sources.get(reference.sourceId); } },
      authorizeMemoryIds: async ids => ({ allowed: ids.length === 0, authorizationId: revision }),
      evaluationSlot: async slotId => slots.get(slotId) });
  }
  await reload();
  const command = (key: string, input: object, at = outcomeAt) => ({ scopeId: service.scopeId, artifactKey, requestKey: key, at, input });
  async function training(key: string, lesson: ResearchLessonV2) {
    const decisionId = id(await service.create(command('create-' + key, { decisionKey: lesson.origin.topicIds[0], adapter: adapter.identity,
      input: { topicId: lesson.origin.topicIds[0], inputHash: lessonInputHash({ training: key }) }, output: output(0),
      cutoffAt: decisionAt, decidedAt: decisionAt, expectedResolutionAt: outcomeAt, memoryIds: [], usedVersionId: null,
      staticPayload: adapter.staticPayload, configuration: { kind: 'scripted', revision } }, decisionAt)), 'decisionId');
    const body = { sourceId: 'training-source-' + key, scopeId: service.scopeId, subject: scope.subject, issuer: 'independent-fixture',
      observedAt: outcomeAt, payload: validity as unknown as Json, decisionId };
    const source = { ...body, digest: await outcomeRevision(body) }; sources.set(source.sourceId, source);
    const resolutionId = id(await service.resolve(command('resolve-' + key, { decisionId, evidence: [{ sourceId: source.sourceId, digest: source.digest }], receivedAt: outcomeAt })), 'resolutionId');
    return id(await service.score(command('score-' + key, { resolutionId })), 'scoreId');
  }
  const scoreId = await training('root', origin.lesson);
  async function reflect(key: string, payload: Json, parentVersionId: string | null = null) {
    return service.reflect(command('reflect-' + key, { mode: parentVersionId ? 'evolve' : 'create', scoreIds: [scoreId], parentVersionId,
      payload: parentVersionId ? null : payload, patch: parentVersionId ? Object.entries(payload as Record<string, Json>).map(([key, value]) => ({ op: 'replace', path: '/' + key, value })) : [],
      text: 'Apply a retained guarded correction after independent paired validation.', citations: [scoreId], configuration: { kind: 'scripted', revision } }));
  }
  async function evaluate(versionId: string, run: LessonValidationRun, slotId: string) {
    const prepared = checked(await prepareResearchLessonSlot({ store, outcomes: service, adapter, scope: lessonScope,
      validationRunId: run.id, versionId, slotId }));
    slots.set(slotId, prepared.slot); for (const source of prepared.sources) sources.set(source.sourceId, source);
    const result = await service.evaluate(command('evaluate-' + slotId, { versionId, slotId }));
    return { prepared, result, evaluationId: id(result, 'evaluationId') };
  }
  async function approve(versionId: string, evaluationId: string, expectedHead: Head, key: string, action: 'promote' | 'rollback' = 'promote') {
    return service.approve(command('approve-' + key, { versionId, evaluationId, expectedHead, action, reason: 'Reviewed the retained independent paired rows.' }));
  }
  async function root() {
    const versionId = id(await reflect('root', staged.set.payload as unknown as Json), 'versionId');
    const evaluated = await evaluate(versionId, firstRun, 'root-slot');
    const approvalId = id(await approve(versionId, evaluated.evaluationId, { versionId: null, revision: 0 }, 'root'), 'approvalId');
    const activation = await service.promote(command('promote-root', { approvalId })), activationEventId = id(activation, 'activationEventId');
    const audit = stored(await recordLessonActivation({ store, outcomes: service, scope: lessonScope, activationEventId }));
    return { versionId, ...evaluated, activation, activationEventId, audit, head: value(activation).head as unknown as Head };
  }
  async function child(parentVersionId: string) {
    const correction = await correctionFixture(store, { id: 'child-origin' });
    const lesson = await reviseLesson(correction.lesson, body => { body.proposal.baseHash = staged.snapshot.bundle.id;
      body.proposal.edit.operations = [{ op: 'create_file', path: 'references/second-policy.md', group: 'second-policy', content: 'Retain every independent verification receipt.\n' }]; });
    stored(await store.lessons.putProposal(lesson));
    const refiner = createLessonRefiner({ store, scope: lessonScope, now: () => lessonNow, async read() {
      const head = value(await service.injectChecked({ scopeId: service.scopeId, artifactKey, input: {} }));
      assert.equal(head.versionId, parentVersionId);
      return { snapshot: staged.snapshot, set: staged.set };
    } });
    const preview = checked(await refiner.materialize({ proposalIds: [lesson.id] }));
    const run = await retainedValidation(store, lesson, preview.snapshot, [{ id: 'future-held-out', score: 1, baseline: .5 }]);
    const next = stored(await refiner.commit({ proposalIds: [lesson.id], validationRunIds: [run.id] }));
    runs.push(run); sets.push(next.set); await reload();
    const versionId = id(await reflect('child', next.set.payload as unknown as Json, parentVersionId), 'versionId');
    const evaluated = await evaluate(versionId, run, 'child-slot');
    assert.equal(lessonValidity(run.rows[0].baselineOutput), .5);
    return { ...evaluated, versionId, next, run, lesson };
  }
  return { origin, staged, firstRun, futureRun, sources, slots, runs, sets, revision, artifactKey, scoreId,
    get adapter() { return adapter; }, get service() { return service; }, command, reflect, evaluate, approve, root, child };
}
