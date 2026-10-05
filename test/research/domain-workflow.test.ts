import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createResearchBinding, createResearchTaskHandlers, initialResearchFrame, prepareResearchWorkflow,
  ResearchFailure, researchValue, type ResearchTaskTools } from '@tangleai/research';
import { bindComputationalResearchDomain } from '../../apps/research-runner/src/domains.ts';
import { researchExampleIdentity, researchExampleLimits, researchExampleTools } from '../../examples/research.ts';
import { workflowFixture, workflowHarness } from './workflow-fixtures.ts';
import { checked } from './fixtures.ts';
import { executionWorkflowFixture, executionWorkflowTools } from './execution-workflow-fixtures.ts';

async function domainWorkflow() {
  const f = await workflowFixture(), calls = { model: 0, evaluator: 0 };
  const domain = checked(await bindComputationalResearchDomain({ ...f.plan.evaluator,
    evaluate: async () => { calls.evaluator++; return { valid: false, issues: [{ code: 'TRSH1008', path: '/control', detail: 'The lifecycle control has no science evaluator.' }] }; } },
  { units: f.contract.metrics.map(row => ({ metricId: row.id, unit: row.unit, direction: row.direction })) }));
  f.binding = await createResearchBinding(f.contract, { identity: await researchExampleIdentity(),
    promptRevision: f.binding.promptRevision, toolVersions: f.binding.toolVersions, evaluator: f.plan.evaluator,
    reservation: f.binding.reservation, domain: domain.manifest });
  f.prepared = await prepareResearchWorkflow(f.contract, { binding: f.binding, profile: 'research-scripted', limits: researchExampleLimits });
  f.frame = await initialResearchFrame(f.project, f.plan, f.binding);
  return { f, domain, calls };
}

it('pins the admitted domain across all native stages without changing control cost', async () => {
  const { f, domain, calls } = await domainWorkflow();
  const h = await workflowHarness(f, { tools: base => ({ ...base, domain }),
    clientFor: () => ({ endpoint: { provider: 'scripted' }, complete: async () => { calls.model++; throw Error('No-model control called a model.'); } }) });
  try {
    await h.start(); const trace = await h.finish(), snapshot = await h.snapshot();
    assert.equal(trace.run.status, 'completed'); assert.equal(snapshot.state.status, 'COMPLETE');
    assert.ok(h.executions > 0); assert.deepEqual(calls, { model: 0, evaluator: 0 });
    for (const { attempt } of snapshot.attempts) {
      assert.deepEqual(attempt.toolVersions.find(row => row.name === 'research-domain-profile'),
        { name: 'research-domain-profile', version: domain.profile.revision });
      assert.deepEqual(attempt.spend, { calls: 0, tokens: 0, ms: 0, physical: 0 });
    }
  } finally { await h.close(); }
});

it('refuses a removed, forged or revision-swapped profile before stage dispatch', async () => {
  const { f, domain } = await domainWorkflow();
  const h = await workflowHarness(f, { tools: base => ({ ...base, domain }) });
  try {
    const base = researchExampleTools({ ...f, masStore: h.host.masStore });
    const altered = checked(await bindComputationalResearchDomain({ ...f.plan.evaluator,
      evaluate: async () => ({ valid: true, value: [] }) },
    { units: f.contract.metrics.map(row => ({ metricId: row.id, unit: row.unit, direction: row.direction })),
      resources: { ...domain.profile.runnerManifestTemplate.resources, cpu: 2 } }));
    for (const changed of [base, { ...base, domain: { ...domain } }, { ...base, domain: altered }]) {
      assert.throws(() => createResearchTaskHandlers(h.host.researchStore, changed as ResearchTaskTools),
        cause => cause instanceof ResearchFailure && cause.issue.code === 'TRSH2008' && /Model calls: 0; runner invocations: 0/.test(cause.issue.detail));
    }
    assert.equal(h.executions, 0);
  } finally { await h.close(); }
});

it('refuses another project domain before its first native stage body', async () => {
  const { f, domain, calls } = await domainWorkflow();
  f.project = { ...f.project, domainProfile: 'unregistered-domain' };
  f.frame = await initialResearchFrame(f.project, f.plan, f.binding);
  const h = await workflowHarness(f, { tools: base => ({ ...base, domain }) });
  try {
    await h.start(); const trace = await h.segment();
    assert.equal(trace.run.status, 'failed'); assert.equal(trace.run.failure?.error.cause?.code, 'TRSH2008');
    assert.equal(h.executions, 0); assert.deepEqual(calls, { model: 0, evaluator: 0 });
    assert.deepEqual(researchValue(await h.host.researchStore.listRecords(f.project.id, 'ExperimentRun')), []);
  } finally { await h.close(); }
});

it('captures the admitted evaluator before asynchronous execution-policy checks', async () => {
  const f = await executionWorkflowFixture();
  const domain = checked(await bindComputationalResearchDomain(f.evaluator, { resources: f.policy.resources }));
  f.binding = await createResearchBinding(f.contract, { identity: await researchExampleIdentity(), promptRevision: f.binding.promptRevision,
    toolVersions: f.binding.toolVersions, evaluator: f.plan.evaluator, reservation: f.binding.reservation, domain: domain.manifest });
  f.prepared = await prepareResearchWorkflow(f.contract, { binding: f.binding, profile: 'research-scripted', limits: researchExampleLimits, execution: f.policy });
  f.frame = await initialResearchFrame(f.project, f.plan, f.binding);
  let replacements = 0;
  const h = await workflowHarness(f, { tools: (base, stores) => {
    const pending = executionWorkflowTools(f, { ...base, domain }, stores.researchStore);
    f.evaluator.evaluate = async () => { replacements++; return { valid: false, issues: [{ code: 'TRSH1008', path: '/replacement', detail: 'Mutated evaluator.' }] }; };
    return pending;
  } });
  try {
    await h.start(); const trace = await h.finish(), snapshot = await h.snapshot();
    assert.equal(replacements, 0); assert.equal(trace.run.status, 'completed', JSON.stringify(trace.run.failure));
    assert.equal(snapshot.records.filter(row => row.kind === 'MetricObservation').length, 10);
    assert.equal(snapshot.attempts.find(row => row.attempt.stage === 'EXECUTE')!.attempt.spend.physical, 10);
  } finally { await h.close(); }
});
