import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createOutcomeService } from '@tangleai/outcomes';
import { createOutcomeStore, openTangleDb } from '@tangleai/store';
import { persistenceFor } from '../../packages/outcomes/src/store.ts';
import { fixture, value, code, scopeId, revision } from './fixtures.ts';
import { lifecycleFixture } from './guarded-fixtures.ts';
import type { HistoryPage, Inspection } from '@tangleai/outcomes';

describe('scoped bounded outcome audit reads', () => {
  for (const sqlite of [false, true]) it(`stable default/max pages and fixed upper sequence on ${sqlite ? 'SQLite' : 'reference'}`, async () => {
    const db = sqlite ? await openTangleDb() : undefined;
    try {
      const f = await fixture({ store: db ? createOutcomeStore(db) : undefined });
      const query = (input: object) => ({ scopeId, artifactKey: 'a', input });
      assert.deepEqual(value(await f.service.history(query({}))), { entries: [], cursor: null, upper: 0 });
      for (let i = 0; i < 30; i++) await f.create('page-' + i);
      const first = value(await f.service.history(query({}))) as unknown as HistoryPage;
      assert.equal(first.entries.length, 50); assert.ok(first.cursor);
      await f.create('arrived-after-page-one');
      const second = value(await f.service.history(query({ cursor: first.cursor }))) as unknown as HistoryPage;
      assert.equal(second.upper, first.upper); assert.equal(second.cursor, null);
      const ids = [...first.entries, ...second.entries].map(e => e.record.id);
      assert.equal(ids.length, 90); assert.equal(new Set(ids).size, 90);
      assert.equal((value(await f.service.history(query({ pageSize: 200 }))).entries as unknown[]).length, 93);
      for (const pageSize of [0, -1, 201, 1.5]) code(await f.service.history(query({ pageSize })), 'OUTC1001');
      code(await f.service.history(query({ cursor: { ...first.cursor, scopeId: revision } })), 'OUTC1003');
      code(await f.service.history(query({ cursor: { ...first.cursor, filterId: revision } })), 'OUTC1003');
      code(await f.service.history(query({ cursor: { ...first.cursor, after: first.upper + 1 } })), 'OUTC1001');
      const foreign = await createOutcomeService({ ...f.host, scope: { ...f.host.scope, namespace: 'foreign' } });
      code(await foreign.inspect({ scopeId: foreign.scopeId, artifactKey: 'a', input: { id: ids[0] } }), 'OUTC1003');
      if (db) {
        const plan = await db.collection('outcome_records').explain({ $subsequence: [{ $for: { r: '$[*]' }, $where: { $and: [{ $eq: ['$r.scopeId', { $const: scopeId }] }, { $eq: ['$r.artifactKey', { $const: 'a' }] }, { $gt: ['$r.seq', 0] }, { $le: ['$r.seq', first.upper] }] }, $orderby: ['$r.seq', '$r.id'], $return: '$r' }, 0, 51] }) as { mode: string; sql: string; scanNarrative: string };
        assert.equal(plan.mode, 'native'); assert.match(plan.sql, /LIMIT 51/); assert.match(plan.scanNarrative, /SEARCH outcome_records USING INDEX/);
      }
    } finally { await db?.close(); }
  });
  it('validates inspect ancestry and refuses changed stored bytes on reads', async () => {
    const f = await lifecycleFixture(), root = await f.root();
    const child = await f.stage('child', { mode: 'evolve', parentVersionId: root.versionId, payload: null, patch: [{ op: 'replace', path: '/fallbackLabel', value: 'no' }] });
    const query = { scopeId, artifactKey: 'a', input: { id: child.versionId, includeLineage: true } };
    const inspection = value(await f.service.inspect(query)) as unknown as Inspection;
    assert.deepEqual(inspection.lineage.map(v => v.id), [child.versionId, root.versionId]);
    await persistenceFor(f.store).transaction(async tx => {
      const row = await tx.get('records', child.versionId); assert.ok(row && row.record.kind === 'artifactVersion');
      row.record.parentVersionId = child.versionId; await tx.put('records', row);
    });
    code(await f.service.inspect(query), 'OUTC1002');
    code(await f.service.history({ scopeId, artifactKey: 'a', input: {} }), 'OUTC1002');
    code(await f.service.inspect({ ...query, input: { id: revision } }), 'OUTC1004');
  });
});
