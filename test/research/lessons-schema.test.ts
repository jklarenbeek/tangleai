import { it } from 'node:test';
import assert from 'node:assert/strict';
import { JarenValidator } from '@jarenjs/validate';
import { createGuardedRefiner } from '@jarenjs/core/guarded';
import { researchSchema, researchSchemaReferences, validateResearchShape } from '@tangleai/research';
import { CLAIM_EVIDENCE_SCHEMA } from '@tangleai/context';
import { trace2SkillSchemaOf } from '@tangleai/trace2skill';
import { loadResearchFixture } from '../../benchmark/lib/research-fixture.ts';
import { loadResearchLessonFixture } from '../../benchmark/lib/research-lessons-fixture.ts';
import lessonSchema from '../../packages/research/schemas/lesson.schema.json' with { type: 'json' };

it('lesson schemas reuse the evidence and typed-edit owners through their public versioned view', async () => {
  const fixture = await loadResearchLessonFixture(await loadResearchFixture());
  assert.deepEqual(researchSchema.$defs.ResearchClaimEnvelope, CLAIM_EVIDENCE_SCHEMA);
  assert.deepEqual(researchSchemaReferences[0], trace2SkillSchemaOf('authoredPatch'));
  const engine = new JarenValidator({ collectErrors: true, skipErrors: false });
  engine.addSchema([researchSchema, ...researchSchemaReferences]);
  const check = engine.compile(lessonSchema);
  assert.equal(check(fixture.beneficial).valid, true);
  assert.equal(check({ ...fixture.beneficial, arbitraryAuthority: true }).valid, false);
  assert.equal(lessonSchema.$id, 'https://tangleai.dev/schemas/research/lesson/v2');
  const operations = Array.from({ length: 6 }, () => fixture.beneficial.proposal.edit.operations[0]);
  const proposal = { ...fixture.beneficial.proposal, edit: { ...fixture.beneficial.proposal.edit, operations } };
  assert.equal(validateResearchShape('ResearchLessonProposal', proposal).valid, true);
  assert.equal(validateResearchShape('ResearchLessonProposal', { ...proposal, edit: { ...proposal.edit, operations: [...operations, operations[0]] } }).valid, false);
});

it('a decay hypothesis cannot rename its rule or add an unregistered parameter', () => {
  const value = { id: 'age-linear', kind: 'age-linear', revision: '1'.repeat(64),
    parameters: { horizon: 4, severityWeights: { low: .25, medium: .5, high: 1 } } };
  assert.equal(validateResearchShape('DecayHypothesis', value).valid, true);
  assert.equal(validateResearchShape('DecayHypothesis', { ...value, id: 'severity-weighted-age' }).valid, false);
  assert.equal(validateResearchShape('DecayHypothesis', { ...value, parameters: { ...value.parameters, halfLife: 10 } }).valid, false);
  assert.equal(validateResearchShape('DecayHypothesis', { ...value, id: 'automatic' }).valid, false);
});

it('lesson injection accepts native outcome hashes and refuses slugs or malformed digests', () => {
  const hash = '0'.repeat(64);
  const injection = { id: hash, runId: 'lesson-run', projectId: 'lesson-project',
    scope: { domainProfileId: 'computational', taskFamily: 'registered-experiment' }, lessonSetHash: hash, bundleHash: hash,
    activationEventId: hash, outcomeVersionId: hash };
  assert.equal(validateResearchShape('LessonInjection', injection).valid, true);
  for (const key of ['activationEventId', 'outcomeVersionId'] as const) {
    for (const invalid of ['outcome-version', 'f'.repeat(63), 'f'.repeat(65), 'A'.repeat(64)])
      assert.equal(validateResearchShape('LessonInjection', { ...injection, [key]: invalid }).valid, false, `${key}: ${invalid}`);
  }
});

it('the current native synchronous guarded boundary names an asynchronous-validator refusal', () => {
  const refiner = createGuardedRefiner({ read: async () => ({}), apply: value => value,
    validateProposal: async () => true, validateCandidate: () => true, planCommit: value => value, commit: async () => true });
  const result = refiner.prepare({}, {});
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, 'GUARDED');
  assert.match(result.errors[0].message, /asynchronous hook requires prepareAsync or commit/);
});
