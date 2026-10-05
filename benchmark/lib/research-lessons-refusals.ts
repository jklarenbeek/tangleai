/** Each hostile fixture traverses the native boundary named in its retained receipt. */
import { createMemoryOutcomeStore } from '@tangleai/outcomes';
import { sealSkillBundle, draftsOf } from '@tangleai/trace2skill';
import { createMemoryResearchPersistence, createResearchStoreAdapter, createLessonRefiner, lessonInputHash, lessonValidity,
  researchValue, researchRevisionOf, sealResearchLesson, type LessonValidationRow, type ResearchIssue, type ResearchLessonV2 } from '@tangleai/research';
import { LESSON_FIXTURE_TIME, LESSON_FIXTURE_TRUTH, materializeLessonCorrection, materializeLessonWebOrigin,
  proposeFixtureLesson, lessonOutcomeHost, zeroLessonSpend } from '../../apps/research-runner/src/lessons.ts';
import { nativeLessonMeasurement, nativeLessonRefusal, researchLessonFixtureProcedure, retainLessonValidation } from './research-lessons-mechanism.ts';
import type { LoadedResearchFixture } from './research-fixture.ts';
import type { LoadedLessonFixture, LessonNegativeBundle } from './research-lessons-fixture.ts';

export async function probeNativeLessonNegative(loaded: LoadedResearchFixture, fixture: LoadedLessonFixture, negative: LessonNegativeBundle) {
  const persistence = createMemoryResearchPersistence(), store = createResearchStoreAdapter(persistence), native = nativeLessonMeasurement('synthetic-refusal');
  const record = (issue: ResearchIssue) => { nativeLessonRefusal(native, issue, negative.expected.code); return native; };
  try {
    const procedure = await researchLessonFixtureProcedure(fixture), id = 'lesson-negative-' + negative.id;
    const origin = await materializeLessonCorrection({ store, scope: fixture.registration.scope, id, procedure,
      contract: loaded.topics[0].contract, plan: loaded.topics[0].plan, finding: 'Check registered metric units before accepting the output.',
      ...(negative.id === 'leaked-origin' ? { topicId: 'native-negative-held-out-0', input: { registered: 'negative-held-out', index: 0 } } : {}) });
    const owner = negative.id === 'web-uncorroborated'
      ? await materializeLessonWebOrigin(store, origin.project, 'Check registered metric units before accepting the output.') : origin.project;
    const proposed = await proposeFixtureLesson({ store, scope: fixture.registration.scope, runId: owner.id, procedure,
      edit: fixture.beneficial.proposal.edit, decayHypothesisId: 'none' });
    if (proposed.proposals.length !== 1 || proposed.spend.tokens === null || proposed.spend.physical === null)
      throw Error('Native refusal fixture has no admitted source-bound proposal: ' + JSON.stringify(proposed));
    let lesson: ResearchLessonV2 = proposed.proposals[0]; native.proposalIds = [lesson.id];
    native.proposerSpend = { ...zeroLessonSpend(), calls: proposed.spend.calls, tokens: proposed.spend.tokens,
      physical: proposed.spend.physical, ms: proposed.spend.ms, replayed: proposed.spend.replayed };
    if (negative.id === 'cross-domain' || negative.id === 'unsupported') {
      const { id: _id, revision: _revision, ...body } = structuredClone(lesson);
      if (negative.id === 'cross-domain') body.scope = { ...body.scope, domainProfileId: 'foreign-profile' };
      else {
        const hash = await researchRevisionOf({ unadmitted: 'foreign-artifact' }), artifactId = 'art-' + hash;
        body.origin.artifactIds = [artifactId]; body.origin.hashes = [hash];
        body.origin.envelope.artifacts = [{ id: artifactId, kind: body.origin.kind, digest: hash, locator: 'admission-' + hash }];
        body.origin.envelope.evidence[0].artifact = artifactId;
      }
      lesson = researchValue(await sealResearchLesson(body)); native.proposalIds = [lesson.id];
      const result = await store.lessons.putProposal(lesson);
      if (result.ok) throw Error('A hostile proposal was admitted: ' + negative.id);
      return record(result.issue);
    }
    let active = procedure;
    if (negative.id === 'active-edit-attempt') {
      const changed = await sealSkillBundle(draftsOf(procedure.files).map(file => file.path === 'SKILL.md'
        ? { ...file, content: file.content + '\nAn independent reviewed procedure.\n' } : file), { ...procedure.bundle });
      if (!changed.valid) throw Error('Changed active fixture could not be sealed.');
      active = changed.value; researchValue(await store.lessons.putProcedure(active));
    }
    const refiner = createLessonRefiner({ store, scope: fixture.registration.scope, now: () => LESSON_FIXTURE_TIME,
      read: async () => ({ snapshot: active, set: null }),
      ...(negative.asyncValidator ? { validateCandidate: async () => ({ valid: true, errors: [] }) } : {}) });
    native.phase = 'materialization';
    const preview = await refiner.materialize({ proposalIds: [lesson.id] });
    if (!preview.valid) return record(preview.issues[0]);
    native.candidateBundleHash = preview.value.snapshot.bundle.id;
    const rows: LessonValidationRow[] = [];
    for (const [index, score] of negative.candidateUtilities.entries()) {
      const input = { registered: 'negative-held-out', index }, baseline = negative.baselineUtilities[index];
      const output = { ...LESSON_FIXTURE_TRUTH, claimSupport: score }, baselineOutput = { ...LESSON_FIXTURE_TRUTH, claimSupport: baseline };
      rows.push({ topicId: 'native-negative-held-out-' + index, input, inputHash: lessonInputHash(input),
        topicContentHash: await researchRevisionOf(input), output, baselineOutput, score: lessonValidity(output), baselineScore: lessonValidity(baselineOutput),
        truth: LESSON_FIXTURE_TRUTH, domain: index === 2 ? 'minority' : 'majority', spend: zeroLessonSpend() });
    }
    native.phase = 'validation';
    const retained = await retainLessonValidation({ store, lesson, snapshot: preview.value.snapshot, rows, registrationId: fixture.registration.revision });
    if (!retained.ok) return record(retained.issue);
    native.validationRun = retained.value;
    native.phase = 'staging';
    const staged = await refiner.commit({ proposalIds: [lesson.id], validationRunIds: [retained.value.id] });
    if (!staged.ok) return record(staged.issue);
    native.stagedIds = staged.value.staged.map(row => row.id); native.validatedIds = staged.value.validated.map(row => row.id);
    native.candidateSetHash = staged.value.set.id;
    const host = await lessonOutcomeHost({ store, outcomeStore: createMemoryOutcomeStore(), scope: fixture.registration.scope, lesson,
      baseBundleHash: procedure.bundle.id, validationRunIds: [retained.value.id], lessonSetIds: [staged.value.set.id] });
    const evaluated = await host.candidate(staged.value.set.id, retained.value.id, negative.id);
    Object.assign(native, { phase: 'approval', versionId: evaluated.versionId, evaluationId: evaluated.evaluationId,
      activationEventId: evaluated.activationEventId });
    if (!evaluated.refused.length) throw Error('The hostile native candidate unexpectedly earned activation: ' + negative.id);
    return record({ code: 'TRSH2007', path: '/approval', detail: evaluated.eligibilityIssues.join(' '), cause: evaluated.refused[0] });
  } finally { await persistence.close(); }
}
