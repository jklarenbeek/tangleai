import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryResearchPersistence, createResearchStoreAdapter, planProjectCreate, planContractFreeze, planStateTransition,
  planStageCommit, planAmendment, type ArtifactAdmission, type ResearchState, type ResearchStore,
  type ResearchStoreOutcome, type ResearchProjection, type StageCommitPlan, type StageAttempt, type ExperimentRun,
  type MetricObservation } from '@tangleai/research';
import { attempt, checked, frozen, hash, manifest, project } from './fixtures.ts';

export interface ResearchHarness {
  store: ResearchStore;
  close(): Promise<void>;
  capture(): Promise<unknown>;
  projection(projectId: string): Promise<{ frames: ResearchProjection[]; terminal: { status: string; state: string } | null } | null>;
  arm(boundary: number | null): void;
  steps(): string[];
}
export function faultProbe() {
  let failAt: number | null = null, steps: string[] = [];
  return { arm(at: number | null) { failAt = at; steps = []; }, steps: () => [...steps],
    applyProbe(step: string) {
      steps.push(step);
      if (steps.length === failAt) throw Object.assign(new Error('injected ' + step), { code: 'FIXTURE_FAILURE', path: '/transaction/' + step });
    } };
}
export async function memoryHarness(): Promise<ResearchHarness> {
  const probe = faultProbe(), persistence = createMemoryResearchPersistence({ applyProbe: probe.applyProbe });
  return { store: createResearchStoreAdapter(persistence), close: () => persistence.close(), capture: async () => persistence.exportState(),
    ...probe, async projection(projectId) {
      const row = persistence.exportState().projections.find(item => item.projectId === projectId);
      return row ? { frames: row.frames, terminal: row.terminal ? { status: row.terminal.status, state: row.terminal.state.status } : null } : null;
    } };
}
export function stored<T>(outcome: ResearchStoreOutcome<T>): T {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  if (!outcome.ok) throw new Error('Refused fixture');
  return outcome.value;
}
function refused(outcome: ResearchStoreOutcome<unknown>, code: string, path?: string) {
  assert.equal(outcome.ok, false, JSON.stringify(outcome));
  if (!outcome.ok) { assert.equal(outcome.issue.code, code); if (path !== undefined) assert.equal(outcome.issue.path, path); }
}
export async function start(store: ResearchStore, id = 'fixture-project') {
  return stored(await store.createProject(checked(planProjectCreate(project(id)))));
}
export async function discovery(store: ResearchStore, id = 'fixture-project') {
  const state = await start(store, id);
  return stored(await store.transition(checked(planStateTransition(state, 'DISCOVERY'))));
}
export async function output(store: ResearchStore, row: StageAttempt, text: string, parents?: ArtifactAdmission[], verification: ArtifactAdmission['artifact']['verification'] = 'verified') {
  return stored(await store.stageArtifact(new TextEncoder().encode(text), { projectId: row.projectId,
    attempt: { projectId: row.projectId, stage: row.stage, attemptOrdinal: row.attemptOrdinal, inputManifestHash: row.inputManifestHash },
    mediaType: 'text/plain', verification, parents: parents?.map(parent => ({ artifactId: parent.artifact.id, admissionId: parent.id }))
      ?? [{ artifactId: row.projectId, admissionId: null }] }));
}
export async function staged(store: ResearchStore, state: ResearchState, nextStatus: ResearchState['status'], parents: ArtifactAdmission[] = []) {
  const input = manifest(state.projectId, state.status, parents.map(row => row.artifact.id)), row = await attempt(input);
  const artifact = await output(store, row, 'output of ' + state.status, parents.length ? parents : undefined);
  row.outputArtifactIds = [artifact.artifact.id];
  return { artifact, plan: checked(await planStageCommit({ state, attempt: row, manifest: input, nextStatus, artifactAdmissionIds: [artifact.id] })) };
}
export async function addObservation(store: ResearchStore, id = 'fixture-project') {
  const run: ExperimentRun = { id: 'experiment-one', projectId: id, condition: 'control', programId: 'fixture', seed: 1,
    status: 'failed', inputHash: hash(), executionManifestHash: hash('b'), rawArtifactHash: null, output: null,
    trace: [{ event: 'failure', detail: 'fixture failure' }], spend: { calls: 0, tokens: 0, ms: 0, physical: 0 },
    error: { code: 'TRSH1008', path: '', detail: 'fixture failure' } };
  // This is a storage-contract fixture. Metric verification belongs to the evaluator registry.
  const observation: MetricObservation = { id: 'observation-one', projectId: id, experimentRunId: run.id,
    evaluatorId: 'fixture', evaluatorVersion: '1', runArtifactHash: hash('c'), condition: 'control', metric: 'inertia',
    value: 1, unit: 'squared-distance', seed: 1, registrySignature: hash('d') };
  stored(await store.putRecord(id, { kind: 'ExperimentRun', value: run }));
  stored(await store.putRecord(id, { kind: 'MetricObservation', value: observation }));
  return observation;
}
export async function lifecycle(store: ResearchStore) {
  let state = await start(store); const records = await frozen();
  state = stored(await store.freezeContract(checked(await planContractFreeze(state, records.contract, records.plan, []))));
  const outputs: ArtifactAdmission[] = [], plans: StageCommitPlan[] = [];
  const commits = new Map<ResearchState['status'], ResearchState['status']>([['DISCOVERY', 'LITERATURE_GATE'], ['EXECUTE', 'ANALYZE'], ['WRITE', 'VERIFY']]);
  for (const next of ['DISCOVERY', 'LITERATURE_GATE', 'SYNTHESIS', 'HYPOTHESIS_GATE', 'DESIGN', 'DESIGN_GATE', 'EXECUTE',
    'ANALYZE', 'DECIDE', 'WRITE', 'VERIFY', 'QUALITY_GATE', 'COMPLETE'] as const) {
    if (commits.get(state.status) === next) {
      const result = await staged(store, state, next, outputs.length ? [outputs.at(-1)!] : []);
      outputs.push(result.artifact); plans.push(result.plan); state = stored(await store.commitStage(result.plan)).nextState;
    } else state = stored(await store.transition(checked(planStateTransition(state, next))));
  }
  return { state, outputs, plans, snapshot: stored(await store.snapshot(state.projectId))! };
}

