import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openTangleDb, createOutcomeStore } from '@tangleai/store';
import { createMemoryOutcomeStore, createOutcomeStoreAdapter, createOutcomeService } from '@tangleai/outcomes';
import { projectOutcomeConfidence } from '@tangleai/memory';
import { persistenceFor } from '../../packages/outcomes/src/store.ts';
import { fixture, memory, id, code, value, scopeId, revision, AT } from './fixtures.ts';
import type { OutcomeStore } from '@tangleai/outcomes';

describe('atomic durable confidence projection', () => {
  for (const sqlite of [false, true]) describe(sqlite ? 'SQLite' : 'reference', () => {
    async function owner(probe?: (step: string) => void) {
      const db = sqlite ? await openTangleDb() : undefined;
      return { store: db ? createOutcomeStore(db, { applyProbe: probe }) : createMemoryOutcomeStore({ applyProbe: probe }), close: () => db?.close() };
    }
    it('deduplicates citations, preserves every fact field, and never adjusts a completed score again', async () => {
      const o = await owner(); try {
        const f = await fixture({ store: o.store }); const before = { ...memory(), embedding: [1, 0], embeddedBy: { model: 'fixture', dims: 2 }, mergedFrom: ['prior'] };
        await f.store.memories.put(before);
        const s = await f.scored('one', { memoryIds: ['m', 'missing', 'm'] }), c = f.command('p', { scoreId: s.scoreId });
        const result = await f.service.project(c); assert.deepEqual({ ...value(result), projectionReceiptId: '' }, { projectionReceiptId: '', applied: 1, missing: 1, changedMemoryWrites: 1 });
        assert.deepEqual(await f.store.memories.get('m'), { ...before, confidence: 0.65 });
        const again = await f.service.project(c); assert.ok(again.ok && again.replayed); assert.equal(again.writes, 0);
        await f.store.memories.put(memory('missing')); code(await f.service.project({ ...c, requestKey: 'new-p' }), 'OUTC1007');
        assert.equal((await f.store.memories.get('missing'))!.confidence, 0.5);
        const receipt = await f.inspect(id(result, 'projectionReceiptId')); assert.equal(receipt.applied, 1); assert.equal(receipt.missing, 1);
      } finally { await o.close(); }
    });
    it('serializes different scores and one-score contenders without lost increments', async () => {
      const o = await owner(); try {
        const f = await fixture({ store: o.store }); await f.store.memories.put(memory());
        const a = await f.scored('a'), b = await f.scored('b');
        const results = await Promise.all([a, b].map(s => f.service.project(f.command('p:' + s.scoreId, { scoreId: s.scoreId })))); results.forEach(value);
        assert.equal((await f.store.memories.get('m'))!.confidence, 0.8);
        const c = await f.scored('c'); const contenders = await Promise.all(Array.from({ length: 20 }, (_, i) => f.service.project(f.command('c:' + i, { scoreId: c.scoreId }))));
        assert.equal(contenders.filter(r => r.ok).length, 1); for (const r of contenders.filter(r => !r.ok)) code(r, 'OUTC1007');
        assert.equal((await f.store.memories.get('m'))!.confidence, 0.9500000000000001);
      } finally { await o.close(); }
    });
    for (const stage of ['first-memory', 'all-memories', 'receipt', 'commit']) it(`rolls back ${stage} failure; a retry preserves the accepted resolution and applies once`, async () => {
      let armed = false, writes = 0, memoryWrites = 0;
      const o = await owner(step => {
        if (!armed) return;
        if (step === 'put:memories') memoryWrites++;
        if (step === 'put:records') writes++;
        const hit = stage === 'first-memory' ? memoryWrites === 1 : stage === 'all-memories' ? memoryWrites === 2 : stage === 'receipt' ? writes === 1 : step === 'commit' && memoryWrites > 0;
        if (hit) { armed = false; throw Error('injected atomic failure'); }
      });
      try {
        const f = await fixture({ store: o.store }); for (const m of [memory(), memory('b')]) await f.store.memories.put(m);
        const s = await f.scored('a', { memoryIds: ['m', 'b'] }), c = f.command('p', { scoreId: s.scoreId }); armed = true;
        code(await f.service.project(c), 'OUTC1015');
        assert.equal((await f.store.memories.get('m'))!.confidence, 0.5); assert.equal((await f.store.memories.get('b'))!.confidence, 0.5);
        assert.equal((await persistenceFor(f.store).transaction(tx => tx.query('records', { scopeId, kind: 'projectionReceipt' }))).length, 0);
        assert.equal((await f.inspect(s.resolutionId)).kind, 'resolution'); assert.equal((await f.inspect(s.scoreId)).kind, 'score');
        value(await f.service.project(c)); assert.equal((await f.store.memories.get('m'))!.confidence, 0.65); value(await f.service.project(c)); assert.equal((await f.store.memories.get('m'))!.confidence, 0.65);
      } finally { await o.close(); }
    });
  });
  it('counts empty citations and clamped unchanged memories, and refuses unauthorized citations without effects', async () => {
    const f = await fixture(); await f.store.memories.put({ ...memory(), confidence: 1 });
    const s = await f.scored('full'); const r = value(await f.service.project(f.command('p', { scoreId: s.scoreId }))); assert.equal(r.applied, 1); assert.equal(r.changedMemoryWrites, 0);
    const empty = await f.scored('empty', { memoryIds: [] }); const e = value(await f.service.project(f.command('p-empty', { scoreId: empty.scoreId }))); assert.equal(e.applied, 0); assert.equal(e.missing, 0);
    code(await f.create('unauthorized', { memoryIds: ['forbidden'] }), 'OUTC1003');
    const bad = await createOutcomeService({ ...f.host, store: { atomic: true, memories: f.store.memories } as OutcomeStore });
    code(await bad.project(f.command('bad', { scoreId: s.scoreId })), 'OUTC1018');
  });
  it('rechecks the frozen memory authorization before effects', async () => {
    let allowed = true; const f = await fixture({ authorize: async () => ({ allowed, authorizationId: revision }) }); await f.store.memories.put(memory());
    const s = await f.scored('one'); allowed = false;
    code(await f.service.project(f.command('p', { scoreId: s.scoreId })), 'OUTC1003'); assert.equal((await f.store.memories.get('m'))!.confidence, 0.5);
  });
  it('recovers a lost commit acknowledgement by rereading the stable receipt', async () => {
    const base = createMemoryOutcomeStore(), backing = persistenceFor(base); let lose = true;
    const store = createOutcomeStoreAdapter({ async transaction(task) {
      let projected = false;
      const result = await backing.transaction(tx => task({ ...tx, async put(table, row) { if (table === 'records' && 'kind' in row && row.kind === 'projectionReceipt') projected = true; await tx.put(table, row); } }));
      if (projected && lose) { lose = false; throw Error('lost acknowledgement'); }
      return result;
    } });
    const f = await fixture({ store }); await store.memories.put(memory()); const s = await f.scored('one'), c = f.command('p', { scoreId: s.scoreId });
    value(await f.service.project(c)); value(await f.service.project(c)); assert.equal((await store.memories.get('m'))!.confidence, 0.65);
  });
  it('replays a receipt after reopening the SQLite file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'outcome-projection-')), path = join(dir, 'state.sqlite'); let db = await openTangleDb({ path });
    try {
      const f = await fixture({ store: createOutcomeStore(db) }); await f.store.memories.put(memory()); const s = await f.scored('one'), c = f.command('p', { scoreId: s.scoreId });
      const original = await f.service.project(c); value(original); await db.close(); db = await openTangleDb({ path });
      const second = await fixture({ store: createOutcomeStore(db) }); const replay = await second.service.project(c); assert.ok(replay.ok && replay.replayed); assert.equal(replay.writes, 0); assert.equal(second.reads(), 0);
      assert.equal((await second.store.memories.get('m'))!.confidence, 0.65);
    } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
  });
  it('the shared arithmetic helper returns detached fields and preserves fact time', () => {
    const before = { ...memory(), relations: [{ relType: 'related', target: 'other' }] };
    const next = projectOutcomeConfidence(before, 'success'); assert.deepEqual(next, { ...before, confidence: 0.65 });
    next.tags.push('changed'); assert.deepEqual(before.tags, ['pin']); assert.equal(next.at, AT);
  });
});
