import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lmeFixture } from '../fixtures/longmemeval.ts';
import { lmeScope } from '../../benchmark/lib/longmemeval.ts';
import { registerTemporal, TEMPORAL_ROWS } from '../../benchmark/lib/temporal-registration.ts';
import { createHashEmbedder } from '@tangleai/models/embed';

test('grouped registration isolates related probes without joining filler reuse', () => {
  const rows = Array.from({ length: 20 }, (_, i) => lmeFixture({ question_id: `q${i}`, answer_session_ids: [`gold${i}`] }));
  rows[1].question_id = 'q0_abs'; rows[2].answer_session_ids = rows[3].answer_session_ids;
  const r = registerTemporal(rows, ['a', 'b', 'c', 'd', 'e']);
  assert.equal(r.groups.length, 18); assert.equal(r.largestGroup, 2);
  const group = (i: number) => r.groups.find(g => g.members.includes(lmeScope(rows[i])))!.id;
  assert.equal(group(0), group(1)); assert.equal(group(2), group(3)); assert.notEqual(group(4), group(5));
  for (const g of r.groups) assert.equal(r.folds.filter(f => g.members.some(m => f.members.includes(m))).length, 1);
  assert.equal(r.folds.reduce((sum, f) => sum + f.questions, 0), 20);
  assert.deepEqual(r, registerTemporal(rows, ['a', 'b', 'c', 'd', 'e']));
  assert.deepEqual(r.controls.rows, TEMPORAL_ROWS); assert.equal(r.controls.candidatePool, 100);
  assert.equal(r.controls.embedder.model, createHashEmbedder({ dims: r.controls.embedder.dims }).model);
  assert.equal(r.locomo.confirmation.length, 3);
  assert.notEqual(r.sha256, registerTemporal(rows.slice(1), []).sha256);
});
