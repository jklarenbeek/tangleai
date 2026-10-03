import assert from 'node:assert/strict';
import { it } from 'node:test';
import { planProjectCreate, planStateTransition, planContractFreeze, planAmendment, planStageCommit,
  type ResearchLifecycle, type ResearchOutcome, type ResearchState } from '@tangleai/research';
import { checked, project, frozen, hash, manifest, attempt } from './fixtures.ts';

function refused(result: ResearchOutcome<unknown>, code: string, path?: string) {
  assert.equal(result.valid, false);
  if (!result.valid) { assert.equal(result.issues[0].code, code); if (path !== undefined) assert.equal(result.issues[0].path, path); }
}
it('project creation snapshots immutable metadata and refuses a pre-completed project', () => {
  const input = project(), plan = checked(planProjectCreate(input));
  input.question = 'changed after planning';
  assert.notEqual(plan.project.question, input.question);
  assert.deepEqual(plan.state, { projectId: input.id, status: 'CREATED', revision: 0, contractHash: null, planHash: null, exploratoryObservationIds: [] });
  refused(planProjectCreate({ ...input, status: 'COMPLETE' }), 'TRSH1004', '/status');
});
it('the lifecycle projection follows every forward edge and fences bounded-loop return edges', () => {
  let state: ResearchState = { ...checked(planProjectCreate(project())).state, contractHash: hash(), planHash: hash('b') };
  const path: ResearchLifecycle[] = ['DISCOVERY', 'LITERATURE_GATE', 'SYNTHESIS', 'HYPOTHESIS_GATE', 'DESIGN',
    'DESIGN_GATE', 'EXECUTE', 'ANALYZE', 'DECIDE', 'WRITE', 'VERIFY', 'QUALITY_GATE', 'COMPLETE'];
  for (const status of path) {
    const plan = checked(planStateTransition(state, status));
    assert.deepEqual(plan.expectedState, state);
    assert.equal(plan.nextState.revision, state.revision + 1);
    state = plan.nextState;
    refused(planStateTransition(state, 'CREATED'), 'TRSH1004');
  }
  refused(planStateTransition(state, 'STOPPED'), 'TRSH1004');
  for (const [from, to] of [['DECIDE', 'EXECUTE'], ['DECIDE', 'SYNTHESIS'], ['QUALITY_GATE', 'WRITE']] as const) {
    assert.equal(checked(planStateTransition({ ...state, status: from }, to)).nextState.status, to);
  }
  refused(planStateTransition({ ...state, status: 'DISCOVERY' }, 'COMPLETE'), 'TRSH1004');
  refused(planStateTransition({ ...state, status: 'STOPPED' }, 'DISCOVERY'), 'TRSH1004');
  refused(planStateTransition({ ...state, status: 'CREATED', revision: Number.MAX_SAFE_INTEGER }, 'DISCOVERY'), 'TRSH1004', '/revision');
  refused(planStateTransition({ ...state, status: 'DESIGN_GATE', contractHash: null }, 'EXECUTE'), 'TRSH1009');
});
it('initial freeze verifies both hashes, is idempotent before results, and refuses every observation', async () => {
  const state = checked(planProjectCreate(project())).state;
  const records = await frozen();
  const plan = checked(await planContractFreeze(state, records.contract, records.plan, []));
  assert.equal(plan.nextState.contractHash, records.contract.contractHash);
  assert.equal(plan.nextState.planHash, records.plan.planHash);
  assert.equal(plan.nextState.revision, 1);
  assert.deepEqual(checked(await planContractFreeze(plan.nextState, records.contract, records.plan, [])).nextState, plan.nextState);
  refused(await planContractFreeze(state, records.contract, records.plan, ['old-observation']), 'TRSH1009', '/observations');
  refused(await planContractFreeze(plan.nextState, records.contract, records.plan, ['old-observation']), 'TRSH1009');
  refused(await planContractFreeze(state, { ...records.contract, contractHash: hash() }, records.plan, []), 'TRSH1002', '/contractHash');
  refused(await planContractFreeze(state, records.contract, { ...records.plan, planHash: hash() }, []), 'TRSH1002', '/planHash');
  const replacement = await frozen('fixture-project', '-changed', 0.1);
  refused(await planContractFreeze(plan.nextState, replacement.contract, replacement.plan, []), 'TRSH1009');
});
it('amendments retain affected results as exploratory under a new frozen lineage', async () => {
  const first = await frozen(), second = await frozen('fixture-project', '-changed', 0.1);
  const state = checked(await planContractFreeze(checked(planProjectCreate(project())).state, first.contract, first.plan, [])).nextState;
  const amendment = { id: 'amendment-one', before: first.contract.contractHash, after: second.contract.contractHash,
    reason: 'Change after observation; retain the original exploratory result.', marksExploratory: ['observation-one'] };
  const plan = checked(await planAmendment(state, amendment, second.contract, second.plan, ['observation-one']));
  assert.deepEqual(plan.nextState.exploratoryObservationIds, ['observation-one']);
  assert.equal(plan.nextState.contractHash, second.contract.contractHash);
  assert.equal(plan.expectedState.contractHash, first.contract.contractHash);
  refused(await planAmendment(state, amendment, second.contract, second.plan, ['observation-two']), 'TRSH1009');
  refused(await planAmendment(state, { ...amendment, before: hash() }, second.contract, second.plan, ['observation-one']), 'TRSH1009');
});
it('stage plans bind stack, scope, input hashes, spend and the next legal state', async () => {
  const state = checked(planStateTransition(checked(planProjectCreate(project())).state, 'DISCOVERY')).nextState;
  const input = manifest(), row = await attempt(input, ['art-' + hash()]);
  const request = { state, attempt: row, manifest: input, nextStatus: 'LITERATURE_GATE' as const, artifactAdmissionIds: ['admission-' + hash()] };
  const plan = checked(await planStageCommit(request));
  assert.deepEqual(plan.projection, { stage: 'DISCOVERY', status: 'ok', ms: 0 });
  refused(await planStageCommit({ ...request, attempt: { ...row, inputManifestHash: hash('c') } }), 'TRSH1002');
  refused(await planStageCommit({ ...request, attempt: { ...row, runIdentityId: hash('c') } }), 'TRSH1002');
  refused(await planStageCommit({ ...request, attempt: { ...row, spend: { ...row.spend, calls: 2 } } }), 'TRSH1006', '/attempt/spend/calls');
  refused(await planStageCommit({ ...request, nextStatus: 'COMPLETE' }), 'TRSH1004');
  refused(await planStageCommit({ ...request, artifactAdmissionIds: ['admission-wrong'] }), 'TRSH1001');
});
