import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { planStateTransition, planStageCommit, type ResearchStore, type LiteratureRecord } from '@tangleai/research';
import { attempt, checked, manifest } from './fixtures.ts';
import { start, stored, output, addObservation, type ResearchHarness } from './store-harness.ts';
import { reasoningFixture } from './reasoning-fixtures.ts';

async function admission(store: ResearchStore) {
  const f = await reasoningFixture();
  let state = stored(await store.transition(checked(planStateTransition(await start(store), 'DISCOVERY'))));
  const input = manifest(state.projectId), row = await attempt(input);
  const source = await output(store, row, new TextDecoder().decode(f.source)); row.outputArtifactIds = [source.artifact.id];
  state = stored(await store.commitStage(checked(await planStageCommit({ state, attempt: row, manifest: input,
    artifactAdmissionIds: [source.id], nextStatus: 'LITERATURE_GATE', records: [
      { kind: 'LiteratureRecord', value: f.literature as LiteratureRecord }, { kind: 'EvidenceCard', value: f.cards[0] },
    ] })))).nextState;
  state = stored(await store.transition(checked(planStateTransition(state, 'SYNTHESIS'))));
  stored(await store.putRecord(state.projectId, { kind: 'Synthesis', value: f.synthesis }));
  state = stored(await store.transition(checked(planStateTransition(state, 'HYPOTHESIS_GATE'))));
  for (const value of f.hypotheses) stored(await store.putRecord(state.projectId, { kind: 'ResearchHypothesis', value }));
  stored(await store.putRecord(state.projectId, { kind: 'HypothesisSet', value: f.set }));
  state = stored(await store.transition(checked(planStateTransition(state, 'DESIGN'))));
  const designInput = manifest(state.projectId, 'DESIGN', [source.artifact.id]);
  const plan = checked(await planStageCommit({ state, attempt: await attempt(designInput), manifest: designInput,
    artifactAdmissionIds: [], nextStatus: 'DESIGN_GATE', preregistration: f.design }));
  return { f, state, plan };
}
export function researchDesignStoreSuite(name: string, open: () => Promise<ResearchHarness>) {
  describe(name, () => {
    it('design freeze, attempt and projection commit together and replay after later observations without writes', async () => {
      const h = await open();
      let boundaries: string[] = [];
      try {
        const { f, state, plan } = await admission(h.store); h.arm(null);
        const receipt = stored(await h.store.commitStage(plan)); boundaries = h.steps();
        assert.equal(receipt.nextState.status, 'DESIGN_GATE'); assert.equal(receipt.nextState.revision, state.revision + 1);
        assert.equal(receipt.nextState.contractHash, f.design.contract.contractHash);
        assert.deepEqual(stored(await h.store.getRecord(state.projectId, 'ExperimentPlan', f.design.plan.id)), f.design.plan);
        assert.ok(receipt.recordIds.includes(f.design.contract.id) && receipt.recordIds.includes(f.design.plan.id));
        await addObservation(h.store); const before = await h.capture();
        const replay = await h.store.commitStage(plan); assert.ok(replay.ok && replay.replayed);
        assert.deepEqual(await h.capture(), before);
        const other = structuredClone(plan); other.preregistration!.plan.design!.replicateRationale = 'changed after acceptance';
        const refused = await h.store.commitStage(other); assert.ok(!refused.ok); assert.equal(refused.issue.code, 'TRSH1002');
      } finally { await h.close(); }
      assert.ok(boundaries.length > 0);
      for (let boundary = 1; boundary <= boundaries.length; boundary++) {
        const next = await open();
        try {
          const { state, plan } = await admission(next.store), before = await next.capture(); next.arm(boundary);
          const refused = await next.store.commitStage(plan); assert.ok(!refused.ok, boundaries[boundary - 1]);
          next.arm(null); assert.deepEqual(await next.capture(), before, boundaries[boundary - 1]);
          assert.equal(stored(await next.store.getState(state.projectId))!.contractHash, null);
          assert.equal(stored(await next.store.commitStage(plan)).nextState.contractHash, plan.preregistration!.contract.contractHash);
        } finally { await next.close(); }
      }
    });
    it('an observation inserted after planning prevents initial preregistration without partial state', async () => {
      const h = await open();
      try {
        const { plan } = await admission(h.store); await addObservation(h.store);
        const before = await h.capture(), result = await h.store.commitStage(plan);
        assert.ok(!result.ok); assert.equal(result.issue.code, 'TRSH1009'); assert.equal(result.issue.path, '/observations');
        assert.deepEqual(await h.capture(), before);
      } finally { await h.close(); }
    });
  });
}
