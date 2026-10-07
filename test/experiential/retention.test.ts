import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createExperientialMemoryStore, planExperientialRetention, resolveExperientialLineage, planExperientialSelection,
  planExperienceTransition, EXPERIENTIAL_TABLES } from '@tangleai/experiential';
import { accepted, addressedFixture } from './identity-fixtures.ts';
import { retentionFixture } from './retention-fixtures.ts';
import { SELECTION_TIME } from './selection-fixtures.ts';

async function fixture(applyProbe?: (step: string) => void) {
  const store = createExperientialMemoryStore({ now: () => SELECTION_TIME, applyProbe });
  const f = await retentionFixture(store);
  const state = async () => Object.fromEntries(await Promise.all(EXPERIENTIAL_TABLES.map(async table => [table, accepted(await store.list(table, 'fixture'))])));
  return { ...f, store, state };
}
const refusal = (result: Awaited<ReturnType<typeof planExperientialRetention>>, text: string) => {
  assert.equal(result.ok, false, JSON.stringify(result));
  if (!result.ok) { assert.equal(result.issues[0].code, 'TEXP1012'); assert.ok(result.issues[0].detail.includes(text), JSON.stringify(result)); }
};

it('archives a retained dataset source atomically, preserves complete lineage and excludes it from future selection', async () => {
  const f = await fixture();
  try {
    const input = await f.snapshot(), plan = accepted(await planExperientialRetention(input));
    assert.equal(plan.changes.length, 1); assert.equal(plan.decisions[0].decision, 'archive');
    const head = accepted(await f.store.head(f.deployment.profile, 'fixture'));
    accepted(await f.store.retain(plan));
    const archived = accepted(await f.store.get('experiences', f.experience.id))!;
    assert.equal(archived.state, 'archived'); assert.deepEqual(archived.sourceRefs, f.experience.sourceRefs);
    const lineage = accepted(await resolveExperientialLineage(f.store, f.artifact.id));
    assert.equal(lineage.experiences[0].state, 'archived'); assert.ok(lineage.sourceRefs.some(ref => ref.sourceId === input.episodeIds[0]));
    const selection = accepted(await planExperientialSelection({ ...f.input, experiences: [archived] }));
    assert.equal(selection.counts.selected, 0); assert.equal(selection.counts.byReason.archived, 1);
    assert.equal(planExperienceTransition(archived, 'selected').ok, false);
    const before = await f.state(), retry = await f.store.retain(plan); assert.ok(retry.ok); assert.equal(retry.writes, 0);
    assert.deepEqual(await f.state(), before); assert.deepEqual(accepted(await f.store.head(f.deployment.profile, 'fixture')), head);
  } finally { await f.store.close(); }
});

it('keeps sources without changing their state and refuses deletion or every serving/evaluation dependency', async () => {
  const f = await fixture();
  try {
    const keep = accepted(await planExperientialRetention(await f.snapshot(await f.policy({ decision: 'keep' }))));
    assert.equal(keep.changes.length, 0); accepted(await f.store.retain(keep));
    assert.deepEqual(accepted(await f.store.get('experiences', f.experience.id)), f.experience);
    refusal(await planExperientialRetention(await f.snapshot(await f.policy({ decision: 'delete' }))), 'delete-disabled');
    for (const state of ['staged', 'evaluating', 'approved', 'canary', 'active'] as const) {
      const input = await f.snapshot(); input.artifacts = input.artifacts.map(artifact => artifact.id === f.artifact.id ? { ...artifact, state } : artifact);
      refusal(await planExperientialRetention(input), 'active-lineage');
    }
  } finally { await f.store.close(); }
});

it('names rollback windows, holds and sole provenance as separate archival refusals', async () => {
  const f = await fixture();
  try {
    const input = await f.snapshot();
    input.artifacts = input.artifacts.map(artifact => artifact.id === f.artifact.id ? { ...artifact, state: 'archived' } : artifact);
    input.lineage.events.push(await addressedFixture('event', { seq: Math.max(...input.lineage.events.map(event => event.seq)) + 1,
      kind: 'artifact-activated', recordId: f.artifact.id, detail: 'Authored activation-window observation for pure policy conformance.' }));
    refusal(await planExperientialRetention(input), 'rollback-window');
    input.now += 1000; assert.equal((await planExperientialRetention(input)).ok, true);
    for (const id of [f.experience.id, f.experience.sourceRefs[0].sourceId])
      refusal(await planExperientialRetention(await f.snapshot(await f.policy({ holds: [id] }))), 'hold:');
    const sole = await f.snapshot();
    sole.lineage.assessments.push(await addressedFixture('assessment', { ...f.assessment, supportingIds: [f.assessment.supportingIds[0]] }));
    refusal(await planExperientialRetention(sole), 'sole-provenance');
  } finally { await f.store.close(); }
});

it('refuses missing ancestry, an incomplete persisted census, future time and generic archive writes', async () => {
  const f = await fixture();
  try {
    const input = await f.snapshot(); input.lineage.trainingRuns = [];
    refusal(await planExperientialRetention(input), 'could not be verified');
    const incomplete = await f.snapshot(); incomplete.artifacts = [f.base]; incomplete.lineage.trainingRuns = [];
    const plan = accepted(await planExperientialRetention(incomplete)), before = await f.state();
    const refused = await f.store.retain(plan); assert.equal(refused.ok, false); if (!refused.ok) assert.equal(refused.issues[0].code, 'TEXP1012');
    assert.deepEqual(await f.state(), before);
    const complete = await f.snapshot(), full = accepted(await planExperientialRetention(complete));
    assert.equal((await f.store.put('retention_decisions', full.decisions[0])).ok, false);
    assert.equal((await f.store.transition({ kind: 'experience', before: f.experience, after: { ...f.experience, state: 'archived' } })).ok, false);
    complete.now++; assert.equal((await f.store.retain(accepted(await planExperientialRetention(complete)))).ok, false);
    assert.deepEqual(await f.state(), before);
  } finally { await f.store.close(); }
});

it('applies a source hold through every alias of the same retained experience', async () => {
  const f = await fixture();
  try {
    const input = await f.snapshot(await f.policy({ holds: [f.experience.sourceRefs[0].sourceId] }));
    input.episodeIds = [f.experience.id];
    refusal(await planExperientialRetention(input), 'hold:');
  } finally { await f.store.close(); }
});

for (const step of ['put:experiential_retention_decisions', 'put:experiential_experiences', 'put:experiential_events', 'commit'])
  it('rolls back archival state and audit at ' + step, async () => {
    let fault = false;
    const f = await fixture(actual => { if (fault && actual === step) throw Error('Injected retention fault.'); });
    try {
      const plan = accepted(await planExperientialRetention(await f.snapshot())), before = await f.state();
      fault = true; assert.equal((await f.store.retain(plan)).ok, false); fault = false;
      assert.deepEqual(await f.state(), before); accepted(await f.store.retain(plan));
    } finally { await f.store.close(); }
  });
