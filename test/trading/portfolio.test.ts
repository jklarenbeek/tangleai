import { it } from 'node:test';
import assert from 'node:assert/strict';
import { markPortfolio, applyCorporateActions, planFill, createTradingRecord } from '@tangleai/trading';
import type { BarObservation, CorporateActionObservation, PortfolioSnapshot } from '@tangleai/trading';
import oracle from '../../benchmark/fixtures/trading/golden/oracle.json' with { type: 'json' };
import cash from '../../benchmark/fixtures/trading/golden/do-nothing.json' with { type: 'json' };
import { providerFixture } from './provider-fixture.ts';
import { reidentify, value } from './fixtures.ts';

const fixture = await providerFixture(), manifest = fixture.manifest;
const bars = fixture.observations.filter((o): o is BarObservation => o.kind === 'bar');
const actions = fixture.input.observations.filter((o): o is CorporateActionObservation => o.kind === 'corporate-action');
const same = (actual: number, expected: number, label: string) => assert.equal(actual.toFixed(12), expected.toFixed(12), label);

for (const golden of [oracle, cash]) it(`${golden.id}: fills, corporate entitlements and every session valuation reproduce independent goldens`, async () => {
  let portfolio: PortfolioSnapshot = fixture.initial;
  let fills = 0, dividends = 0;
  for (const [index, session] of fixture.sessions.entries()) {
    for (const asset of manifest.assets) {
      const due = actions.filter(a => a.asset === asset && a.sessionId === session.key);
      if (due.length) {
        const applied = value(await applyCorporateActions({ manifest, portfolio, session, actions: due }));
        assert.equal(applied.ledgerEntries.reduce((n, e) => n + e.debit - e.credit, 0), 0);
        dividends += applied.ledgerEntries.filter(e => e.account === 'cash').reduce((n, e) => n + e.debit, 0);
        portfolio = applied.portfolio;
      }
      for (const expected of golden.fills.filter(f => f.asset === asset && f.sessionId === session.key)) {
        const key = { manifestId: manifest.id, asset, sessionId: expected.decisionSessionId, stage: 'broker' };
        const decision = value(await createTradingRecord('decision', { manifestId: manifest.id, key, inputRevision: portfolio.revision,
          disposition: 'approved', artifactIds: [], reason: 'Privileged oracle ledger reproduction' }));
        const intent = value(await createTradingRecord('order', { manifestId: manifest.id, decisionId: decision.id, asset,
          decisionSessionId: expected.decisionSessionId, fillSessionId: session.key, orderKind: 'market', side: expected.side as 'buy' | 'sell', quantity: expected.quantity, limitPrice: null, stopPrice: null }));
        const planned = value(await planFill({ manifest, portfolio, intent, session, bar: bars.find(b => b.asset === asset && b.sessionId === session.key)! }));
        for (const field of ['quantity', 'price', 'notional', 'commission', 'slippage'] as const) same(planned.fill[field], expected[field], `${index}/${asset}/${field}`);
        portfolio = planned.portfolio; fills++;
      }
    }
    const marked = value(await markPortfolio({ manifest, portfolio, session, bars: bars.filter(b => b.sessionId === session.key) }));
    assert.equal(marked.staleMarks, 0); portfolio = marked.portfolio;
    const expected = golden.points[index + 1];
    same(portfolio.cash, expected.cash, `${index}/cash`); same(portfolio.equity, expected.equity, `${index}/equity`);
    for (const [i, position] of portfolio.positions.entries()) {
      same(position.quantity, expected.positions[i].quantity, `${index}/${position.asset}/quantity`);
      same(position.costBasis, expected.positions[i].costBasis, `${index}/${position.asset}/costBasis`);
      same(position.cashFlow, expected.positions[i].cashFlow, `${index}/${position.asset}/cashFlow`);
      same(position.realizedPnl, expected.positions[i].realizedPnl, `${index}/${position.asset}/realizedPnl`);
      same(portfolio.marks[i].price, expected.positions[i].mark, `${index}/${position.asset}/mark`);
    }
    same(portfolio.realizedPnl, expected.positions.reduce((n, p) => n + p.realizedPnl, 0), `${index}/realizedPnl`);
    same(portfolio.unrealizedPnl, expected.positions.reduce((n, p) => n + p.unrealizedPnl, 0), `${index}/unrealizedPnl`);
  }
  assert.equal(fills, golden.fills.length);
  same(dividends, golden.ledger.filter(l => l.credit === 'dividends').reduce((n, l) => n + l.amount, 0), 'dividend total');
});

it('missing marks are counted and preserved; foreign and duplicate execution bars refuse', async () => {
  const session = fixture.sessions[1], one = bars.find(b => b.sessionId === session.key && b.asset === manifest.assets[0])!;
  const marked = value(await markPortfolio({ manifest, portfolio: fixture.initial, session, bars: [one] }));
  assert.deepEqual(marked.missingAssets, ['SYN-B']); assert.equal(marked.staleMarks, 1);
  assert.deepEqual(marked.portfolio.marks[1], fixture.initial.marks[1]);
  for (const input of [[one, one], [bars[0]]]) assert.equal((await markPortfolio({ manifest, portfolio: fixture.initial, session, bars: input })).valid, false);
});

it('corporate actions refuse duplicate applications within a plan and withheld ex-date revisions', async () => {
  const action = actions[0], session = fixture.sessions.find(s => s.key === action.sessionId)!;
  const duplicate = await applyCorporateActions({ manifest, portfolio: fixture.initial, session, actions: [action, action] });
  assert.equal(duplicate.valid, false);
  const revision = await reidentify(action, { revisionId: 'another-revision', ratio: action.ratio === null ? null : action.ratio + 1 });
  assert.equal((await applyCorporateActions({ manifest, portfolio: fixture.initial, session, actions: [action, revision] })).valid, false, 'two revisions of one economic action cannot both settle');
  const late = await reidentify(action, { availableAt: session.closeAt });
  const withheld = await applyCorporateActions({ manifest, portfolio: fixture.initial, session, actions: [late] });
  assert.equal(withheld.valid, false); if (!withheld.valid) assert.equal(withheld.issues[0].code, 'TTRD1003');
  const unsupported = await applyCorporateActions({ manifest, portfolio: fixture.initial, session, actions: [{ ...action, action: 'spin-off' } as unknown as CorporateActionObservation] });
  assert.equal(unsupported.valid, false); if (!unsupported.valid) assert.equal(unsupported.issues[0].code, 'TTRD1005');
});
