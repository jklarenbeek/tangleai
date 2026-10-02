import { it } from 'node:test';
import assert from 'node:assert/strict';
import { planFill, checkRiskPolicy, sizeToPolicy } from '@tangleai/trading';
import type { BarObservation, RiskPolicy, TradingRiskInput, TradingFillInput } from '@tangleai/trading';
import { tradingFixture, decisionFixture, reidentify, value } from './fixtures.ts';

const fixture = await tradingFixture(), plan = await decisionFixture(fixture), session = fixture.sessions[1];
const bar = fixture.observations.find((o): o is BarObservation => o.kind === 'bar' && o.id === plan.fills[0].sourceBarId)!;
const filled = value(await planFill({ manifest: fixture.manifest, portfolio: fixture.initial, intent: plan.intent!, session, bar }));
const input: TradingRiskInput = { manifest: fixture.manifest, portfolioAfter: filled.portfolio, intent: plan.intent!, sessionBar: bar };

async function withPolicy(delta: Partial<RiskPolicy>): Promise<TradingRiskInput> {
  const manifest = await reidentify(fixture.manifest, { riskPolicy: { ...fixture.manifest.riskPolicy, ...delta } }), manifestId = manifest.id;
  return { manifest, portfolioAfter: await reidentify(filled.portfolio, { manifestId }), intent: await reidentify(plan.intent!, { manifestId }), sessionBar: await reidentify(bar, { manifestId }) };
}

it('every hard risk limit can refuse an otherwise advocated market trade', async () => {
  assert.deepEqual(checkRiskPolicy(input), []);
  for (const [name, delta] of Object.entries({ grossExposure: { grossExposure: 0 }, netExposure: { netExposure: 0 },
    singleName: { singleName: 0 }, cashFloor: { cashFloor: fixture.manifest.initialCapital }, maxParticipation: { maxParticipation: 0 },
    lossLimit: { lossLimit: 0 }, instruments: { instruments: ['SYN-B'] } })) {
    const request = await withPolicy(delta), issues = checkRiskPolicy(request);
    assert.ok(issues.some(i => i.code === 'TTRD1005' && i.path === `/riskPolicy/${name}`), name);
    assert.deepEqual(checkRiskPolicy(request), issues);
  }
  const stop = { ...input, intent: await reidentify(input.intent, { orderKind: 'stop', stopPrice: bar.open }) };
  assert.ok(checkRiskPolicy(stop).some(i => i.path === '/riskPolicy/orderKinds' && i.code === 'TTRD1005'));
});

it('forged portfolio summary ratios cannot bypass policy derived from cash and positions', async () => {
  const request = await withPolicy({ grossExposure: 0.01, singleName: 0.01 });
  request.portfolioAfter = await reidentify(request.portfolioAfter, { equity: 1e20, grossExposure: 0, netExposure: 0,
    concentration: request.portfolioAfter.concentration.map(c => ({ ...c, fraction: 0 })) });
  const issues = checkRiskPolicy(request);
  assert.ok(issues.some(i => i.path === '/riskPolicy/grossExposure')); assert.ok(issues.some(i => i.path === '/riskPolicy/singleName'));
  const foreign = { ...input, sessionBar: await reidentify(bar, { asset: 'SYN-B' }) };
  assert.equal(checkRiskPolicy(foreign)[0].code, 'TTRD1002');
  assert.equal(checkRiskPolicy(null as unknown as TradingRiskInput)[0].code, 'TTRD1001');
});

it('sizing intersects every declared limit and agrees with exhaustive whole-share admission', async () => {
  for (const delta of [{ grossExposure: 0.07 }, { netExposure: 0.07 }, { singleName: 0.07 }, { cashFloor: 95000 },
    { maxParticipation: 0.0001 }, { lossLimit: 0.00002 }, { instruments: ['SYN-B'] }] satisfies Partial<RiskPolicy>[]) {
    const risk = await withPolicy(delta), manifestId = risk.manifest.id;
    const request: TradingFillInput = { manifest: risk.manifest, portfolio: await reidentify(fixture.initial, { manifestId }),
      intent: await reidentify(risk.intent, { quantity: 100 }), session: await reidentify(session, { manifestId }), bar: risk.sessionBar };
    let largest = 0;
    for (let quantity = 1; quantity <= 100; quantity++) {
      const intent = await reidentify(request.intent, { quantity }), planned = await planFill({ ...request, intent });
      if (planned.valid && !checkRiskPolicy({ manifest: request.manifest, portfolioAfter: planned.value.portfolio, intent, sessionBar: request.bar! }).length) largest = quantity;
    }
    const sized = value(await sizeToPolicy(request));
    assert.equal(sized.quantity, largest, JSON.stringify(delta));
    assert.equal(sized.disposition, largest ? 'sized' : 'hold');
  }
});

it('a large enough sale repairs a concentration breach even when smaller sales fail', async () => {
  const manifest = await reidentify(fixture.manifest, { commissionBps: 0, slippageBps: 0, riskPolicy: { ...fixture.manifest.riskPolicy, singleName: 0.3 } }), manifestId = manifest.id;
  const portfolio = await reidentify(fixture.initial, { manifestId, cash: 20000, positions: fixture.initial.positions.map(p => p.asset === bar.asset ? { ...p, quantity: 800, costBasis: 100 } : p),
    marks: fixture.initial.marks.map(m => ({ ...m, price: 100 })) });
  const request: TradingFillInput = { manifest, portfolio, session: await reidentify(session, { manifestId }),
    bar: await reidentify(bar, { manifestId, open: 100, high: 110, low: 90, close: 100, volume: 1000000 }),
    intent: await reidentify(plan.intent!, { manifestId, side: 'sell', quantity: 750 }) };
  assert.equal(value(await sizeToPolicy(request)).quantity, 750);
  assert.equal(value(await sizeToPolicy({ ...request, intent: await reidentify(request.intent, { quantity: 100 }) })).disposition, 'hold');
});

it('fractional sizing stays within the requested quantity and validates the strict fee boundary', async () => {
  const manifest = await reidentify(fixture.manifest, { shares: 'fractional', commissionBps: 10000, riskPolicy: { ...fixture.manifest.riskPolicy, lossLimit: 1 } }), manifestId = manifest.id;
  const request: TradingFillInput = { manifest, portfolio: await reidentify(fixture.initial, { manifestId }), session: await reidentify(session, { manifestId }),
    bar: await reidentify(bar, { manifestId }), intent: await reidentify(plan.intent!, { manifestId, quantity: 2000.25 }) };
  const sized = value(await sizeToPolicy(request)); assert.equal(sized.disposition, 'sized'); assert.ok(sized.quantity <= request.intent.quantity);
  const intent = await reidentify(request.intent, { quantity: sized.quantity }), planned = value(await planFill({ ...request, intent }));
  assert.deepEqual(checkRiskPolicy({ manifest, portfolioAfter: planned.portfolio, intent, sessionBar: request.bar! }), []);
  assert.equal(value(await sizeToPolicy({ ...request, bar: null })).issues[0].code, 'TTRD1007');
});
