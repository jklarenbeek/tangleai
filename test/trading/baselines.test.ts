import { it } from 'node:test';
import assert from 'node:assert/strict';
import { buyAndHold, macdCross, kdjRsi, zeroMeanReversion, smaCross, TRADING_SIGNAL_DEFAULTS, validateTradingSignalParameters, createTradingRecord } from '@tangleai/trading';
import type { TradingSignalPolicy, TradingSignalParameters, BarObservation } from '@tangleai/trading';
import reference from '../fixtures/trading-indicators.json' with { type: 'json' };
import { tradingFixture, reidentify, value } from './fixtures.ts';

const fixture = await tradingFixture(), policies: Record<string, TradingSignalPolicy> = { buyAndHold, macdCross, kdjRsi, zeroMeanReversion, smaCross };
it('all five target policies reproduce independently measured crossings for both fixture assets', () => {
  assert.deepEqual(TRADING_SIGNAL_DEFAULTS, reference.signalParameters);
  for (const expected of reference.signals) {
    const bars = fixture.observations.filter((o): o is BarObservation => o.kind === 'bar' && o.asset === expected.asset);
    for (const [name, policy] of Object.entries(policies)) {
      const actual = value(policy(bars, TRADING_SIGNAL_DEFAULTS)), targets = actual.map(s => s?.target ?? null);
      assert.deepEqual(targets, expected.targets[name as keyof typeof expected.targets], `${expected.asset}/${name}`);
      assert.deepEqual({ entries: targets.filter((t, i) => t === 'long' && targets[i - 1] !== 'long').length,
        exits: targets.filter((t, i) => t === 'flat' && targets[i - 1] === 'long').length }, expected.crossings[name as keyof typeof expected.crossings]);
      for (const [i, signal] of actual.entries()) if (signal) {
        assert.equal(signal.observationId, bars[i].id); assert.equal(signal.sessionId, bars[i].sessionId); assert.equal(signal.availableAt, bars[i].availableAt);
      }
    }
  }
});

it('signals are prefix-stable, require declared parameters and refuse mixed or reordered input', async () => {
  const bars = fixture.observations.filter((o): o is BarObservation => o.kind === 'bar' && o.asset === 'SYN-A');
  for (const policy of Object.values(policies)) {
    const full = value(policy(bars, TRADING_SIGNAL_DEFAULTS));
    for (const end of [0, 1, 13, 14, 19, 20, 33, 60, bars.length - 1]) assert.deepEqual(value(policy(bars.slice(0, end), TRADING_SIGNAL_DEFAULTS)), full.slice(0, end));
    assert.equal(policy([bars[1], bars[0]], TRADING_SIGNAL_DEFAULTS).valid, false);
    assert.equal(policy([bars[0], bars[0]], TRADING_SIGNAL_DEFAULTS).valid, false);
    assert.equal(policy(bars, undefined as unknown as TradingSignalParameters).valid, false);
    const foreign = await reidentify(bars[1], { asset: 'FOREIGN' });
    assert.equal(policy([bars[0], foreign], TRADING_SIGNAL_DEFAULTS).valid, false);
  }
  assert.equal(validateTradingSignalParameters({ ...TRADING_SIGNAL_DEFAULTS, macd: { fast: 30, slow: 20, signal: 9 } }).valid, false);
  assert.equal(validateTradingSignalParameters({ ...TRADING_SIGNAL_DEFAULTS, meanReversion: { window: 1, deviations: 1, deviation: 'sample' } }).valid, false);
});

it('a restated input cannot label a derived signal earlier than the information it used', async () => {
  const bars = fixture.observations.filter((o): o is BarObservation => o.kind === 'bar' && o.asset === 'SYN-A');
  const first = await reidentify(bars[0], { availableAt: '2025-07-01T00:00:00Z' });
  for (const policy of Object.values(policies)) {
    const actual = value(policy([first, ...bars.slice(1)], TRADING_SIGNAL_DEFAULTS));
    assert.ok(actual.filter(s => s !== null).every(s => s.availableAt === first.availableAt));
  }
});

it('valid flat OHLC bars survive floating-point adjustment', async () => {
  const original = fixture.observations.find((o): o is BarObservation => o.kind === 'bar')!;
  const flat = await reidentify(original, { open: 1.1, high: 1.1, low: 1.1, close: 1.1, adjustedClose: 1.2599999999999998 });
  for (const policy of Object.values(policies)) {
    assert.equal(policy([flat], TRADING_SIGNAL_DEFAULTS).valid, true);
  }
});

it('malformed signal windows return content errors', () => {
  for (const policy of Object.values(policies)) assert.equal(policy(null as unknown as BarObservation[], TRADING_SIGNAL_DEFAULTS).valid, false);
});

it('run manifests enforce the same parameter relationships as signal calls', async () => {
  const { id: _id, revision: _revision, kind: _kind, ...body } = fixture.manifest;
  for (const parameters of [
    { ...TRADING_SIGNAL_DEFAULTS, macd: { fast: 30, slow: 20, signal: 9 } },
    { ...TRADING_SIGNAL_DEFAULTS, sma: { fast: 30, slow: 20 } },
    { ...TRADING_SIGNAL_DEFAULTS, kdjRsi: { ...TRADING_SIGNAL_DEFAULTS.kdjRsi, entryJ: 90 } },
    { ...TRADING_SIGNAL_DEFAULTS, kdjRsi: { ...TRADING_SIGNAL_DEFAULTS.kdjRsi, entryRsi: 90 } },
  ]) {
    assert.equal(validateTradingSignalParameters(parameters).valid, false);
    assert.equal((await createTradingRecord('manifest', { ...body, signalParameters: parameters })).valid, false);
  }
});
