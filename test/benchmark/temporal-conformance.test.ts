import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { sha256 } from '../../benchmark/lib/longmemeval-source.ts';
import { TEMPORAL_FIXTURES, TEMPORAL_WRONG_CONTROLS } from '../fixtures/temporal.ts';
import { runTemporalConformance, scoreTemporal, validateTemporalConformance, renderTemporalConformance, temporalFixtureHash, type TemporalConformanceContext } from '../../benchmark/lib/temporal-conformance.ts';
import { temporalConformanceContext } from '../../benchmark/lib/temporal-conformance-source.ts';
import { temporalRuntimeAdapters } from '../../benchmark/lib/temporal-runtime.ts';

const context: TemporalConformanceContext = { sourceHash: 'a'.repeat(64), registrationHash: null,
  lme: { status: 'unavailable', qa: null, retrieval: null, futureGoldQuestions: null },
  locomo: { status: 'unavailable', scorable: null, adversarial: null, anchoredQuestions: null } };
test('independent temporal fixture includes every required family and rejects all wrong controls', () => {
  assert.equal(TEMPORAL_FIXTURES.length, 46);
  assert.equal(temporalFixtureHash(), '4fe19a9bffeda42ad5618b2d5f3ceeab5f9301a6ccee57363a8eaa3dc6f27888');
  for (let i = 1; i <= 40; i++) assert.ok(TEMPORAL_FIXTURES.some(f => f.id === `T${String(i).padStart(2, '0')}`));
  for (const c of TEMPORAL_WRONG_CONTROLS) assert.equal(scoreTemporal(TEMPORAL_FIXTURES.find(f => f.id === c.caseId)!.expected, c.actual), false, c.name);
});
test('missing adapters have no invented passing runtime rows', async () => {
  const r = await runTemporalConformance(context);
  assert.deepEqual(r.counts, { planned: 138, passed: 0, failed: 0, notImplemented: 138, unavailable: 0 });
  assert.equal(r.gate.implementationComplete, false); assert.equal(r.gate.instrumentPassed, true);
  assert.deepEqual(r, await runTemporalConformance(context));
  assert.equal(validateTemporalConformance({ ...r, counts: { ...r.counts, passed: 138 } }), false);
});
test('adapter errors, unavailable cases and false successes remain in the denominator', async () => {
  const r = await runTemporalConformance(context, {
    memory: async () => { throw new Error('injected failure'); },
    'node-sqlite': async () => ({ unavailable: 'backend unavailable' }),
    'bun-sqlite': async () => ({ status: 'success', reason: null, claimIds: [], sourceIds: [], value: null }),
  });
  assert.equal(r.counts.planned, 138); assert.equal(r.counts.unavailable, 46); assert.equal(r.counts.failed, 92);
  assert.equal(r.gate.instrumentPassed, false);
});
test('a rehashed counterfeit success is refused by exact oracle validation', async () => {
  const r = await runTemporalConformance(context);
  r.rows[0] = { ...r.rows[0], status: 'measured', passed: true, actual: { status: 'success', reason: null, sourceIds: [], claimIds: [], value: null } };
  r.counts.passed = 1; r.counts.notImplemented--;
  const { sha256: _, ...body } = r; r.sha256 = sha256(canonicalizeJson(body));
  assert.equal(validateTemporalConformance(r), false);
});
test('generated temporal document matches the measured external-data instrument when available', async t => {
  const actualContext = await temporalConformanceContext(process.cwd());
  if (actualContext.lme.status === 'unavailable' || actualContext.locomo.status === 'unavailable') {
    t.skip('optional benchmark corpora unavailable; synthetic strict checks still run'); return;
  }
  assert.deepEqual(actualContext.lme, { status: 'available', qa: 500, retrieval: 470, futureGoldQuestions: 44 });
  assert.deepEqual(actualContext.locomo, { status: 'available', scorable: 1540, adversarial: 446, anchoredQuestions: 0 });
  assert.equal(await readFile('docs/TEMPORAL_BENCHMARK.md', 'utf8'), renderTemporalConformance(await runTemporalConformance(actualContext, await temporalRuntimeAdapters())));
});
