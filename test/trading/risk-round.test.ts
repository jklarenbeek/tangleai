import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeTradingRisk, collectTradingRiskTurns, createTradingRiskHostBindings, type RiskVerdict, type RiskTurn, type RiskVerdictOutput } from '@tangleai/trading';
import { riskFixture, attemptProvenance, checked } from './risk-fixture.ts';
const f = await riskFixture(), context = { manifest: f.manifest, snapshot: f.snapshot.snapshot, catalog: f.catalog };
type Output = { verdict: RiskVerdict; turns: RiskTurn[] };

for (const kind of ['rounds', 'limits', 'topology'] as const) it(`risk bindings refuse substituted materialized ${kind} before dispatch`, async () => {
  const workflow = structuredClone(f.materialized.workflow);
  if (kind === 'rounds') {
    const loop = workflow.nodes.find(n => n.kind === 'loop')!;
    loop.maxIterations = f.manifest.rounds.risk + 1;
  } else if (kind === 'limits') workflow.limits.calls = f.manifest.limits.calls + 1;
  else workflow.messages = [];
  const result = await createTradingRiskHostBindings({ ...f,
    materialized: { ...f.materialized, workflow, validated: { ...f.materialized.validated, workflow } },
    trace: async () => { throw Error('No model dispatch is allowed'); }, provenance: attemptProvenance });
  assert.equal(result.valid, false); if (!result.valid) assert.equal(result.issues[0].code, 'TTRD1002');
});

