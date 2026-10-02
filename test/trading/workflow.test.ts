import { it } from 'node:test';
import assert from 'node:assert/strict';
import { projectMasPlan } from '@tangleai/mas';
import { TRADING_ANALYST_ROLES, buildTradingDecisionWorkflow, createTradingDecisionHostBindings, type TradingDecisionOutput } from '@tangleai/trading';
import { workflowFixture } from './workflow-fixture.ts';
import { tradingDecisionScript } from '../../benchmark/lib/trading-scripts.ts';
import { attemptProvenance } from '../../benchmark/lib/trading-research-runner.ts';
import { reidentify } from './fixtures.ts';

const f = await workflowFixture();
for (const mismatch of ['rounds', 'profiles'] as const) it(`decision materialization refuses manifest ${mismatch} that differ from its regions`, async () => {
  const manifest = await reidentify(f.manifest, mismatch === 'rounds' ? { rounds: { research: 1, risk: 1 } }
    : { rolesByProfile: { research: 'scripted', trader: 'scripted', risk: 'scripted', 'fund-manager': 'scripted', 'trading-analyst-fundamentals': 'scripted' } });
  const result = await buildTradingDecisionWorkflow({ manifest, catalog: f.catalog, profile: 'scripted',
    researchMaterialized: f.materialized.researchMaterialized, riskMaterialized: f.materialized.riskMaterialized });
  assert.equal(result.valid, false);
});
it('decision bindings refuse a substituted root topology before model dispatch', async () => {
  const workflow = { ...f.materialized.workflow, messages: [] };
  const result = await createTradingDecisionHostBindings({ ...f, providers: f.fixture.providers,
    materialized: { ...f.materialized, workflow, validated: { ...f.materialized.validated, workflow } },
    trace: async () => { throw Error('No dispatch is allowed'); }, provenance: attemptProvenance });
  assert.equal(result.valid, false); if (!result.valid) assert.equal(result.issues[0].code, 'TTRD1002');
});
it('the full decision validates, plans and projects every nested region', () => {
  const projection = JSON.stringify(projectMasPlan(f.materialized.plan));
  for (const id of ['snapshot-project', 'evidence-project', 'research', 'trader', 'risk', 'fund-manager', 'order-validate']) assert.ok(projection.includes(id), id);
});
it('the full decision executes causal stages and concurrent analysts through one MAS run', async () => {
  const run = await f.run(); assert.equal(run.status, 'completed', JSON.stringify(run.trace.run.failure));
  const events = run.events, entered = (path: string) => events.indexOf(`${path}:enter`);
  assert.ok(entered('snapshot-project') < entered('analyst-fundamentals'));
  const lastEnter = Math.max(...TRADING_ANALYST_ROLES.map(role => entered(`analyst-${role}`)));
  const firstSettle = Math.min(...TRADING_ANALYST_ROLES.map(role => events.indexOf(`analyst-${role}:completed`)));
  assert.ok(lastEnter < firstSettle, JSON.stringify(events));
  const ordered = ['evidence-project', 'prepare-research', 'research', 'check-research', 'trader', 'risk', 'fund-manager', 'order-validate', 'decision-output'].map(entered);
  assert.ok(ordered.every((v, i) => v >= 0 && (!i || v > ordered[i - 1])), JSON.stringify(events));
  const output = (run.output as { output: TradingDecisionOutput }).output;
  assert.ok(output.admission.intent); assert.equal(output.artifacts.filter(a => a.kind === 'analyst-report').length, 4);
  assert.equal(output.artifacts.filter(a => a.kind === 'risk-turn').length, 3); assert.equal(run.trace.interactions.length, 0);
  assert.equal(run.usage.physical, 32); assert.deepEqual((await f.run()).output, run.output);
});
it('the full-round trace stops at the immutable byte budget without an order', async () => {
  const run = await f.run({ response: tradingDecisionScript({ fullRounds: true }) });
  assert.equal(run.status, 'failed'); assert.equal(run.trace.run.failure?.error.code, 'TMAS2009');
  assert.equal(run.output, null); assert.ok(run.usage.physical > 0); assert.ok(!run.events.includes('order-validate:enter'));
});
