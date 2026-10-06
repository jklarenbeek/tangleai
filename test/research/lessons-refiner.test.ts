import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createGuardedRefiner } from '@jarenjs/core/guarded';
import { createLessonRefiner, createMemoryResearchPersistence, createResearchStoreAdapter,
  researchRevisionOf, sealLessonSetRecord,
  type ResearchOutcome, type ResearchStoreOutcome, type ResearchMemoryState } from '@tangleai/research';
import { checked, hash } from './fixtures.ts';
import { memoryHarness, stored } from './store-harness.ts';
import { correctionFixture, validatedCorrectionFixture } from './lessons-refiner-fixtures.ts';
import { lessonFixture, lessonScope, reviseLesson } from './lessons-store-fixtures.ts';

function refused(result: ResearchOutcome<unknown> | ResearchStoreOutcome<unknown>, code: string, detail?: string) {
  const issues = 'valid' in result ? result.valid ? [] : result.issues : result.ok ? [] : [result.issue];
  assert.equal(issues[0]?.code, code, JSON.stringify(result)); if (detail) assert.ok(issues[0].detail.includes(detail), issues[0].detail);
  return issues[0];
}
it('materializes exact native bytes without staging records or modifying the frozen procedure', async () => {
  const h = await memoryHarness();
  try {
    const f = await correctionFixture(h.store), before = await h.capture();
    const preview = checked(await createLessonRefiner(f.options).materialize({ proposalIds: [f.lesson.id] }));
    assert.equal(preview.snapshot.bundle.parentId, f.snapshot.bundle.id); assert.notEqual(preview.snapshot.bundle.id, f.snapshot.bundle.id);
    assert.equal(preview.snapshot.bundle.status, 'staged'); assert.deepEqual(await h.capture(), before);
    assert.ok(preview.patches.every(patch => patch.sourceRolloutIds.length === 0 && patch.supportCount === 0));
    assert.deepEqual(preview.patches.at(-1)!.sourcePatchIds, preview.patches.slice(0, -1).map(row => row.id).sort());
  } finally { await h.close(); }
});
it('stages immutable descendants atomically, keeps the original proposal, and replays after clock advance', async () => {
  const h = await memoryHarness();
  try {
    const f = await validatedCorrectionFixture(h.store), prepared = checked(await f.refiner.prepare(f.request));
    const committed = stored(await f.refiner.commit(f.request)), before = await h.capture() as ResearchMemoryState;
    assert.deepEqual(committed.candidate, prepared.candidate); assert.equal(committed.set.payload.bundleHash, f.materialized.snapshot.bundle.id);
    assert.equal(committed.staged[0].parentId, f.lesson.id); assert.equal(committed.validated[0].parentId, committed.staged[0].id);
    assert.equal(committed.validated[0].validation.state, 'validated'); assert.equal(committed.validated[0].promotion, null);
    assert.deepEqual(stored(await h.store.lessons.get(f.lesson.id)), f.lesson);
    assert.equal(before.skillRows?.filter(row => row.table === 'heads').length, 0); assert.equal(before.skillRows?.filter(row => row.table === 'runs').length, 0);
    const replay = await createLessonRefiner({ ...f.options, now: () => '2027-01-01T00:00:00.000Z' }).commit(f.request);
    assert.ok(replay.ok); assert.equal(replay.replayed, true); assert.deepEqual(replay.value, committed); assert.deepEqual(await h.capture(), before);
  } finally { await h.close(); }
});
it('refuses malformed requests and missing or stale held-out validation before any staging', async () => {
  const h = await memoryHarness();
  try {
    const f = await validatedCorrectionFixture(h.store), before = await h.capture();
    refused(await f.refiner.prepare({ ...f.request, extra: true } as never), 'TRSH2001');
    refused(await f.refiner.prepare({ ...f.request, validationRunIds: [hash('f')] }), 'TRSH2004');
    refused(await createLessonRefiner({ ...f.options, validationRuns: new Map() }).commit(f.request), 'TRSH2004');
    assert.deepEqual(await h.capture(), before);
  } finally { await h.close(); }
});
it('refuses a caller-labelled verification and a non-corrective decision as eligible origins', async () => {
  for (const kind of ['label', 'Proceed'] as const) {
    const h = await memoryHarness();
    try {
      if (kind === 'label') {
        const f = await lessonFixture(h.store); stored(await h.store.lessons.putProposal(f.lesson));
        const result = await createLessonRefiner({ store: h.store, scope: lessonScope, read: async () => ({ snapshot: f.snapshot, set: null }), now: () => '' }).materialize({ proposalIds: [f.lesson.id] });
        refused(result, 'TRSH2002');
      } else {
        const f = await correctionFixture(h.store, { kind });
        refused(await createLessonRefiner(f.options).materialize({ proposalIds: [f.lesson.id] }), 'TRSH2002');
      }
    } finally { await h.close(); }
  }
});
it('requires the selector to identify the actual corrective finding, not a neighbouring record field', async () => {
  const h = await memoryHarness();
  try {
    const f = await correctionFixture(h.store), lesson = await reviseLesson(f.lesson, body => {
      body.origin.envelope.evidence[0].selector = '/value/0/value/id'; body.origin.envelope.evidence[0].quote = f.decision.id;
    });
    stored(await h.store.lessons.putProposal(lesson));
    refused(await createLessonRefiner(f.options).materialize({ proposalIds: [lesson.id] }), 'TRSH2002');
  } finally { await h.close(); }
});
it('wraps an async hook reached specifically through the native asynchronous commit runner', async () => {
  const h = await memoryHarness();
  try {
    const f = await validatedCorrectionFixture(h.store), before = await h.capture(); let calls = 0;
    const refiner = createLessonRefiner({ ...f.options, validateCandidate: () => ++calls === 1 ? { valid: true } : Promise.resolve({ valid: true }) });
    refused(await refiner.commit(f.request), 'TRSH2004', 'validateCandidate'); assert.equal(calls, 2); assert.deepEqual(await h.capture(), before);
  } finally { await h.close(); }
});
it('pins the current native synchronous thenable refusal and its distinct asynchronous commit behavior', async () => {
  let writes = 0;
  const engine = createGuardedRefiner({ read: async () => ({}), validateProposal: async () => ({ valid: true }), apply: () => ({}),
    validateCandidate: () => ({ valid: true }), planCommit: () => ({}), commit: async () => { writes++; } });
  const prepared = engine.prepare({}, {}); assert.equal(prepared.valid, false); assert.equal(prepared.errors[0].code, 'GUARDED');
  assert.match(prepared.errors[0].message, /asynchronous hook/); assert.equal(writes, 0);
  assert.equal((await engine.commit({})).ok, true); assert.equal(writes, 1);
});
it('copies requests before a checked read can yield', async () => {
  const h = await memoryHarness();
  try {
    const f = await validatedCorrectionFixture(h.store), request = structuredClone(f.request), pending = f.refiner.prepare(request);
    request.proposalIds[0] = hash('f'); assert.equal((await pending).valid, true);
  } finally { await h.close(); }
});
it('refuses a rehashed candidate whose stored receipt disagrees with its compiled patch', async () => {
  const h = await memoryHarness();
  try {
    const f = await validatedCorrectionFixture(h.store), committed = stored(await f.refiner.commit(f.request));
    const state = await h.capture() as ResearchMemoryState;
    const native = state.skillRows!.find(row => row.table === 'candidates' && row.id === committed.candidate.id)!;
    const { id: _id, ...body } = committed.candidate;
    body.churn += 1; const candidate = { ...body, id: await researchRevisionOf(body) };
    native.id = candidate.id; native.payload = candidate;
    const { id: _setId, revision: _revision, ...setBody } = committed.set;
    const set = checked(await sealLessonSetRecord({ ...setBody, candidateId: candidate.id }));
    const row = state.rows.find(row => row.table === 'lessonSets' && row.id === set.id)!; row.payload = set;
    const persistence = createMemoryResearchPersistence({ state });
    try {
      const store = createResearchStoreAdapter(persistence), before = persistence.exportState();
      const result = await createLessonRefiner({ ...f.options, store, read: async () => ({ snapshot: committed.snapshot, set }) }).prepare(f.request);
      refused(result, 'TRSH2004'); assert.deepEqual(persistence.exportState(), before);
    } finally { await persistence.close(); }
  } finally { await h.close(); }
});
it('serializes concurrent staging and refuses every partial-write failure without native activation', async () => {
  const h = await memoryHarness();
  let steps: string[];
  try {
    const f = await validatedCorrectionFixture(h.store); h.arm(null); stored(await f.refiner.commit(f.request)); steps = h.steps();
  } finally { await h.close(); }
  const targets = steps.map((step, index) => ({ step, boundary: index + 1 })).filter(({ step, boundary }) => step.includes('put:') || boundary === steps.length);
  assert.ok(targets.some(row => row.step === 'skill:put:candidates')); assert.ok(targets.some(row => row.step === 'put:lessonSets'));
  for (const target of targets) {
    const h = await memoryHarness();
    try {
      const f = await validatedCorrectionFixture(h.store), before = await h.capture(); h.arm(target.boundary);
      refused(await f.refiner.commit(f.request), 'TRSH1008'); assert.equal(h.steps().at(-1), target.step);
      assert.deepEqual(await h.capture(), before, target.step);
    } finally { await h.close(); }
  }
  const persistence = createMemoryResearchPersistence(), store = createResearchStoreAdapter(persistence);
  try {
    const f = await validatedCorrectionFixture(store);
    const results = await Promise.all(Array.from({ length: 20 }, () => createLessonRefiner(f.options).commit(f.request)));
    assert.ok(results.every(row => row.ok), JSON.stringify(results));
    assert.equal(results.filter(row => row.ok && !row.replayed).length, 1);
    assert.equal(persistence.exportState().skillRows?.filter(row => row.table === 'candidates').length, 1);
  } finally { await persistence.close(); }
});
