import { it } from 'node:test';
import assert from 'node:assert/strict';
import { openTangleDb } from '@tangleai/store';
import { createVectorSqlObserver } from '../../benchmark/lib/vector-observation.ts';

it('physical observation includes transaction statements and counts delivered rows without inventing page scans', async () => {
  let now = 0; const observer = createVectorSqlObserver(() => now++);
  const db = await openTangleDb({ driver: observer.driver });
  try {
    observer.reset();
    const row = { id: 'observed', sourceId: null, versionId: null, projectionId: null, normalizedName: null,
      status: 'active', sourceEntityId: null, targetEntityId: null, payload: {} };
    await db.transaction(async scope => { await scope.collection('lightrag_entities').put(row); });
    assert.equal(observer.snapshot().lightrag_entities.writes, 1);
    observer.reset();
    await db.transaction(async scope => {
      const rows = [];
      for await (const row of scope.collection('lightrag_entities').query({ $for: { r: '$[*]' }, $return: '$r' })) rows.push(row);
      assert.equal(rows.length, 1);
    });
    const counts = observer.snapshot().lightrag_entities;
    assert.equal(counts.returnedRows, 1); assert.equal(counts.statements, 1);
    assert.equal(counts.failures, 0); assert.equal(counts.writes, 0); assert.ok(counts.elapsedMs > 0);
  } finally { await db.close(); }
});
