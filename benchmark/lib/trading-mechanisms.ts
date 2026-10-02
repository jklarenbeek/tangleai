/** Independent reference vectors qualify calculations, without inventing trading returns. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { equalsJson } from '@jarenjs/core/object';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { adx, cci, vwap, volumeRatio, kdj, createTradingRecord, buyAndHold, macdCross, kdjRsi, zeroMeanReversion, smaCross,
  TRADING_SIGNAL_DEFAULTS, validateTradingSignalParameters } from '@tangleai/trading';
import type { BarObservation, TradingSignalPolicy } from '@tangleai/trading';
import schema from '../schemas/trading.schema.json' with { type: 'json' };
import { createReportValidator } from './validate.ts';
import { TRADING_ROOT } from './trading.ts';
import type { TradingFixture } from './trading.ts';
import type { IndicatorReference, MechanismMeasurements, IndicatorMeasurement, SignalMeasurement } from './trading.types.ts';
import { measureTradingAnalysts } from './trading-analysts.ts';

const validateReference = createReportValidator({ $defs: schema.$defs, $ref: '#/$defs/indicatorReference' });
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const policies = { buyAndHold, macdCross, kdjRsi, zeroMeanReversion, smaCross } satisfies Record<string, TradingSignalPolicy>;
const crossings = (targets: ReadonlyArray<string | null>) => ({ entries: targets.filter((t, i) => t === 'long' && targets[i - 1] !== 'long').length,
  exits: targets.filter((t, i) => t === 'flat' && targets[i - 1] === 'long').length });

export async function measureTradingMechanisms(fixture: TradingFixture, referencePath = join(TRADING_ROOT, 'test/fixtures/trading-indicators.json')): Promise<MechanismMeasurements> {
  const analysts = await measureTradingAnalysts(fixture);
  const indicators: IndicatorMeasurement = { id: 'indicators', status: 'not-run', reason: 'Independent reference fixture is absent', total: 0, reproduced: 0, inputKinds: ['array', 'Float64Array'], tolerance: 1e-10, cases: [] };
  const signals: SignalMeasurement = { id: 'signals', status: 'not-run', reason: 'Independent reference fixture is absent', total: 0, reproduced: 0,
    parametersSha256: await canonicalSha256(TRADING_SIGNAL_DEFAULTS), cases: [] };
  let bytes: Uint8Array;
  try { bytes = await readFile(referencePath); }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return { reference: null, rows: [indicators, signals, analysts] }; throw cause; }
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes)), checked = validateReference(parsed);
  if (!checked.valid) throw Error('Invalid trading indicator reference: ' + JSON.stringify(checked.errors));
  const reference = parsed as IndicatorReference, parameters = validateTradingSignalParameters(reference.signalParameters);
  if (!parameters.valid || !equalsJson(parameters.value, TRADING_SIGNAL_DEFAULTS)) throw Error('Reference signal parameters differ from the declared defaults');
  if (reference.reference.generatorSha256 !== sha(await readFile(join(TRADING_ROOT, 'benchmark/scripts/trading-indicator-fixtures.py')))
    || reference.source.sha256 !== sha(await readFile(join(TRADING_ROOT, reference.source.path)))) throw Error('Trading reference source identity differs');
  if (!equalsJson(reference.cases.map(c => c.id), [...fixture.manifest.assets, 'zero-volume'])
    || !equalsJson(reference.signals.map(c => c.asset), fixture.manifest.assets)) throw Error('Trading reference case census differs');
  const p = reference.parameters;
  for (const row of reference.cases) {
    const input = row.input;
    if (Object.values(input).some(values => values.length !== input.close.length)) throw Error('Unaligned indicator reference inputs');
    if (row.id !== 'zero-volume') {
      const bars = fixture.bars.filter(b => b.asset === row.id);
      for (const field of ['high', 'low', 'close', 'volume'] as const) if (!equalsJson(input[field], bars.map(b => b[field]))) throw Error('Indicator reference bars differ from the fixture');
    }
    const run = (typed: boolean): Record<string, Array<number | null>> => {
      const array = (values: number[]) => typed ? Float64Array.from(values) : values;
      const h = array(input.high), l = array(input.low), c = array(input.close), v = array(input.volume);
      return { ...adx(h, l, c, p.adxPeriod), cci: cci(h, l, c, p.cciPeriod), vwap: vwap(h, l, c, v),
        sessionVwap: vwap(h, l, c, v, input.resets), volumeRatio: volumeRatio(v, p.volumePeriod), ...kdj(h, l, c, p.kPeriod, p.dPeriod) };
    };
    const arrays = run(false), typed = run(true);
    for (const vector of Object.keys(row.expected) as Array<keyof typeof row.expected>) {
      const expected = row.expected[vector];
      if (expected.length !== input.close.length) throw Error('Unaligned indicator reference vector');
      let maximumAbsoluteError = 0, reproduced = true;
      for (const actual of [arrays[vector], typed[vector]]) {
        reproduced &&= actual.length === expected.length;
        for (const [i, wanted] of expected.entries()) {
          const observed = actual[i];
          if (wanted === null) reproduced &&= observed === null;
          else if (observed === null || !Number.isFinite(observed)) reproduced = false;
          else { const error = Math.abs(observed - wanted); maximumAbsoluteError = Math.max(maximumAbsoluteError, error); reproduced &&= error < indicators.tolerance; }
        }
      }
      indicators.cases.push({ fixture: row.id, vector, positions: expected.length, warmup: expected.filter(v => v === null).length, maximumAbsoluteError,
        referenceSha256: await canonicalSha256(expected), arraySha256: await canonicalSha256(arrays[vector]), float64Sha256: await canonicalSha256(typed[vector]), reproduced });
    }
  }
  for (const row of reference.signals) {
    const bars: BarObservation[] = [];
    for (const { id: sourceKey, kind: _kind, ...bar } of fixture.bars.filter(b => b.asset === row.asset)) {
      const record = await createTradingRecord('bar', { ...bar, sourceKey, manifestId: fixture.manifest.id });
      if (!record.valid) throw Error('Invalid signal input: ' + JSON.stringify(record.issues));
      bars.push(record.value);
    }
    for (const policy of Object.keys(policies) as Array<keyof typeof policies>) {
      const outcome = policies[policy](bars, parameters.value);
      if (!outcome.valid) throw Error('Signal policy refused its registered inputs: ' + JSON.stringify(outcome.issues));
      const targets = outcome.value.map(s => s?.target ?? null), expected = row.targets[policy], actualCrossings = crossings(targets), expectedCrossings = crossings(expected);
      const reproduced = equalsJson(targets, expected) && equalsJson(expectedCrossings, row.crossings[policy]);
      signals.cases.push({ asset: row.asset, policy, sessions: targets.length, warmup: targets.filter(t => t === null).length, ...actualCrossings,
        expectedEntries: expectedCrossings.entries, expectedExits: expectedCrossings.exits, referenceSha256: await canonicalSha256(expected), actualSha256: await canonicalSha256(targets), reproduced });
    }
  }
  for (const row of [indicators, signals]) { row.status = 'measured'; row.reason = null; row.total = row.cases.length; row.reproduced = row.cases.filter(c => c.reproduced).length; }
  return { reference: reference.reference, rows: [indicators, signals, analysts] };
}
