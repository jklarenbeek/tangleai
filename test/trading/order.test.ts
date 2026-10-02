import { it } from 'node:test';
import assert from 'node:assert/strict';
import { toOrderIntent, type RiskVerdict, type RiskVerdictOutput, type RiskPolicy, type FundManagerOutput, type TradingOrderInput, type TradingRunManifest } from '@tangleai/trading';
import { riskFixture, checked } from './risk-fixture.ts';
import { reidentify } from './fixtures.ts';
import { prepareTradingRiskDecisionDrive } from '../../benchmark/lib/trading-risk-runner.ts';

const base = await riskFixture();
async function request(options: { policy?: Partial<RiskPolicy>; quantity?: number; action?: 'buy' | 'sell'; decision?: 'approved' | 'modified'; modelQuantity?: number;
  targetWeight?: number; sessionIndex?: number; shares?: TradingRunManifest['shares'] } = {}): Promise<TradingOrderInput> {
  const quantity = options.quantity ?? 2, action = options.action ?? 'buy';
  const intent = options.targetWeight === undefined ? { action, quantity } : { action, targetWeight: options.targetWeight };
  const f = Object.keys(options).some(k => !['decision', 'modelQuantity'].includes(k)) ? await riskFixture({ shares: options.shares ?? base.manifest.shares,
    riskPolicy: { ...base.manifest.riskPolicy, ...options.policy } }, intent, options.sessionIndex ?? 60) : base;
  const composed = await prepareTradingRiskDecisionDrive(f), script = composed.response('adjust');
  const run = await composed.run({ response: async (node, i, phase, messages) => {
    const out = await script(node, i, phase, messages);
    if (node === 'risk-facilitator') (out as RiskVerdictOutput).adjustedIntent = intent;
    if (node === 'fund-manager') { const manager = out as FundManagerOutput; manager.decision = options.decision ?? 'approved'; manager.finalIntent = options.modelQuantity === undefined ? intent : { action, quantity: options.modelQuantity }; }
    return out;
  } });
  assert.equal(run.status, 'completed', JSON.stringify(run.trace.run.failure));
  const { verdict: riskVerdict, decision } = run.output as { verdict: RiskVerdict; decision: TradingOrderInput['decision'] };
  assert.equal(decision.spend.calls, 2); assert.equal(run.usage.physical, 10);
  return { manifest: f.manifest, snapshot: f.snapshot, portfolio: f.portfolio, proposal: f.proposal, riskVerdict, decision };
}
it('approval creates one next-open intent with exact financial and artifact provenance', async () => {
  const input = await request(), result = checked(await toOrderIntent(input));
  assert.ok(result.intent, JSON.stringify(result)); assert.equal(result.intent.quantity, 2); assert.deepEqual(result.violations, []);
  assert.equal(result.intent.decisionId, result.decision.id); assert.deepEqual(result.intent.provenance,
    { proposalId: input.proposal.id, riskVerdictId: input.riskVerdict.id, decisionId: input.decision.id });
  assert.ok(result.intent.priceEvidenceIds!.every(id => input.snapshot.observations.some(o => o.id === id)));
  assert.deepEqual(checked(await toOrderIntent(input)), result);
});
for (const [name, options, path] of [
  ['cash', { quantity: 100000 }, '/riskPolicy/cashFloor'],
  ['gross exposure', { policy: { grossExposure: 0 } }, '/riskPolicy/grossExposure'],
  ['net exposure', { policy: { netExposure: 0 } }, '/riskPolicy/netExposure'],
  ['concentration', { policy: { singleName: 0 } }, '/riskPolicy/singleName'],
  ['cash floor', { policy: { cashFloor: 100000 } }, '/riskPolicy/cashFloor'],
  ['liquidity participation', { policy: { maxParticipation: 0 } }, '/riskPolicy/maxParticipation'],
  ['loss floor', { policy: { lossLimit: 0 } }, '/riskPolicy/lossLimit'],
  ['prohibited short', { action: 'sell' }, '/shorting'],
  ['permitted instruments', { policy: { instruments: ['SYN-B'] } }, '/riskPolicy/instruments'],
] as const) it(`hard ${name} refusal survives every role advocating the trade`, async () => {
  const input = await request(options as Parameters<typeof request>[0]), result = checked(await toOrderIntent(input));
  assert.equal(result.intent, null); assert.ok(result.violations.some(v => v.code === 'TTRD1005' && v.path === path), JSON.stringify(result));
});
it('a modified quantity above the trader is cut with a counted adjustment', async () => {
  const result = checked(await toOrderIntent(await request({ decision: 'modified', modelQuantity: 500 })));
  assert.equal(result.intent?.quantity, 2); assert.ok(result.adjustments.some(v => v.code === 'TTRD1005' && v.path === '/quantity'));
});
it('a modified quantity above policy is reduced by the shared sizing policy', async () => {
  const result = checked(await toOrderIntent(await request({ decision: 'modified', quantity: 1000, policy: { singleName: 0.01 } })));
  assert.ok(result.intent && result.intent.quantity > 0 && result.intent.quantity < 1000, JSON.stringify(result));
  assert.ok(result.adjustments.some(v => v.path === '/riskPolicy/singleName'));
});
it('a future execution bar cannot enter the decision-time quote', async () => {
  const input = await request(), future = base.observations.find(o => o.kind === 'bar' && o.asset === input.proposal.asset && o.sessionId === base.sessions[61].key)!;
  const refused = await toOrderIntent({ ...input, valuationObservations: [future] });
  assert.equal(refused.valid, false); if (!refused.valid) assert.equal(refused.issues[0].code, 'TTRD1003');
});
it('an approved increase and an opposing direction cannot broaden the proposal', async () => {
  const input = await request({ modelQuantity: 100 });
  const increased = checked(await toOrderIntent(input)); assert.equal(increased.intent, null); assert.ok(increased.violations.some(v => v.path === '/proposal/quantity'));
  const decision = await reidentify(input.decision, { finalIntent: { action: 'sell', quantity: 1 } });
  const opposing = checked(await toOrderIntent({ ...input, decision })); assert.equal(opposing.intent, null); assert.equal(opposing.violations[0].code, 'TTRD1005');
});
it('target weights use the last admitted close and whole-share policy', async () => {
  const input = await request({ targetWeight: 0.01 }), result = checked(await toOrderIntent(input));
  const bars = input.snapshot.observations.filter(o => o.kind === 'bar').sort((a, b) => a.eventAt.localeCompare(b.eventAt));
  const bar = bars.at(-1)!;
  assert.ok(result.intent); assert.equal(result.intent.quantity, Math.floor(0.01 * input.portfolio.cash / bar.close));
  assert.ok(result.intent.priceEvidenceIds!.includes(bar.id));
});
it('fractional admission preserves a permitted fractional size', async () => {
  const result = checked(await toOrderIntent(await request({ quantity: 0.25, shares: 'fractional' })));
  assert.equal(result.intent?.quantity, 0.25);
});
for (const [name, sessionIndex] of [['first unpublished bar', 0], ['last calendar session', 123], ['unobserved post-split price', 65]] as const)
  it(`${name} produces an explicit quote hold without an invented execution price`, async () => {
    const result = checked(await toOrderIntent(await request({ sessionIndex })));
    assert.equal(result.intent, null); assert.equal(result.decision.disposition, 'hold'); assert.ok(result.violations.some(v => v.code === 'TTRD1007'));
  });
