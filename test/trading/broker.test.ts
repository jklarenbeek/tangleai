import { it } from 'node:test';
import assert from 'node:assert/strict';
import { planFill, validateTradingLedger } from '@tangleai/trading';
import type { TradingFillInput, BarObservation } from '@tangleai/trading';
import { tradingFixture, decisionFixture, reidentify, value } from './fixtures.ts';

const fixture = await tradingFixture(), control = await decisionFixture(fixture);
const bar = fixture.observations.find((o): o is BarObservation => o.kind === 'bar' && o.id === control.fills[0].sourceBarId)!;
const input: TradingFillInput = { manifest: fixture.manifest, portfolio: fixture.initial, intent: control.intent!, session: fixture.sessions[1], bar };

it('next-open broker quotes reproduce the independent oracle fill and balance every posting', async () => {
  const planned = value(await planFill(input));
  assert.deepEqual(planned.fill, control.fills[0]);
  assert.equal(planned.portfolio.cash, control.portfolio.cash); assert.deepEqual(planned.portfolio.positions, control.portfolio.positions);
  assert.equal(planned.portfolio.equity, planned.portfolio.cash + planned.fill.quantity * bar.open);
  assert.equal(validateTradingLedger([planned.fill], planned.ledgerEntries).valid, true);
  for (const purpose of ['principal', 'commission']) {
    const entries = planned.ledgerEntries.filter(e => e.purpose === purpose);
    assert.equal(entries.reduce((n, e) => n + e.debit - e.credit, 0), 0);
  }
  assert.ok(Object.isFrozen(planned.portfolio.positions));
  const cloned = structuredClone(input), pending = planFill(cloned); cloned.intent.quantity = 1000000;
  assert.deepEqual(value(await pending), planned);
});

it('missing bars, unsupported orders, oversells, whole-share fractions and insufficient cash are counted refusals', async () => {
  const cases: Array<[TradingFillInput, string]> = [
    [{ ...input, bar: null }, 'TTRD1007'],
    [{ ...input, intent: await reidentify(input.intent, { orderKind: 'stop', stopPrice: bar.open }) }, 'TTRD1005'],
    [{ ...input, intent: await reidentify(input.intent, { side: 'sell' }) }, 'TTRD1005'],
    [{ ...input, intent: await reidentify(input.intent, { quantity: 0.5 }) }, 'TTRD1005'],
    [{ ...input, intent: await reidentify(input.intent, { quantity: 1000000 }) }, 'TTRD1005'],
    [{ ...input, intent: await reidentify(input.intent, { fillSessionId: fixture.sessions[2].key }) }, 'TTRD1005'],
  ];
  for (const [request, code] of cases) {
    const result = await planFill(request); assert.equal(result.valid, false); if (!result.valid) assert.equal(result.issues[0].code, code);
  }
  assert.equal((await planFill(null as unknown as TradingFillInput)).valid, false);
  assert.equal((await planFill({ ...input, extra: true } as TradingFillInput)).valid, false);
});

it('equal principal and fee amounts retain distinct immutable cash postings', async () => {
  const manifest = await reidentify(fixture.manifest, { commissionBps: 10000 }), manifestId = manifest.id;
  const portfolio = await reidentify(fixture.initial, { manifestId });
  const session = await reidentify(input.session, { manifestId }), priced = await reidentify(bar, { manifestId });
  const intent = await reidentify(input.intent, { manifestId });
  const planned = value(await planFill({ manifest, portfolio, session, intent, bar: priced }));
  const cash = planned.ledgerEntries.filter(e => e.account === 'cash');
  assert.equal(cash.length, 2); assert.equal(cash[0].credit, cash[1].credit); assert.notEqual(cash[0].id, cash[1].id);
  assert.equal(new Set(planned.ledgerEntries.map(e => e.id)).size, 4);
  assert.equal(validateTradingLedger([planned.fill], planned.ledgerEntries).valid, true);
  const substituted = await reidentify(cash[0], { purpose: 'dividend' });
  assert.equal(validateTradingLedger([planned.fill], planned.ledgerEntries.map(e => e.id === cash[0].id ? substituted : e)).valid, false);
});
