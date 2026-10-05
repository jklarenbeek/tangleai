import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryResearchPersistence, createResearchStoreAdapter, lessonDecayWeight, lessonInputHash,
  planStageCommit, sealLessonSetRecord, sealLessonValidationRun, researchRevisionOf, DECAY_HYPOTHESES,
  type ResearchStore, type ResearchStoreOutcome, type ResearchTransaction } from '@tangleai/research';
import { createResearchStore, openTangleDb, RESEARCH_COLLECTIONS, TRACE2SKILL_COLLECTIONS } from '@tangleai/store';
import { faultProbe, stored } from './store-harness.ts';
import { checked, hash } from './fixtures.ts';
import { lessonFixture, reviseLesson, validationFixture, procedure } from './lessons-store-fixtures.ts';

interface Harness {
  store: ResearchStore; capture(): Promise<unknown>; close(): Promise<void>;
  arm(value: number | null): void; steps(): string[];
}
async function memory(): Promise<Harness> {
  const probe = faultProbe(), persistence = createMemoryResearchPersistence({ applyProbe: probe.applyProbe });
  return { store: createResearchStoreAdapter(persistence), ...probe, capture: async () => persistence.exportState(), close: () => persistence.close() };
}
async function sqlite(): Promise<Harness> {
  const db = await openTangleDb(), probe = faultProbe();
  return { store: createResearchStore(db, { applyProbe: probe.applyProbe }), ...probe, close: () => db.close(),
    async capture() {
      const result: Record<string, unknown[]> = {};
      for (const name of [...Object.keys(RESEARCH_COLLECTIONS), ...Object.keys(TRACE2SKILL_COLLECTIONS)]) {
        const rows: unknown[] = [];
        for await (const row of db.collection(name).query({ $for: { r: '$[*]' }, $orderby: '$r.id', $return: '$r' })) rows.push(row);
        result[name] = rows;
      }
      return result;
    } };
}
function refused(value: ResearchStoreOutcome<unknown>, code: string) {
  assert.equal(value.ok, false, JSON.stringify(value)); if (!value.ok) assert.equal(value.issue.code, code, JSON.stringify(value.issue));
}
for (const [name, open] of [['memory', memory], ['SQLite', sqlite]] as const) describe(name + ' lesson admission', () => {
  it('retains immutable proposals and held-out rows, reconciles twice without writes, and exposes the same generic record', async () => {
    const h = await open();
    try {
      const { lesson } = await lessonFixture(h.store);
      stored(await h.store.lessons.putProposal(lesson));
      const run = await validationFixture(lesson); stored(await h.store.lessons.putValidation(run));
      const before = await h.capture(); h.arm(null);
      const replay = await h.store.lessons.putProposal(lesson), second = await h.store.lessons.putValidation(run);
      assert.equal(replay.ok && replay.replayed, true); assert.equal(second.ok && second.replayed, true);
      assert.deepEqual(await h.capture(), before); assert.equal(h.steps().filter(step => step.includes('put:')).length, 0);
      assert.deepEqual(stored(await h.store.getRecord(lesson.projectId, 'ResearchLesson', lesson.id)), lesson);
      assert.deepEqual(stored(await h.store.listRecords(lesson.projectId, 'ResearchLesson')), [lesson]);
      assert.deepEqual(stored(await h.store.lessons.list({ scope: lesson.scope })), [lesson]);
      assert.deepEqual(stored(await h.store.lessons.getValidation(run.id)), run);
      assert.deepEqual(stored(await h.store.lessons.listValidations(lesson.scope)), [run]);
      assert.equal(stored(await h.store.lessons.get(hash('f'))), null);
      assert.equal(stored(await h.store.lessons.getSet(hash('f'))), null);
      assert.equal(stored(await h.store.lessons.getInjection(hash('f'))), null);
      assert.deepEqual(stored(await h.store.lessons.listInjections(lesson.projectId)), []);
    } finally { await h.close(); }
  });
  it('refuses uncommitted origins, changed quotations, wrong scope, forged lifecycle authority and generic writes', async () => {
    const h = await open();
    try {
      const { lesson, plan } = await lessonFixture(h.store, { committed: false });
      refused(await h.store.lessons.putProposal(lesson), 'TRSH2002');
      const bypass = checked(await planStageCommit({ state: plan.expectedState, attempt: plan.attempt, manifest: plan.manifest,
        nextStatus: plan.nextState.status, artifactAdmissionIds: plan.artifactAdmissionIds, records: [{ kind: 'ResearchLesson', value: lesson }] }));
      refused(await h.store.commitStage(bypass), 'TRSH2007');
      stored(await h.store.commitStage(plan));
      refused(await h.store.putRecord(lesson.projectId, { kind: 'ResearchLesson', value: lesson }), 'TRSH2007');
      const changes: Array<Parameters<typeof reviseLesson>[1]> = [
        row => { row.origin.envelope.evidence[0].quote = 'A fabricated success.'; },
        row => { row.origin.envelope.evidence[0].selector = '/missing'; },
        row => { row.origin.envelope.evidence[0].selector = '/bad~9escape'; },
        row => { row.origin.topicContentHashes = [hash('f')]; },
        row => { row.origin.runId = 'another-run'; },
      ];
      for (const change of changes) refused(await h.store.lessons.putProposal(await reviseLesson(lesson, change)), 'TRSH2002');
      refused(await h.store.lessons.putProposal(await reviseLesson(lesson, row => { row.scope.taskFamily = 'another-family'; })), 'TRSH2003');
      refused(await h.store.lessons.putProposal(await reviseLesson(lesson, row => { row.validation.state = 'validated'; })), 'TRSH2007');
      refused(await h.store.lessons.putProposal({ ...lesson, revision: hash('f') }), 'TRSH2001');
      assert.deepEqual(stored(await h.store.lessons.list()), []);
    } finally { await h.close(); }
  });
  it('binds held-out ids and full content, rejects real short-hash collisions, and never trusts stored scores', async () => {
    const h = await open();
    try {
      const { lesson, owner } = await lessonFixture(h.store); stored(await h.store.lessons.putProposal(lesson));
      refused(await h.store.lessons.putValidation(await validationFixture(lesson, [{ topicId: 'new-name', input: owner.lessonContext.input }])), 'TRSH2005');
      refused(await h.store.lessons.putValidation(await validationFixture(lesson, [{ topicId: owner.lessonContext.topicId, input: { fresh: true } }])), 'TRSH2005');
      const a = { question: 'authored-held-out-48531', partition: 31 }, b = { question: 'authored-held-out-90477', partition: 73 };
      assert.equal(lessonInputHash(a), '1d7jhve'); assert.equal(lessonInputHash(a), lessonInputHash(b));
      const first = await validationFixture(lesson, [{ topicId: 'collision-a', input: a }]); stored(await h.store.lessons.putValidation(first));
      refused(await h.store.lessons.putValidation(await validationFixture(lesson, [{ topicId: 'collision-b', input: b }])), 'TRSH2004');
      refused(await h.store.lessons.putValidation(await validationFixture(lesson, [{ topicId: 'a', input: a }, { topicId: 'b', input: b }])), 'TRSH2004');
      const { id: _id, revision: _revision, ...body } = structuredClone(await validationFixture(lesson));
      body.rows[0].score = 0;
      refused(await h.store.lessons.putValidation(checked(await sealLessonValidationRun(body))), 'TRSH2004');
      body.rows[0].score = 1; body.lessonSetHash = hash('f');
      refused(await h.store.lessons.putValidation(checked(await sealLessonValidationRun(body))), 'TRSH2004');
    } finally { await h.close(); }
  });
  it('captures caller input before awaiting and returns detached copies', async () => {
    const h = await open();
    try {
      const { lesson } = await lessonFixture(h.store), input = structuredClone(lesson);
      const pending = h.store.lessons.putProposal(input); input.origin.envelope.evidence[0].quote = 'changed after submission';
      const landed = stored(await pending); assert.deepEqual(landed, lesson);
      landed.origin.envelope.evidence[0].quote = 'changed after read';
      assert.deepEqual(stored(await h.store.lessons.get(lesson.id)), lesson);
    } finally { await h.close(); }
  });
  it('rolls back failed proposal and validation writes at every boundary', async () => {
    for (const kind of ['proposal', 'validation'] as const) {
      async function setup(h: Harness): Promise<() => Promise<ResearchStoreOutcome<unknown>>> {
        const { lesson } = await lessonFixture(h.store);
        if (kind === 'proposal') return () => h.store.lessons.putProposal(lesson);
        stored(await h.store.lessons.putProposal(lesson)); const run = await validationFixture(lesson);
        return () => h.store.lessons.putValidation(run);
      }
      const sample = await open(); let steps: string[];
      try { const run = await setup(sample); sample.arm(null); stored(await run()); steps = sample.steps(); }
      finally { await sample.close(); }
      for (let i = 1; i <= steps!.length; i++) {
        const h = await open();
        try {
          const run = await setup(h), before = await h.capture(); h.arm(i);
          refused(await run(), 'TRSH1008'); h.arm(null); assert.deepEqual(await h.capture(), before);
          stored(await run());
        } finally { await h.close(); }
      }
    }
  });
  it('refuses changed skill bytes and rolls back every native procedure write and commit boundary', async () => {
    const snapshot = await procedure(), sample = await open(); let steps: string[];
    try {
      const wrong = structuredClone(snapshot); wrong.files[0].content += 'forged';
      refused(await sample.store.lessons.putProcedure(wrong), 'TRSH2001');
      refused(await sample.store.lessons.putProcedure({ ...snapshot, bundle: { ...snapshot.bundle, status: 'active' } }), 'TRSH2007');
      sample.arm(null); stored(await sample.store.lessons.putProcedure(snapshot)); steps = sample.steps();
      assert.ok(steps.length >= 3);
    } finally { await sample.close(); }
    for (let i = 1; i <= steps!.length; i++) {
      const h = await open();
      try {
        const before = await h.capture(); h.arm(i);
        refused(await h.store.lessons.putProcedure(snapshot), 'TRSH1008'); h.arm(null);
        assert.deepEqual(await h.capture(), before, steps![i - 1]);
        stored(await h.store.lessons.putProcedure(snapshot));
        const written = await h.capture(); h.arm(null);
        assert.equal((await h.store.lessons.putProcedure(snapshot)).ok, true);
        assert.deepEqual(await h.capture(), written); assert.equal(h.steps().filter(step => step.includes('put:')).length, 0);
      } finally { await h.close(); }
    }
  });
});

