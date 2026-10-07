import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { evaluateExperientialGates, reviseGatePolicy, type ExperientialEvaluationMetrics, type ExperientialGatePolicy } from '@tangleai/experiential';
import { accepted, addressedFixture } from './identity-fixtures.ts';
import { passingGateMetrics } from './gate-fixtures.ts';

it('recorded-value conformance needs every hard gate; a tie is a learning failure', async () => {
  const policy = await addressedFixture('gatePolicy'), metrics = passingGateMetrics(policy);
  assert.deepEqual(evaluateExperientialGates(metrics, policy), { passed: true, failures: [] });
  for (const index of [0, 1]) {
    const tied = structuredClone(metrics); tied.interval[index].low = 0;
    const gate = evaluateExperientialGates(tied, policy);
    assert.equal(gate.passed, false); assert.equal(gate.failures[0].gate, 'learning');
    assert.equal(gate.failures[0].observed, 0); assert.equal(gate.failures[0].tolerance, 0);
  }
  const negative = structuredClone(metrics); negative.interval[1].low = -0.1;
  assert.equal(evaluateExperientialGates(negative, policy).passed, false);
  assert.ok(Object.isFrozen(evaluateExperientialGates(metrics, policy)));
});

it('each required row fails closed when missing, not run, unidentified, incomplete or rate limited', async () => {
  const policy = await addressedFixture('gatePolicy');
  for (const index of [0, 1, 2, 3, 4]) for (const fault of ['missing', 'not-run', 'no-identity', 'no-metric', 'empty', 'failure', 'duplicate']) {
    const metrics = passingGateMetrics(policy), row = metrics.rows[index];
    if (fault === 'missing') metrics.rows.splice(index, 1);
    if (fault === 'not-run') row.status = 'not-run';
    if (fault === 'no-identity') row.identityId = null;
    if (fault === 'no-metric') row.cgc = null;
    if (fault === 'empty') row.samples = 0;
    if (fault === 'failure') row.failures = 1;
    if (fault === 'duplicate') metrics.rows.push({ ...row, cgc: 0.25 });
    const result = evaluateExperientialGates(metrics, policy);
    assert.equal(result.passed, false, index + '/' + fault);
    assert.ok(result.failures.some(failure => failure.gate === 'learning'), index + '/' + fault);
  }
});

it('interval settings and coverage must match both registered controls', async () => {
  const policy = await addressedFixture('gatePolicy');
  for (const key of ['seed', 'resamples', 'pairs'] as const) {
    const metrics = passingGateMetrics(policy); metrics.interval[0][key]++;
    assert.equal(evaluateExperientialGates(metrics, policy).passed, false, key);
  }
  const missing = passingGateMetrics(policy); missing.interval.pop();
  assert.equal(evaluateExperientialGates(missing, policy).passed, false);
  const crossed = passingGateMetrics(policy); crossed.interval[0].high = -0.5;
  assert.equal(evaluateExperientialGates(crossed, policy).passed, false);
});

it('each registered retention lane must be measured and stay within its inclusive drop bound', async () => {
  const policy = await addressedFixture('gatePolicy', { retention: { cgtReplayMaxDrop: 0.05, baseReplayMaxDrop: 0.05, locomoRecallMaxDrop: 0.05, locomoQaMaxDrop: 0.05 } });
  for (let index = 0; index < 4; index++) {
    const metrics = passingGateMetrics(policy); metrics.retention[index].drop = 0.05;
    assert.equal(evaluateExperientialGates(metrics, policy).passed, true);
    metrics.retention[index].drop = 0.05000001;
    assert.equal(evaluateExperientialGates(metrics, policy).failures[0].gate, 'retention');
    metrics.retention[index].status = 'not-run'; metrics.retention[index].drop = null;
    assert.equal(evaluateExperientialGates(metrics, policy).passed, false);
    metrics.retention.splice(index, 1);
    assert.equal(evaluateExperientialGates(metrics, policy).passed, false);
  }
});

it('security requires every registered fixture and cannot accept a renamed, missing or changed result', async () => {
  const policy = await addressedFixture('gatePolicy', { security: { fixtures: ['poison', 'cross-scope', 'canary'], requiredOutcome: 'refused-or-unchanged' } });
  for (const outcome of ['refused', 'unchanged', 'changed', 'not-run'] as const) {
    const metrics = passingGateMetrics(policy); metrics.security[1].outcome = outcome;
    assert.equal(evaluateExperientialGates(metrics, policy).passed, outcome === 'refused' || outcome === 'unchanged');
  }
  const missing = passingGateMetrics(policy); missing.security.pop();
  assert.equal(evaluateExperientialGates(missing, policy).failures[0].gate, 'security');
  const foreign = passingGateMetrics(policy); foreign.security[0].fixtureId = 'unregistered';
  assert.equal(evaluateExperientialGates(foreign, policy).passed, false);
});

