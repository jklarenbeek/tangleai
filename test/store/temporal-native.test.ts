import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openTangleDb, createTemporalDbStore, inspectTemporalSeek, selectTemporalDbAsOf } from '@tangleai/store';
import type { TemporalResult } from '@tangleai/memory/temporal';
import { buildTemporalFixture } from '../../benchmark/lib/temporal-runtime-fixtures.ts';
import { TEMPORAL_FIXTURES } from '../fixtures/temporal.ts';
const must = <T>(r: TemporalResult<T>): T => { if (r.status !== 'success') throw Error(`${r.reason}: ${r.detail}`); return r.value; };
// Narrow only the public diagnostic fields whose values this qualification observes.
interface Plan { mode: string; series: { mode: string; operation: string; index: string } }
interface Stats { series: { candidates: number; results: number; diverted: number; statements: number } }
test('scoped native seeks refine expired latest candidates before selection and refuse truncation', async () => {
  const db = await openTangleDb();
  try {
    const { expected: _, ...fixture } = TEMPORAL_FIXTURES.find(f => f.id === 'T10')!;
    const { bundle, claimNames } = must(await buildTemporalFixture(fixture));
    must(await createTemporalDbStore(db).apply(bundle, { key: 'prepare', expectedHead: null }));
    const seek = { kind: 'claim-asof' as const, scope: bundle.projection.scope, versionId: bundle.projection.versionId, subject: 'alex', series: 'address', at: 50, limit: 100 };
    const inspected = must(await inspectTemporalSeek(db, seek));
    const plan = inspected.explain as Plan, stats = inspected.stats as Stats;
    assert.equal(plan.mode, 'native'); assert.equal(plan.series.mode, 'native'); assert.equal(plan.series.operation, 'asof');
    assert.equal(plan.series.index, 'temporal_claims_by_scope_version_series_at');
    assert.equal(stats.series.diverted, 0);
    assert.equal(inspected.rows.length, 2);
    const selected = must(await selectTemporalDbAsOf(db, seek));
    assert.deepEqual(selected.claims.map(c => claimNames[c.id]), ['c1']); assert.equal(selected.refined, 1);
    const limited = await selectTemporalDbAsOf(db, { ...seek, limit: 1 });
    assert.equal(limited.status !== 'success' && limited.reason, 'incomplete-index');
    assert.equal((await selectTemporalDbAsOf(db, { ...seek, knownBefore: -1 })).status, 'refused');
    for (const scope of ['absent', "$r.scope' OR 1=1 --"]) assert.equal(must(await inspectTemporalSeek(db, { ...seek, scope })).rows.length, 0);
    const observed = must(await inspectTemporalSeek(db, { kind: 'observed-range', scope: seek.scope, from: 0, until: 1, limit: 10 }));
    assert.equal((observed.explain as Plan).mode, 'native');
    assert.equal((observed.explain as Plan).series.index, 'temporal_occurrences_by_scope_observed');
    assert.equal((observed.stats as Stats).series.diverted, 0); assert.equal(observed.rows.length, 1);
    assert.equal(must(await inspectTemporalSeek(db, { kind: 'observed-range', scope: seek.scope, from: 1, until: 2, limit: 10 })).rows.length, 0);
  } finally { await db.close(); }
});

test('native as-of selection retains unknown-time claims outside the numeric candidate index', async () => {
  const db = await openTangleDb();
  try {
    const { expected: _, ...fixture } = TEMPORAL_FIXTURES.find(f => f.id === 'T17')!;
    const { bundle } = must(await buildTemporalFixture(fixture));
    must(await createTemporalDbStore(db).apply(bundle, { key: 'unknown', expectedHead: null }));
    const seek = { kind: 'claim-asof' as const, scope: bundle.projection.scope, versionId: bundle.projection.versionId,
      subject: 'alex', series: 'address', at: 5, limit: 100 };
    const result = await selectTemporalDbAsOf(db, seek);
    assert.equal(result.status, 'refused');
    assert.equal(result.reason, 'unknown-validity');
    const excluded = await selectTemporalDbAsOf(db, { ...seek, knownBefore: -1 });
    assert.equal(excluded.status, 'refused'); assert.equal(excluded.reason, 'no-match');
    const foreign = await selectTemporalDbAsOf(db, { ...seek, scope: 'other' });
    assert.equal(foreign.status, 'refused'); assert.equal(foreign.reason, 'no-match');
  } finally { await db.close(); }
});
