import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bindDomainProfile, domainExecutionPolicy, isBoundDomainProfile, researchExecutionRevisionOf,
  sealDomainProfile, type ResearchDomainBindings, type ResearchIssue, type ResearchContract, type ExperimentPlan } from '@tangleai/research';
import { domainFixture } from './domain-fixtures.ts';
import { checked, frozen, hash } from './fixtures.ts';

describe('research domain host bindings', () => {
  it('refuses every missing or mismatched capability before any model or runner call', async () => {
    for (const kind of ['prompts', 'planValidators', 'evaluators', 'rubrics', 'exporters'] as const) {
      for (const mode of ['missing', 'revision'] as const) {
        const f = await domainFixture();
        const entries = Object.entries(f.bindings[kind]);
        const broken = { ...f.bindings, [kind]: mode === 'missing' ? {} : Object.fromEntries(entries.map(([id, row]) => [id, { ...row, revision: hash('f') }])) };
        const result = await bindDomainProfile(f.profile, broken);
        assert.equal(result.valid, false, kind + '/' + mode);
        if (!result.valid) { assert.equal(result.issues[0].code, 'TRSH2008'); assert.match(result.issues[0].detail, /Model calls: 0; runner invocations: 0/); }
        assert.deepEqual(f.calls, { model: 0, runner: 0, validator: 0, evaluator: 0, exporter: 0 });
      }
    }
  });
  it('captures data and functions before yielding and refuses forged admitted objects', async () => {
    const f = await domainFixture(), pending = bindDomainProfile(f.profile, f.bindings);
    f.bindings.planValidators['fixture-plan'].validate = () => { throw Error('mutated callable'); };
    f.bindings.evaluators['fixture-evaluator'].evaluator.version = 'mutated';
    const bound = checked(await pending), plan = await frozen();
    assert.ok(isBoundDomainProfile(bound)); assert.equal(isBoundDomainProfile({ ...bound }), false);
    assert.equal(bound.evaluator.version, '1'); assert.ok(bound.validatePlan(plan.contract, plan.plan).valid);
    assert.equal(f.calls.validator, 1);
    assert.equal((await domainExecutionPolicy({ ...bound }, f.fields)).valid, false);
    assert.ok(Object.isFrozen(bound.manifest.bindings));
  });
  it('rejects wrong kinds, corrupted prompt/rubric bytes and executor contract identity', async () => {
    for (const target of ['evaluator', 'prompt', 'rubric', 'executor'] as const) {
      const f = await domainFixture();
      let profile = f.profile;
      if (target === 'evaluator') f.bindings.evaluators['fixture-evaluator'].evaluator.id = 'another';
      if (target === 'prompt') {
        const id = f.profile.promptPackIds[0];
        f.bindings.prompts = { [id]: { ...f.bindings.prompts[id], id: 'another' } };
      }
      if (target === 'rubric') f.bindings.rubrics['fixture-rubric'].document = { changed: true };
      if (target === 'executor') profile = checked(await sealDomainProfile({ ...f.body,
        runnerManifestTemplate: { ...f.body.runnerManifestTemplate, executorContractHash: hash() } }));
      const outcome = await bindDomainProfile(profile, f.bindings);
      assert.equal(outcome.valid, false, target);
      if (!outcome.valid) assert.equal(outcome.issues[0].code, 'TRSH2008');
      assert.deepEqual(f.calls, { model: 0, runner: 0, validator: 0, evaluator: 0, exporter: 0 });
    }
  });
  it('enforces evaluator, unit and direction before invoking host plan validators', async () => {
    const f = await domainFixture(), bound = checked(await bindDomainProfile(f.profile, f.bindings)), p = await frozen();
    for (const [contract, plan] of [
      [p.contract, { ...p.plan, evaluator: { id: 'wrong-evaluator', version: '1' } }],
      [{ ...p.contract, metrics: [{ ...p.contract.metrics[0], unit: 'points' }] }, p.plan],
      [{ ...p.contract, metrics: [{ ...p.contract.metrics[0], direction: 'maximize' as const }] }, p.plan],
    ] satisfies Array<[ResearchContract, ExperimentPlan]>) assert.equal(bound.validatePlan(contract, plan).valid, false);
    assert.equal(f.calls.validator, 0);
    assert.ok(bound.validatePlan(p.contract, p.plan).valid); assert.equal(f.calls.validator, 1);
  });
  it('retains plan issues and counts malformed, throwing and asynchronous validators', async () => {
    const issue: ResearchIssue = { code: 'TRSH1006', path: '/plan/conditions', detail: 'Unregistered plan.' };
    for (const validate of [() => [issue], () => { throw Error('host failed'); }, () => [{ unexpected: true }],
      () => ({ then: () => undefined })]) {
      const f = await domainFixture(), p = await frozen();
      f.bindings.planValidators['fixture-plan'].validate = validate as ResearchDomainBindings['planValidators'][string]['validate'];
      const bound = checked(await bindDomainProfile(f.profile, f.bindings)), result = bound.validatePlan(p.contract, p.plan);
      assert.equal(result.valid, false);
      if (!result.valid) assert.ok(['TRSH1006', 'TRSH2008'].includes(result.issues[0].code));
      assert.equal(f.calls.model + f.calls.runner + f.calls.evaluator + f.calls.exporter, 0);
    }
  });
  it('fills the native execution policy without allowing resource or network overrides', async () => {
    const f = await domainFixture(), bound = checked(await bindDomainProfile(f.profile, f.bindings));
    const policy = checked(await domainExecutionPolicy(bound, f.fields));
    assert.equal((await researchExecutionRevisionOf(policy)).length, 64);
    assert.deepEqual(policy.resources, f.profile.runnerManifestTemplate.resources);
    for (const fields of [
      { ...f.fields, imageDigest: 'unpinned' }, { ...f.fields, datasetPaths: [{ datasetId: 'fixture-data', path: '../secret' }] },
      { ...f.fields, network: { measured: 'on' } }, { ...f.fields, resources: { cpu: 999 } },
    ]) assert.equal((await domainExecutionPolicy(bound, fields)).valid, false);
  });
});