it('operation bounds include unknown observations, monetary ceilings and runtime compatibility', async () => {
  const original = await addressedFixture('gatePolicy');
  const policy = await addressedFixture('gatePolicy', { operations: { ...original.operations, maxCost: 1 } });
  for (const [key, limit] of [['artifactBytes', 4096], ['trainingMs', 10000], ['inferenceP95Ms', 100], ['failureRate', 0], ['cost', 1]] as const) {
    const metrics = passingGateMetrics(policy); metrics.operations[key] = limit;
    assert.equal(evaluateExperientialGates(metrics, policy).passed, true, key);
    metrics.operations[key] = limit + 1;
    assert.equal(evaluateExperientialGates(metrics, policy).passed, false, key);
    metrics.operations[key] = null;
    assert.equal(evaluateExperientialGates(metrics, policy).passed, false, key);
  }
  const wrong = passingGateMetrics(policy); wrong.operations.runtimeProvider = 'foreign';
  assert.equal(evaluateExperientialGates(wrong, policy).failures[0].gate, 'operations');
  wrong.operations.runtimeProvider = 'fixture'; wrong.operations.status = 'not-run';
  assert.equal(evaluateExperientialGates(wrong, policy).passed, false);
});

it('recorded interval changes flip the gate without recomputing accuracy or statistics', async () => {
  const policy = await addressedFixture('gatePolicy'), metrics = passingGateMetrics(policy);
  metrics.interval[1].low = 0; assert.equal(evaluateExperientialGates(metrics, policy).passed, false);
  metrics.interval[1].low = 0.25; assert.equal(evaluateExperientialGates(metrics, policy).passed, true);
  const source = await readFile('packages/experiential/src/gates.ts', 'utf8');
  assert.doesNotMatch(source, /bootstrap|\bmean\s*\(|\bquantile\s*\(|Math\.random|Date\.now|performance\.now/);
  assert.match(source, /createGuardedRefiner/);
});

it('policy/scope mismatches, migration experiments, explanations and malformed numbers cannot waive gates', async () => {
  const policy = await addressedFixture('gatePolicy');
  for (const mutation of [(m: ExperientialEvaluationMetrics) => { m.scope = 'other'; },
    (m: ExperientialEvaluationMetrics) => { m.gatePolicyId = 'f'.repeat(64); },
    (m: ExperientialEvaluationMetrics) => { m.migrationExperiment = true; },
    (m: ExperientialEvaluationMetrics) => { m.rows[0].cgc = NaN; }]) {
    const metrics = passingGateMetrics(policy); mutation(metrics);
    assert.equal(evaluateExperientialGates(metrics, policy).passed, false);
  }
  const explained = { ...passingGateMetrics(policy), explanation: 'The candidate says it passed.', passed: true };
  assert.equal(evaluateExperientialGates(explained, policy).passed, false);
});

it('policy revision uses native guarded hooks and persists a new immutable identity', async () => {
  const original = await addressedFixture('gatePolicy');
  const proposal = await addressedFixture('gatePolicy', { retention: { ...original.retention, cgtReplayMaxDrop: 0.05 } });
  const calls: string[] = [], retained: ExperientialGatePolicy[] = [original];
  const revised = accepted(await reviseGatePolicy({ read: async () => { calls.push('read'); return original; }, proposal,
    commit: async (next, previous) => { calls.push('commit'); assert.deepEqual(previous, original); retained.push(next); return { ok: true, value: next }; } }));
  assert.deepEqual(calls, ['read', 'commit']); assert.notEqual(revised.id, original.id); assert.equal(retained[0], original);
  for (const invalid of [{ ...proposal, id: original.id }, await addressedFixture('gatePolicy', { scope: 'foreign' })]) {
    const result = await reviseGatePolicy({ read: async () => original, proposal: invalid,
      commit: async () => { assert.fail('A refused policy cannot publish.'); } });
    assert.equal(result.ok, false); if (!result.ok) assert.ok(result.issues[0].cause?.code);
  }
  const failed = await reviseGatePolicy({ read: async () => { throw Error('PRIVATE-HOST-DETAIL'); }, proposal, commit: async () => { assert.fail('No commit.'); } });
  assert.equal(failed.ok, false); assert.doesNotMatch(JSON.stringify(failed), /PRIVATE-HOST-DETAIL/);
});