it('one retained lifecycle produces identical research records on memory and SQLite', async () => {
  const a = await memory(), b = await sqlite();
  async function run(store: ResearchStore) {
    const { lesson } = await lessonFixture(store); stored(await store.lessons.putProposal(lesson));
    const validation = await validationFixture(lesson); stored(await store.lessons.putValidation(validation));
    return { snapshot: stored(await store.snapshot(lesson.projectId)), lesson: stored(await store.lessons.get(lesson.id)),
      validation: stored(await store.lessons.getValidation(validation.id)), procedure: stored(await store.lessons.getProcedure(lesson.proposal.baseHash)) };
  }
  try { assert.deepEqual(await run(a.store), await run(b.store)); }
  finally { await a.close(); await b.close(); }
});

it('physical corruption is refused on lesson, validation and native procedure reads', async () => {
  const persistence = createMemoryResearchPersistence(), store = createResearchStoreAdapter(persistence);
  try {
    const { lesson } = await lessonFixture(store); stored(await store.lessons.putProposal(lesson));
    const run = await validationFixture(lesson); stored(await store.lessons.putValidation(run));
    const original = persistence.exportState();
    for (const target of ['lesson', 'validation', 'procedure'] as const) {
      const state = structuredClone(original);
      if (target === 'lesson') {
        const row = state.rows.find(row => row.table === 'lessons')!;
        (row.payload as typeof lesson).severity = 'low';
      } else if (target === 'validation') {
        const row = state.rows.find(row => row.table === 'lessonValidations')!;
        (row.payload as typeof run).rows[0].score = 0;
      } else {
        const row = state.skillRows!.find(row => row.table === 'files')!;
        assert.ok('content' in row.payload); row.payload.content = 'corrupted retained text';
      }
      const bad = createMemoryResearchPersistence({ state }), reader = createResearchStoreAdapter(bad);
      try {
        const result = target === 'lesson' ? await reader.lessons.get(lesson.id)
          : target === 'validation' ? await reader.lessons.getValidation(run.id) : await reader.lessons.getProcedure(lesson.proposal.baseHash);
        refused(result, 'TRSH2001');
      } finally { await bad.close(); }
    }
  } finally { await persistence.close(); }
});

