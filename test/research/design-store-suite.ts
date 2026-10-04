import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { planStateTransition, planStageCommit, researchRevisionOf, type ResearchStore, type LiteratureRecord } from '@tangleai/research';
import { attempt, checked, frozen, manifest } from './fixtures.ts';
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
    it('pivot preregistration, exploratory marks and the design receipt commit atomically with no partial lineage', async () => {
      async function pivot(store: ResearchStore) {
        const initial = await admission(store);
        let state = stored(await store.commitStage(initial.plan)).nextState;
        const observation = await addObservation(store);
        for (const edge of ['EXECUTE', 'ANALYZE', 'DECIDE', 'SYNTHESIS', 'HYPOTHESIS_GATE', 'DESIGN'] as const)
          state = stored(await store.transition(checked(planStateTransition(state, edge))));
        const next = await frozen(state.projectId, '-pivot', 0.1), input = manifest(state.projectId, 'DESIGN');
        const hypothesis = initial.f.hypotheses[1];
        next.contract.hypothesisSpace = [hypothesis.statement];
        const { contractHash: _contractHash, ...contractBody } = next.contract;
        next.contract.contractHash = await researchRevisionOf(contractBody);
        next.plan.contractHash = next.contract.contractHash; next.plan.hypothesisHash = hypothesis.hypothesisHash;
        const { planHash: _planHash, ...planBody } = next.plan; next.plan.planHash = await researchRevisionOf(planBody);
        const amendment = { id: 'pivot-amendment', before: initial.f.design.contract.contractHash, after: next.contract.contractHash,
          reason: 'The admitted confound requires a new preregistration lineage.', marksExploratory: [observation.id] };
        const plan = checked(await planStageCommit({ state, attempt: await attempt(input, [], 2), manifest: input,
          artifactAdmissionIds: [], nextStatus: 'DESIGN_GATE', preregistration: { ...next, amendment } }));
        return { initial, state, observation, next, amendment, plan };
      }
      const sample = await open(); let boundaries: string[];
      try {
        const f = await pivot(sample.store); sample.arm(null);
        const receipt = stored(await sample.store.commitStage(f.plan)); boundaries = sample.steps();
        assert.equal(receipt.nextState.revision, f.state.revision + 1);
        assert.equal(receipt.nextState.contractHash, f.next.contract.contractHash);
        assert.deepEqual(receipt.nextState.exploratoryObservationIds, [f.observation.id]);
        assert.deepEqual(stored(await sample.store.getRecord(f.state.projectId, 'Amendment', f.amendment.id)), f.amendment);
        assert.deepEqual(stored(await sample.store.getRecord(f.state.projectId, 'ResearchContract', f.initial.f.design.contract.id)), f.initial.f.design.contract);
        assert.deepEqual(stored(await sample.store.getRecord(f.state.projectId, 'MetricObservation', f.observation.id)), f.observation);
        const before = await sample.capture(); assert.ok((await sample.store.commitStage(f.plan)).ok); assert.deepEqual(await sample.capture(), before);
      } finally { await sample.close(); }
      for (let boundary = 1; boundary <= boundaries!.length; boundary++) {
        const h = await open();
        try {
          const f = await pivot(h.store), before = await h.capture(); h.arm(boundary);
          const refused = await h.store.commitStage(f.plan); assert.equal(refused.ok, false, boundaries![boundary - 1]);
          h.arm(null); assert.deepEqual(await h.capture(), before);
          assert.equal(stored(await h.store.commitStage(f.plan)).nextState.contractHash, f.next.contract.contractHash);
        } finally { await h.close(); }
      }
      const raced = await open();
      try {
        const f = await pivot(raced.store), changed = structuredClone(f.plan);
        changed.preregistration!.amendment!.marksExploratory = [];
        const before = await raced.capture(), refused = await raced.store.commitStage(changed);
        assert.equal(refused.ok, false); assert.deepEqual(await raced.capture(), before);
      } finally { await raced.close(); }
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
