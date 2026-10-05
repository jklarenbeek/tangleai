import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createLessonRefiner } from '@tangleai/research';
import { memoryHarness, stored } from './store-harness.ts';
import { checked } from './fixtures.ts';
import { reviseLesson } from './lessons-store-fixtures.ts';
import { correctionFixture, retainCandidateValidation } from './lessons-refiner-fixtures.ts';
import { alternateOriginFixture, webOriginFixture } from './lessons-origin-fixtures.ts';

for (const kind of ['review', 'verification', 'intervention', 'attempt'] as const) it(`classifies a committed native ${kind} and materializes its correction`, async () => {
  const h = await memoryHarness();
  try {
    const f = await alternateOriginFixture(h.store, kind), before = await h.capture();
    const result = await createLessonRefiner(f.options).materialize({ proposalIds: [f.lesson.id] });
    checked(result); assert.deepEqual(await h.capture(), before);
  } finally { await h.close(); }
});
it('classifies a committed failed experiment and its failed owning stage', async () => {
  const h = await memoryHarness();
  try {
    const f = await alternateOriginFixture(h.store, 'attempt', true), before = await h.capture();
    checked(await createLessonRefiner(f.options).materialize({ proposalIds: [f.lesson.id] }));
    assert.deepEqual(await h.capture(), before);
  } finally { await h.close(); }
});
it('requires exact card/source binding and independent non-web corroboration before materializing a web lesson', async () => {
  const h = await memoryHarness();
  try {
    const f = await webOriginFixture(h.store); stored(await h.store.lessons.putProposal(f.lesson));
    const refiner = createLessonRefiner(f.options), before = await h.capture();
    const missing = await refiner.materialize({ proposalIds: [f.lesson.id] }); assert.equal(missing.valid, false);
    if (!missing.valid) assert.equal(missing.issues[0].code, 'TRSH2006'); assert.deepEqual(await h.capture(), before);
    const supported = await reviseLesson(f.lesson, body => { body.corroboration = { originIds: [f.corroborating.lesson.id] }; });
    stored(await h.store.lessons.putProposal(supported));
    const materialized = checked(await refiner.materialize({ proposalIds: [supported.id] }));
    const run = await retainCandidateValidation(h.store, supported, materialized.snapshot);
    const staged = stored(await refiner.commit({ proposalIds: [supported.id], validationRunIds: [run.id] }));
    assert.equal(staged.validated[0].origin.kind, 'retrieved-web');
  } finally { await h.close(); }
});
it('includes corroborating full input content in the held-out disjointness gate', async () => {
  const h = await memoryHarness();
  try {
    const f = await webOriginFixture(h.store), lesson = await reviseLesson(f.lesson, body => { body.corroboration = { originIds: [f.corroborating.lesson.id] }; });
    stored(await h.store.lessons.putProposal(lesson)); const refiner = createLessonRefiner(f.options);
    const preview = checked(await refiner.materialize({ proposalIds: [lesson.id] }));
    const validation = await retainCandidateValidation(h.store, lesson, preview.snapshot,
      [{ topicId: 'renamed-corroborating-topic', input: f.corroborating.owner.lessonContext.input }]);
    const before = await h.capture(), result = await refiner.commit({ proposalIds: [lesson.id], validationRunIds: [validation.id] });
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.issue.code, 'TRSH2005'); assert.deepEqual(await h.capture(), before);
  } finally { await h.close(); }
});
it('does not treat an unrelated valid correction as corroboration', async () => {
  const h = await memoryHarness();
  try {
    const f = await webOriginFixture(h.store), lesson = await reviseLesson(f.lesson, body => {
      body.corroboration = { originIds: [f.corroborating.lesson.id] }; body.proposal.edit.operations[0] = {
        op: 'create_file', path: 'references/unrelated.md', group: 'unrelated', content: 'Always choose the first result.\n' };
    });
    stored(await h.store.lessons.putProposal(lesson));
    const result = await createLessonRefiner(f.options).materialize({ proposalIds: [lesson.id] });
    assert.equal(result.valid, false); if (!result.valid) assert.equal(result.issues[0].code, 'TRSH2006');
  } finally { await h.close(); }
});
it('retains the native unadmitted-evidence code through the atomic refusal', async () => {
  const h = await memoryHarness();
  try {
    const f = await correctionFixture(h.store), lesson = await reviseLesson(f.lesson, body => { body.origin.envelope.artifacts[0].locator = 'admission-' + 'f'.repeat(64); });
    const result = await h.store.lessons.putProposal(lesson);
    assert.equal(result.ok, false); if (!result.ok) { assert.equal(result.issue.code, 'TRSH2002'); assert.equal(result.issue.cause?.code, 'EVIDENCE_UNADMITTED'); }
  } finally { await h.close(); }
});
