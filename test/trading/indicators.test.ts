import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { adx, cci, vwap, volumeRatio, kdj } from '@tangleai/trading';
import * as native from '@jarenjs/core/finance/indicators';

interface Reference {
  format: string;
  reference: { python: string; generatorSha256: string; packages: Record<string, string> };
  source: { path: string; sha256: string };
  parameters: { adxPeriod: number; cciPeriod: number; volumePeriod: number; kPeriod: number; dPeriod: number; jFactor: number };
  cases: Array<{ id: string; input: { high: number[]; low: number[]; close: number[]; volume: number[]; resets: boolean[] }; expected: Record<string, Array<number | null>> }>;
}
const root = new URL('../../', import.meta.url);
const fixture = await readFile(new URL('test/fixtures/trading-indicators.json', root), 'utf8').then(bytes => JSON.parse(bytes) as Reference)
  .catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
const optional = { skip: fixture ? false : 'Reference fixture absent; run the pinned Python indicator generator' };
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

it('indicator goldens retain the executed reference versions and exact generator and bar inputs', optional, async () => {
  assert.equal(fixture!.format, 'trading-indicators-reference/1');
  assert.deepEqual(fixture!.reference.packages, { ta: '0.11.0', 'TA-Lib': '0.8.1', numpy: '2.5.3', pandas: '3.0.6' });
  assert.equal(fixture!.reference.generatorSha256, sha(await readFile(new URL('benchmark/scripts/trading-indicator-fixtures.py', root))));
  assert.equal(fixture!.source.path, 'benchmark/fixtures/trading/bars.json');
  assert.equal(fixture!.source.sha256, sha(await readFile(new URL(fixture!.source.path, root))));
  assert.deepEqual(fixture!.cases.map(c => c.id), ['SYN-A', 'SYN-B', 'zero-volume']);
});

it('all thirty independent indicator vectors reproduce within ten decimals with identical warm-up', optional, t => {
  let vectors = 0, positions = 0, defined = 0;
  const p = fixture!.parameters;
  for (const row of fixture!.cases) for (const typed of [false, true]) {
    const input = row.input, array = (values: number[]) => typed ? Float64Array.from(values) : values;
    const h = array(input.high), l = array(input.low), c = array(input.close), v = array(input.volume);
    const actual: Record<string, Array<number | null>> = { ...adx(h, l, c, p.adxPeriod), cci: cci(h, l, c, p.cciPeriod),
      vwap: vwap(h, l, c, v), sessionVwap: vwap(h, l, c, v, input.resets), volumeRatio: volumeRatio(v, p.volumePeriod), ...kdj(h, l, c, p.kPeriod, p.dPeriod) };
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(row.expected).sort());
    for (const [name, expected] of Object.entries(row.expected)) {
      if (!typed) vectors++;
      assert.equal(actual[name].length, expected.length);
      for (const [i, wanted] of expected.entries()) {
        if (!typed) positions++;
        const observed = actual[name][i];
        if (wanted === null) assert.equal(observed, null, `${row.id}/${name}/${i}`);
        else { if (!typed) defined++; assert.ok(observed !== null && Number.isFinite(observed) && Math.abs(observed - wanted) < 1e-10, `${row.id}/${name}/${i}: ${observed} != ${wanted}`); }
      }
    }
    const stochastic = native.stochastic(h, l, c, p.kPeriod, p.dPeriod), projected = kdj(h, l, c, p.kPeriod, p.dPeriod);
    assert.deepEqual(projected.k, stochastic.k); assert.deepEqual(projected.d, stochastic.d);
  }
  assert.equal(vectors, 30); assert.equal(positions, 2880); assert.ok(defined > 0);
  t.diagnostic(JSON.stringify({ vectors, positions, defined, references: fixture!.reference.packages }));
});

it('the public indicator surface consumes the suite kernels directly and preserves explicit zero-volume gaps', optional, () => {
  for (const [name, implementation] of Object.entries({ adx, cci, vwap, volumeRatio, kdj })) assert.equal(implementation, native[name as keyof typeof native]);
  const zero = fixture!.cases.find(c => c.id === 'zero-volume')!;
  assert.ok(zero.expected.vwap.every(v => v === null)); assert.ok(zero.expected.volumeRatio.every(v => v === null));
  assert.throws(() => vwap([10], [9], [9.5], [-1]), /nonnegative/);
  assert.throws(() => adx([10], [9], [11]), /OHLC/);
});