export function researchStoreSuite(name: string, open: () => Promise<ResearchHarness>) {
  describe(name, () => {
    it('one lifecycle fixture preserves three atomic stage commits and an unbroken project ancestry', async () => {
      const h = await open();
      try {
        const { state, outputs, plans, snapshot } = await lifecycle(h.store);
        assert.equal(state.status, 'COMPLETE'); assert.equal(snapshot.attempts.length, 3);
        assert.equal(snapshot.committedAdmissionIds.length, 3);
        assert.deepEqual(outputs[0].parents, [{ artifactId: state.projectId, admissionId: null }]);
        for (let i = 1; i < outputs.length; i++) assert.deepEqual(outputs[i].parents, [{ artifactId: outputs[i - 1].artifact.id, admissionId: outputs[i - 1].id }]);
        assert.deepEqual(await h.projection(state.projectId), { frames: plans.map(plan => plan.projection), terminal: { state: 'COMPLETE', status: 'ok' } });
        const before = await h.capture();
        for (const plan of plans) { const replay = await h.store.commitStage(plan); stored(replay); assert.equal(replay.ok && replay.replayed, true); }
        assert.deepEqual(await h.capture(), before, 'replay performs no write or spend');
        assert.deepEqual(await start(h.store), state, 'project creation replay never resets control');
        assert.deepEqual(stored(await h.store.collectUnreferenced(state.projectId, { stage: 'DISCOVERY', attemptOrdinal: 2 })), []);
      } finally { await h.close(); }
    });
    it('immutable record puts and readers isolate caller mutation and reject conflicting ids', async () => {
      const h = await open();
      try {
        await start(h.store);
        const value = { id: 'intervention-one', gate: 'literature' as const, actor: 'scripted' as const, action: 'approve' as const,
          reviewedManifestHash: hash(), approvedManifestHash: hash(), substantive: false };
        const pending = h.store.putRecord('fixture-project', { kind: 'Intervention', value }); value.actor = 'human' as never;
        const original = stored(await pending); assert.equal((original.value as typeof value).actor, 'scripted');
        const replay = await h.store.putRecord('fixture-project', { kind: 'Intervention', value: original.value as typeof value });
        assert.equal(replay.ok && replay.replayed, true);
        refused(await h.store.putRecord('fixture-project', { kind: 'Intervention', value }), 'TRSH1002');
        (original.value as typeof value).substantive = true;
        assert.equal(stored(await h.store.getRecord('fixture-project', 'Intervention', value.id))!.substantive, false);
        refused(await h.store.putRecord('fixture-project', { kind: 'Intervention', value: { ...value, unexpected: true } } as never), 'TRSH1001', '/unexpected');
        refused(await h.store.putRecord('fixture-project', { kind: 'constructor', value } as never), 'TRSH1001');
        const other = await frozen('other-project');
        refused(await h.store.putRecord('fixture-project', { kind: 'ResearchContract', value: other.contract }), 'TRSH1005');
        refused(await h.store.putRecord('unknown-project', { kind: 'Intervention', value }), 'TRSH1003');
      } finally { await h.close(); }
    });
    it('same byte content preserves each project, producer, parent chain and verification admission', async () => {
      const h = await open();
      try {
        const state = await discovery(h.store), other = await discovery(h.store, 'other-project');
        const first = await attempt(manifest()), second = await attempt(manifest(other.projectId));
        const pending = await output(h.store, first, 'same bytes', undefined, 'pending');
        const verified = await output(h.store, first, 'same bytes'), foreign = await output(h.store, second, 'same bytes');
        assert.equal(pending.artifact.id, verified.artifact.id); assert.equal(foreign.artifact.id, verified.artifact.id);
        assert.equal(new Set([pending.id, verified.id, foreign.id]).size, 3);
        first.outputArtifactIds = [verified.artifact.id];
        const request = { state, attempt: first, manifest: manifest(), nextStatus: 'LITERATURE_GATE' as const, artifactAdmissionIds: [pending.id] };
        refused(await h.store.commitStage(checked(await planStageCommit(request))), 'TRSH1005', '/artifact/verification');
        refused(await h.store.commitStage(checked(await planStageCommit({ ...request, artifactAdmissionIds: [foreign.id] }))), 'TRSH1003');
        const committed = stored(await h.store.commitStage(checked(await planStageCommit({ ...request, artifactAdmissionIds: [verified.id] }))));
        const nextInput = manifest(state.projectId, 'LITERATURE_GATE', [verified.artifact.id]), nextAttempt = await attempt(nextInput);
        const next = await output(h.store, nextAttempt, 'same bytes', [verified]); nextAttempt.outputArtifactIds = [next.artifact.id];
        stored(await h.store.commitStage(checked(await planStageCommit({ state: committed.nextState, attempt: nextAttempt, manifest: nextInput,
          nextStatus: 'SYNTHESIS', artifactAdmissionIds: [next.id] }))));
        assert.notEqual(next.id, verified.id); assert.equal(next.artifact.id, verified.artifact.id);
        assert.deepEqual(stored(await h.store.collectUnreferenced(state.projectId, { stage: 'DISCOVERY', attemptOrdinal: 2 })).map(row => row.id), [pending.id]);
        assert.equal(stored(await h.store.readArtifact(state.projectId, pending.id)).admission.artifact.verification, 'pending');
      } finally { await h.close(); }
    });
    it('artifact staging snapshots the exact byte view and readers never expose stored byte buffers', async () => {
      const h = await open();
      try {
        await discovery(h.store); const row = await attempt(manifest());
        const backing = new Uint8Array([9, 97, 98, 99, 8]);
        const promise = h.store.stageArtifact(backing.subarray(1, 4), { projectId: row.projectId,
          attempt: { projectId: row.projectId, stage: row.stage, attemptOrdinal: row.attemptOrdinal, inputManifestHash: row.inputManifestHash },
          mediaType: 'text/plain', verification: 'verified', parents: [{ artifactId: row.projectId, admissionId: null }] });
        backing.fill(0); const admission = stored(await promise);
        assert.equal(admission.artifact.id, 'art-ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
        const first = stored(await h.store.readArtifact(row.projectId, admission.id)); first.bytes.fill(7); first.admission.parents.length = 0;
        const second = stored(await h.store.readArtifact(row.projectId, admission.id));
        assert.deepEqual([...second.bytes], [97, 98, 99]); assert.equal(second.admission.parents.length, 1);
      } finally { await h.close(); }
    });
    it('state CAS rejects concurrent and forged plans, including stale revisions', async () => {
      const h = await open();
      try {
        const state = await start(h.store), plan = checked(planStateTransition(state, 'DISCOVERY'));
        const outcomes = await Promise.all([h.store.transition(plan), h.store.transition(plan)]);
        assert.equal(outcomes.filter(row => row.ok).length, 1); refused(outcomes.find(row => !row.ok)!, 'TRSH1004');
        const current = stored(await h.store.getState(state.projectId))!;
        const forged = { ...checked(planStateTransition(current, 'LITERATURE_GATE')), nextState: { ...current, status: 'COMPLETE' as const } };
        refused(await h.store.transition(forged), 'TRSH1004');
        const advanced = checked(planStateTransition(current, 'LITERATURE_GATE'));
        refused(await h.store.transition({ ...advanced, expectedState: { ...current, revision: 0 } }), 'TRSH1004');
        assert.deepEqual(stored(await h.store.getState(state.projectId)), current);
      } finally { await h.close(); }
    });
    it('freeze checks the persisted observation census and amendments retain both lineages', async () => {
      const h = await open();
      try {
        let state = await start(h.store); const first = await frozen(), second = await frozen('fixture-project', '-two', 0.1);
        state = stored(await h.store.freezeContract(checked(await planContractFreeze(state, first.contract, first.plan, []))));
        const replay = await h.store.freezeContract(checked(await planContractFreeze(state, first.contract, first.plan, [])));
        assert.equal(replay.ok && replay.replayed, true);
        const observation = await addObservation(h.store);
        refused(await h.store.freezeContract(checked(await planContractFreeze(state, first.contract, first.plan, []))), 'TRSH1009', '/observations');
        const amendment = { id: 'amendment-one', before: first.contract.contractHash, after: second.contract.contractHash,
          reason: 'Retain the old observations as exploratory.', marksExploratory: [observation.id] };
        const dishonest = checked(await planAmendment(state, amendment, second.contract, second.plan, []));
        refused(await h.store.amendContract(dishonest), 'TRSH1004', '/plan');
        const valid = checked(await planAmendment(state, amendment, second.contract, second.plan, [observation.id]));
        state = stored(await h.store.amendContract(valid));
        assert.deepEqual(state.exploratoryObservationIds, [observation.id]); assert.equal(state.contractHash, second.contract.contractHash);
        assert.deepEqual(stored(await h.store.getRecord(state.projectId, 'ResearchContract', first.contract.id)), first.contract);
        assert.deepEqual(stored(await h.store.getRecord(state.projectId, 'MetricObservation', observation.id)), observation);
      } finally { await h.close(); }
    });
    it('missing parents, input scope and uncommitted producer chains cannot become reachable', async () => {
      const h = await open();
      try {
        const state = await discovery(h.store), input = manifest(), first = await attempt(input), foreignAttempt = await attempt(input, [], 2);
        const parent = await output(h.store, foreignAttempt, 'uncommitted parent'), child = await output(h.store, first, 'child', [parent]);
        first.outputArtifactIds = [child.artifact.id];
        const plan = checked(await planStageCommit({ state, attempt: first, manifest: input, nextStatus: 'LITERATURE_GATE', artifactAdmissionIds: [child.id] }));
        refused(await h.store.commitStage(plan), 'TRSH1003', '/artifact/parents');
        refused(await h.store.commitStage({ ...plan, artifactAdmissionIds: [parent.id, child.id], attempt: { ...first, outputArtifactIds: [parent.artifact.id, child.artifact.id] } }), 'TRSH1005');
        const missingInput = manifest(state.projectId, state.status, ['art-' + hash()]), missingRow = await attempt(missingInput);
        const request = checked(await planStageCommit({ state, attempt: missingRow, manifest: missingInput, nextStatus: 'LITERATURE_GATE', artifactAdmissionIds: [] }));
        refused(await h.store.commitStage(request), 'TRSH1003', '/manifest/inputs');
        assert.equal(stored(await h.store.snapshot(state.projectId))!.attempts.length, 0);
        const root = await staged(h.store, state, 'LITERATURE_GATE');
        const next = stored(await h.store.commitStage(root.plan)).nextState;
        const undeclaredInput = manifest(next.projectId, next.status), undeclaredAttempt = await attempt(undeclaredInput);
        const undeclared = await output(h.store, undeclaredAttempt, 'derived from an undeclared input', [root.artifact]);
        undeclaredAttempt.outputArtifactIds = [undeclared.artifact.id];
        const undeclaredPlan = checked(await planStageCommit({ state: next, attempt: undeclaredAttempt, manifest: undeclaredInput,
          nextStatus: 'SYNTHESIS', artifactAdmissionIds: [undeclared.id] }));
        refused(await h.store.commitStage(undeclaredPlan), 'TRSH1005', '/artifact/parents');
      } finally { await h.close(); }
    });
    it('project budget and immutable attempt identity prevent duplicate spend and changed results', async () => {
      const h = await open();
      try {
        const p = project(); p.budget.calls = 1;
        let state = stored(await h.store.createProject(checked(planProjectCreate(p))));
        state = stored(await h.store.transition(checked(planStateTransition(state, 'DISCOVERY'))));
        const first = await staged(h.store, state, 'LITERATURE_GATE');
        const plan = checked(await planStageCommit({ state, attempt: { ...first.plan.attempt, spend: { ...first.plan.attempt.spend, calls: 1 } },
          manifest: first.plan.manifest, nextStatus: 'LITERATURE_GATE', artifactAdmissionIds: [first.artifact.id] }));
        state = stored(await h.store.commitStage(plan)).nextState;
        const second = await staged(h.store, state, 'SYNTHESIS'), changedAttempt = { ...second.plan.attempt, spend: { ...second.plan.attempt.spend, calls: 1 } };
        const excess = checked(await planStageCommit({ state, attempt: changedAttempt, manifest: second.plan.manifest, nextStatus: 'SYNTHESIS', artifactAdmissionIds: [second.artifact.id] }));
        refused(await h.store.commitStage(excess), 'TRSH1006', '/attempt/spend/calls');
        const before = await h.capture();
        const replay = await h.store.commitStage(plan); assert.equal(replay.ok && replay.replayed, true); assert.deepEqual(await h.capture(), before);
        const changed = checked(await planStageCommit({ state: plan.expectedState, attempt: { ...plan.attempt, mode: 'single-agent' }, manifest: plan.manifest,
          nextStatus: 'LITERATURE_GATE', artifactAdmissionIds: plan.artifactAdmissionIds }));
        refused(await h.store.commitStage(changed), 'TRSH1002', '/attempt/id');
      } finally { await h.close(); }
    });
    it('a failure before every transaction boundary leaves no reachable partial state', async () => {
      type Operation = () => Promise<ResearchStoreOutcome<unknown>>;
      const setups: Array<(store: ResearchStore) => Promise<Operation>> = [
        async store => () => store.createProject(checked(planProjectCreate(project()))),
        async store => { await discovery(store); const row = await attempt(manifest()); return async () => store.stageArtifact(new Uint8Array([1, 2, 3]), {
          projectId: row.projectId, attempt: { projectId: row.projectId, stage: row.stage, attemptOrdinal: 1, inputManifestHash: row.inputManifestHash },
          mediaType: 'application/octet-stream', verification: 'verified', parents: [{ artifactId: row.projectId, admissionId: null }] }); },
        async store => { const state = await start(store), records = await frozen(); const plan = checked(await planContractFreeze(state, records.contract, records.plan, [])); return () => store.freezeContract(plan); },
        async store => { const state = await discovery(store), { plan } = await staged(store, state, 'LITERATURE_GATE'); return () => store.commitStage(plan); },
        async store => { const state = await discovery(store), input = manifest(), row = await attempt(input); row.stopReason = 'failed'; row.error = { code: 'TRSH1008', path: '/provider', detail: 'fixture failure' };
          const plan = checked(await planStageCommit({ state, attempt: row, manifest: input, nextStatus: 'STOPPED', artifactAdmissionIds: [] })); return () => store.commitStage(plan); },
        async store => { const state = await start(store), plan = checked(planStateTransition(state, 'STOPPED')); return () => store.transition(plan); },
        async store => { let state = await start(store); const one = await frozen(), two = await frozen('fixture-project', '-two', 0.1);
          state = stored(await store.freezeContract(checked(await planContractFreeze(state, one.contract, one.plan, [])))); const obs = await addObservation(store);
          const plan = checked(await planAmendment(state, { id: 'amendment-one', before: one.contract.contractHash, after: two.contract.contractHash,
            reason: 'fixture amendment', marksExploratory: [obs.id] }, two.contract, two.plan, [obs.id])); return () => store.amendContract(plan); },
      ];
      let boundaries = 0;
      for (const setup of setups) {
        const sample = await open(); let trace: string[];
        try { const run = await setup(sample.store); sample.arm(null); stored(await run()); trace = sample.steps(); }
        finally { await sample.close(); }
        assert.ok(trace!.length >= 3);
        for (let index = 1; index <= trace!.length; index++) {
          const h = await open();
          try {
            const run = await setup(h.store), before = await h.capture(); h.arm(index);
            const failure = await run(); refused(failure, 'TRSH1008');
            if (!failure.ok) { assert.equal(failure.issue.cause?.code, 'FIXTURE_FAILURE'); assert.match(failure.issue.cause!.path, /^\/transaction\//); }
            assert.equal(h.steps().at(-1), trace![index - 1]); h.arm(null);
            assert.deepEqual(await h.capture(), before, `boundary ${index}: ${trace![index - 1]}`);
            stored(await run()); boundaries++;
          } finally { await h.close(); }
        }
      }
      assert.ok(boundaries >= 30, 'every write, frame, association and commit boundary was exercised');
    });
  });
}