it('native skill and research writes share one memory publication, and escaped handles refuse', async () => {
  const persistence = createMemoryResearchPersistence(); let escaped: ResearchTransaction | undefined;
  try {
    const snapshot = await procedure(), before = persistence.exportState();
    await assert.rejects(persistence.transaction(async tx => {
      escaped = tx; const written = await tx.skills.putSnapshot(snapshot); assert.ok(written.valid);
      throw new Error('after native skill writes');
    }), /after native skill writes/);
    assert.deepEqual(persistence.exportState(), before);
    await assert.rejects(escaped!.skills.getSnapshot(snapshot.bundle.id), /no longer active/);
    await assert.rejects(escaped!.scopes('lessons'), /no longer active/);
    assert.equal('head' in escaped!.skills, false); assert.equal('activate' in escaped!.skills, false);
  } finally { await persistence.close(); }
});

it('SQLite reopen retains origin, procedures, proposal and validation identities', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'research-lessons-')), path = join(dir, 'lessons.sqlite');
  let db = await openTangleDb({ path });
  try {
    const first = createResearchStore(db), { lesson } = await lessonFixture(first);
    stored(await first.lessons.putProposal(lesson)); const run = await validationFixture(lesson); stored(await first.lessons.putValidation(run));
    await db.close(); db = await openTangleDb({ path });
    const reopened = createResearchStore(db);
    assert.deepEqual(stored(await reopened.lessons.getValidation(run.id)), run);
    assert.deepEqual(stored(await reopened.lessons.get(lesson.id)), lesson);
    assert.equal((await reopened.lessons.putProposal(lesson)).ok, true);
  } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
});

it('record seals refuse malformed payloads as values and decay only uses registered retained observations', async () => {
  const h = await memory();
  try {
    assert.equal((await sealLessonSetRecord({} as never)).valid, false);
    const { lesson } = await lessonFixture(h.store);
    assert.deepEqual(lessonDecayWeight(lesson, 'none', 'future-run'), { valid: true, value: 1 });
    assert.equal(lessonDecayWeight(lesson, 'age-linear', 'future-run').valid, false);
    assert.equal(lessonDecayWeight(lesson, 'invented-rule', 'future-run').valid, false);
    const observed = await reviseLesson(lesson, row => { row.severity = 'medium'; row.decay.relevanceRows = [
      { runId: 'future-run', age: 2, relevance: .8, contradictions: 0, negativeTransfer: 0 } ]; });
    assert.deepEqual(lessonDecayWeight(observed, 'age-linear', 'future-run'), { valid: true, value: .4 });
    assert.deepEqual(lessonDecayWeight(observed, 'severity-weighted-age', 'future-run'), { valid: true, value: .2 });
    for (const hypothesis of DECAY_HYPOTHESES) {
      const { revision, ...body } = hypothesis; assert.equal(await researchRevisionOf(body), revision);
    }
  } finally { await h.close(); }
});
