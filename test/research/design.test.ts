import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createResearchDesign, planProjectCreate, planContractFreeze, planAmendment, researchRevisionOf,
  type ResearchDesignProposal } from '@tangleai/research';
import { checked, project } from './fixtures.ts';
import { reasoningFixture } from './reasoning-fixtures.ts';

it('the design owner derives both hashes and freezes metadata before any observations', async () => {
  const f = await reasoningFixture(), state = checked(planProjectCreate(project())).state;
  const frozen = checked(await planContractFreeze(state, f.design.contract, f.design.plan, []));
  const { contractHash, ...contract } = f.design.contract, { planHash, ...plan } = f.design.plan;
  assert.equal(contractHash, await researchRevisionOf(contract)); assert.equal(planHash, await researchRevisionOf(plan));
  assert.equal(frozen.nextState.contractHash, contractHash); assert.equal(frozen.nextState.planHash, planHash);
  assert.deepEqual(f.design, checked(await createResearchDesign(project().id, f.designProposal, f.hypotheses, f.bounds)));
});
it('missing, infeasible and confounded designs retain the exact offending field pointer', async () => {
  const f = await reasoningFixture();
  const cases: Array<[string, (proposal: ResearchDesignProposal) => void]> = [
    ['/contract/replicatePolicy', p => { delete (p.contract as Partial<typeof p.contract>).replicatePolicy; }],
    ['/contract/requiredBaselines/0/source', p => { delete (p.contract.requiredBaselines[0] as Partial<typeof p.contract.requiredBaselines[0]>).source; }],
    ['/plan/design/resources/ms', p => { p.plan.design.resources.ms = f.bounds.budget.ms + 1; }],
    ['/plan/design/controls', p => { p.plan.design.controls[0].confound = 'another confound'; }],
    ['/contract/metrics', p => { p.contract.metrics[0].direction = 'maximize'; }],
  ];
  for (const [path, mutate] of cases) {
    const proposal = structuredClone(f.designProposal); mutate(proposal);
    const result = await createResearchDesign(project().id, proposal, f.hypotheses, f.bounds);
    assert.ok(!result.valid, path); assert.equal(result.issues[0].code, 'TRSH1009', path); assert.equal(result.issues[0].path, path);
  }
});
it('hidden and substituted paths are refused before any experiment can execute', async () => {
  const f = await reasoningFixture();
  for (const path of ['hidden/results.json', '../hidden/results.json', 'datasets/../hidden/results.json', 'unknown.json']) {
    const result = await createResearchDesign(project().id, { ...f.designProposal, plan: { ...f.designProposal.plan, inputPaths: [path] } }, f.hypotheses, f.bounds);
    assert.ok(!result.valid); assert.equal(result.issues[0].code, 'TRSH1005'); assert.equal(result.issues[0].path, '/plan/inputPaths/0');
  }
});
it('changing a generated threshold requires an amendment and retains exploratory observation ids', async () => {
  const f = await reasoningFixture(), state = checked(await planContractFreeze(checked(planProjectCreate(project())).state, f.design.contract, f.design.plan, [])).nextState;
  const proposal = structuredClone(f.designProposal); proposal.contract.successRule.minImprovement = 0.2;
  const changed = checked(await createResearchDesign(project().id, proposal, f.hypotheses, f.bounds));
  const refusal = await planContractFreeze(state, changed.contract, changed.plan, []);
  assert.ok(!refusal.valid); assert.equal(refusal.issues[0].code, 'TRSH1009');
  const amendment = checked(await planAmendment(state, { id: 'threshold-amendment', before: state.contractHash!, after: changed.contract.contractHash,
    reason: 'Explicitly revise the threshold after an observation.', marksExploratory: ['observation-one'] }, changed.contract, changed.plan, ['observation-one']));
  assert.deepEqual(amendment.nextState.exploratoryObservationIds, ['observation-one']);
});
it('a host allowlist cannot authorize reserved hidden inputs', async () => {
  const f = await reasoningFixture();
  for (const path of ['hidden/results.json', 'datasets/../hidden/results.json', 'hidden\\results.json']) {
    const proposal = structuredClone(f.designProposal), bounds = structuredClone(f.bounds);
    proposal.plan.inputPaths = [path]; bounds.plan.inputPaths = [path];
    const result = await createResearchDesign(project().id, proposal, f.hypotheses, bounds);
    assert.ok(!result.valid, path); assert.equal(result.issues[0].code, 'TRSH1005'); assert.equal(result.issues[0].path, '/plan/inputPaths/0');
  }
});
it('one experiment attempt can retain all five registered seed replicates without admitting a sixth selection', async () => {
  const f = await reasoningFixture(), proposal = structuredClone(f.designProposal);
  proposal.contract.attemptCap = 1; proposal.contract.replicatePolicy.seeds = [1, 2, 3, 4, 5]; proposal.contract.selectionRule.n = 5;
  assert.ok((await createResearchDesign(project().id, proposal, f.hypotheses, f.bounds)).valid);
  proposal.contract.selectionRule.n = 6;
  const refused = await createResearchDesign(project().id, proposal, f.hypotheses, f.bounds);
  assert.ok(!refused.valid); assert.equal(refused.issues[0].path, '/contract/selectionRule/n');
});