it('three personas receive identical inputs except persona', async () => {
  const inputs = new Map<string, unknown[]>(), script = f.response();
  const run = await f.run({ response: (node, round, phase, messages) => {
    if (phase === 'completion' && node !== 'risk-facilitator') {
      const content = messages.find(m => m.role === 'user')!.content.replace(/persona:\n[^\n]+/, 'persona:\nBOUND-PERSONA');
      inputs.set(String(round), [...inputs.get(String(round)) ?? [], content]);
    }
    return script(node, round, phase, messages);
  } });
  assert.equal(run.status, 'completed', JSON.stringify(run.trace.run.failure));
  assert.equal(inputs.size, 2);
  for (const values of inputs.values()) { assert.equal(values.length, 3); assert.deepEqual(values[0], values[1]); assert.deepEqual(values[1], values[2]); }
});
it('turns are separate artifacts in declaration order and preserve all findings', async () => {
  const run = await f.run(); assert.equal(run.status, 'completed', JSON.stringify(run.trace.run.failure));
  const output = run.output as Output;
  assert.deepEqual(output.turns.map(t => t.persona), ['risky', 'neutral', 'conservative', 'risky', 'neutral', 'conservative']);
  assert.equal(new Set(output.turns.map(t => t.id)).size, 6); assert.deepEqual(output.turns.map(t => t.previousTurnIds.length), [0, 0, 0, 3, 3, 3]);
  assert.equal(output.verdict.findings!.length, 6); assert.equal(output.verdict.spend.calls, 16); assert.equal(run.usage.physical, 16);
  assert.deepEqual(output.verdict.historyIds, output.turns.map(t => t.id)); assert.deepEqual((await f.run()).output, output);
});
it('the last permitted round is no-consensus, not TMAS2009', async () => {
  const run = await f.run(); assert.equal(run.status, 'completed', JSON.stringify(run.trace.run.failure));
  const output = run.output as Output;
  assert.equal(output.verdict.disposition, 'no-consensus'); assert.equal(output.verdict.rounds, 2); assert.equal(output.verdict.unadjusted, true);
  assert.deepEqual(output.verdict.adjustedIntent, { action: f.proposal.action, quantity: f.proposal.quantity });
  assert.deepEqual(output.verdict.judgments!.map(j => j.output.action), ['continue', 'continue']);
});
for (const action of ['adjust', 'hold', 'reject'] as const) it(`${action} terminates explicitly after one risk round`, async () => {
  const run = await f.run({ response: f.response(action) }); assert.equal(run.status, 'completed', JSON.stringify(run.trace.run.failure));
  const output = run.output as Output; assert.equal(output.verdict.rounds, 1); assert.equal(run.usage.physical, 8);
  assert.equal(output.verdict.disposition, action === 'adjust' ? 'adjusted' : action === 'reject' ? 'rejected' : 'hold');
});
it('a missing persona turn refuses TTRD1008', async () => {
  const state = checked(await initializeTradingRisk({ reports: f.reports, verdict: f.verdict, proposal: f.proposal }, context));
  const refused = await collectTradingRiskTurns(state, [], context);
  assert.equal(refused.valid, false); if (!refused.valid) assert.equal(refused.issues[0].code, 'TTRD1008');
});
it('the facilitator cannot accept a claim no turn delivered', async () => {
  const script = f.response();
  const run = await f.run({ response: async (node, i, phase, messages) => {
    const out = await script(node, i, phase, messages);
    if (node === 'risk-facilitator') (out as RiskVerdictOutput).acceptedClaims.push({ id: 'invented', reason: 'Synthetic invalid claim.' });
    return out;
  } });
  assert.equal(run.status, 'failed'); assert.match(JSON.stringify(run.trace.run.failure), /TTRD1004/);
});
it('a facilitator cannot erase a supported finding from an earlier perspective', async () => {
  const script = f.response();
  const run = await f.run({ response: async (node, i, phase, messages) => {
    const out = await script(node, i, phase, messages);
    if (node === 'risk-facilitator') (out as RiskVerdictOutput).findings.shift(); return out;
  } });
  assert.equal(run.status, 'failed'); assert.match(JSON.stringify(run.trace.run.failure), /TTRD1004/);
});
it('a supported contradiction overrides adjustment and retains the raw judgment', async () => {
  const script = f.response('adjust');
  const run = await f.run({ response: async (node, i, phase, messages) => {
    const out = await script(node, i, phase, messages);
    if (node === 'risk-facilitator') {
      const finding = (out as RiskVerdictOutput).findings[0]; finding.critical = true; finding.contradictory = true;
    }
    return out;
  } });
  assert.equal(run.status, 'completed', JSON.stringify(run.trace.run.failure));
  const { verdict } = run.output as Output;
  assert.equal(verdict.disposition, 'no-consensus'); assert.equal(verdict.rounds, 2); assert.equal(verdict.unadjusted, true);
  assert.deepEqual(verdict.judgments!.map(j => j.output.action), ['adjust', 'adjust']);
  assert.ok(verdict.findings![0].critical && verdict.findings![0].contradictory);
});
it('an evidenced rejection survives later rounds without restoring stale turn findings', async () => {
  const script = f.response();
  const run = await f.run({ response: async (node, i, phase, messages) => {
    const out = await script(node, i, phase, messages);
    if (node === 'risk-facilitator') {
      const value = out as RiskVerdictOutput, finding = value.findings[0];
      finding.disposition = 'rejected-with-reason'; finding.reason = 'The cited proposal provides no independent support for this assumption.';
      value.acceptedClaims = value.acceptedClaims.filter(c => c.id !== finding.id);
      value.rejectedClaims = [{ id: finding.id, reason: finding.reason }];
    }
    return out;
  } });
  assert.equal(run.status, 'completed', JSON.stringify(run.trace.run.failure));
  const { verdict, turns } = run.output as Output;
  assert.equal(turns[0].findings![0].disposition, 'supported');
  assert.equal(verdict.findings![0].disposition, 'rejected-with-reason'); assert.equal(verdict.findings!.length, 6);
  assert.deepEqual(verdict.judgments![0].output.rejectedClaims, verdict.judgments![1].output.rejectedClaims);
});
it('resume after a crash in round two spends zero duplicate calls', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'trading-risk-recovery-'));
  try {
    const normal = await f.run(), resumed = await f.run({ databasePath: join(dir, 'risk.sqlite'), crashBefore: 'risk-rounds/2/check-risk-conservative' });
    assert.equal(resumed.status, 'completed', JSON.stringify(resumed.trace.run.failure)); assert.equal(resumed.crashes, 1);
    assert.deepEqual(resumed.output, normal.output); assert.equal(resumed.usage.physical, normal.usage.physical);
    assert.ok(resumed.usage.restores > 0); assert.deepEqual(resumed.trace.run.budget.spent, normal.trace.run.budget.spent);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
