import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { openStore } from '@jarenjs/db';
import { openTangleDb, createPlaceDbStore, placeReadDocument, TANGLE_DB_MODEL, pickDriver, createDbMemoryStore, asRows } from '@tangleai/store';
import { createMemoryUnit } from '@tangleai/memory';
import { placeNeighbourhood, placeCell, type Gazetteer } from '@tangleai/memory/place';
import { validatePlaceShape } from '@tangleai/core/schemas/place';
import fixture from '../../benchmark/fixtures/place/gazetteer.json' with { type: 'json' };
import { placeDocument, placeGazetteer, placeValue } from '../memory/place-fixture.ts';

it('round-trips every sourced entry through actual SQLite close/reopen and replays with zero writes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'place-reopen-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'places.db'), gazetteer = await placeGazetteer();
  let db = await openTangleDb({ path });
  try {
    let store = createPlaceDbStore(db);
    assert.deepEqual(placeValue(await store.loadGazetteer(gazetteer)), { writes: 72, replayed: false });
    assert.deepEqual(placeValue(await store.entries(gazetteer.id)), fixture.entries);
    assert.equal(store.stats().writes, 72);
    await db.close(); db = await openTangleDb({ path }); store = createPlaceDbStore(db);
    const before = canonicalizeJson(placeValue(await store.entries(gazetteer.id)));
    assert.equal(before, canonicalizeJson(fixture.entries));
    assert.deepEqual(placeValue(await store.loadGazetteer(await placeDocument())), { writes: 0, replayed: true });
    assert.equal(store.stats().writes, 0);
    assert.equal(canonicalizeJson(placeValue(await store.entries(gazetteer.id))), before);
    for (const entry of gazetteer.entries) assert.deepEqual(placeValue(await store.entry(gazetteer.id, entry.id)), entry);
    assert.equal((await db.integrityCheck()).ok, true);
  } finally { await db.close(); }
});

it('refuses a new revision under an existing id without changing any persisted row', async () => {
  const db = await openTangleDb();
  try {
    const store = createPlaceDbStore(db), original = await placeDocument(fixture.entries.slice(0, 2));
    placeValue(await store.loadGazetteer(original));
    const changed = structuredClone(original.entries); changed[0].names.push('Another sourced alias');
    const result = await store.loadGazetteer(await placeDocument(changed));
    assert.equal(result.status === 'refused' && result.code, 'TPLC1001');
    assert.equal(result.status === 'refused' && result.detail, 'gazetteer revision differs; load under a new id');
    assert.deepEqual(placeValue(await store.entries(original.id)), original.entries);
    assert.equal(store.stats().writes, 3);
    for (const result of [await store.entry(original.id, 'absent'), await store.entries('absent-gazetteer')]) {
      assert.equal(result.status === 'refused' && result.code, 'TPLC1004');
    }
  } finally { await db.close(); }
});

it('uses native cell predicates for every fixture neighbourhood and refuses unsupported precision', async () => {
  const db = await openTangleDb();
  try {
    const gazetteer = await placeGazetteer(), store = createPlaceDbStore(db);
    placeValue(await store.loadGazetteer(gazetteer));
    for (const entry of gazetteer.entries) {
      const cells = placeValue(placeNeighbourhood(entry, 6));
      const selected = placeValue(await store.entriesInCells(gazetteer.id, cells));
      assert.ok(selected.some(candidate => candidate.id === entry.id));
      assert.deepEqual(selected.map(e => e.id), gazetteer.entries.filter(e => cells.includes(placeValue(placeCell(e, 6)))).map(e => e.id));
    }
    assert.deepEqual(placeValue(await store.entriesInCells(gazetteer.id, [])), []);
    for (const cells of [['u173'], ['aaaaaa'], ['U173ZQ']]) {
      const result = await store.entriesInCells(gazetteer.id, cells);
      assert.equal(result.status === 'refused' && result.code, 'TPLC1001');
    }
    const cells = placeValue(placeNeighbourhood(gazetteer.entries[0], 6));
    const query = placeReadDocument(gazetteer.id, cells);
    const explain = await db.collection('place_gazetteer').explain(query) as {
      mode: string; residual: unknown; sql: string; scanNarrative: string;
    };
    assert.equal(explain.mode, 'native'); assert.equal(explain.residual, null);
    assert.match(explain.sql, /"gx_cell6" = \?/, 'cell refinement executes in native SQL');
    assert.match(explain.scanNarrative, /SEARCH place_gazetteer USING INDEX place_gazetteer_by_gazetteer(?:_cell)? \(/,
      'check the actual SQLite seek, not the inventory of available indexes');
  } finally { await db.close(); }
});

it('rolls back entry, header and commit failures and records only committed writes', async () => {
  for (const stage of ['put:entry', 'put:gazetteer', 'commit']) {
    const db = await openTangleDb();
    try {
      let failing = true;
      const store = createPlaceDbStore(db, { applyProbe(step) { if (failing && step === stage) throw Error(`injected:${stage}`); } });
      const document = await placeDocument(fixture.entries.slice(0, 2));
      const result = await store.loadGazetteer(document);
      assert.equal(result.status === 'refused' && result.code, 'TPLC1010', stage);
      assert.deepEqual(asRows(await db.collection('place_gazetteer').execute('$[*]')), [], stage);
      assert.equal(store.stats().writes, 0, stage); assert.equal(store.stats().transactions, 1, stage);
      failing = false;
      assert.deepEqual(placeValue(await store.loadGazetteer(document)), { writes: 3, replayed: false });
      assert.deepEqual(placeValue(await store.loadGazetteer(document)), { writes: 0, replayed: true });
      assert.equal((await db.integrityCheck()).ok, true);
    } finally { await db.close(); }
  }
});

it('detects missing, extra, modified and wrongly mirrored persisted rows on reads and replay', async () => {
  for (const tamper of ['missing-entry', 'missing-header', 'extra', 'payload', 'longitude', 'cell']) {
    const db = await openTangleDb();
    try {
      const document = await placeDocument(fixture.entries.slice(0, 2)), store = createPlaceDbStore(db);
      placeValue(await store.loadGazetteer(document));
      const collection = db.collection<Record<string, unknown>>('place_gazetteer');
      const rows = asRows(await collection.execute<Record<string, unknown>>('$[*]'));
      const row = rows.find(r => r.recordType === (tamper === 'missing-header' ? 'gazetteer' : 'entry'))!;
      if (tamper.startsWith('missing-')) await collection.delete(row.id as string);
      else if (tamper === 'extra') await collection.put({ ...row, id: 'unregistered-row' });
      else {
        if (tamper === 'longitude') row.lon = 0;
        if (tamper === 'cell') row.cell6 = 'u173zq';
        if (tamper === 'payload') (row.payload as { names: string[] }).names.push('unverified alias');
        await collection.put(row);
      }
      for (const result of [await store.loadGazetteer(document), await store.entries(document.id),
        await store.entriesInCells(document.id, ['u173zq'])]) {
        assert.equal(result.status === 'refused' && result.code, 'TPLC1001', tamper);
      }
      assert.equal(store.stats().writes, 3);
    } finally { await db.close(); }
  }
});

it('isolates delimiter-containing ids, serializes overlapping loads and supports empty sourced gazetteers', async () => {
  const db = await openTangleDb();
  try {
    const store = createPlaceDbStore(db), a = structuredClone(fixture.entries.slice(0, 1)), b = structuredClone(a);
    a[0].id = 'c'; b[0].id = 'b:c'; b[0].names = ['different entry'];
    const left = await placeDocument(a, 'a:b'), right = await placeDocument(b, 'a');
    const overlapping = await Promise.all([store.loadGazetteer(left), store.loadGazetteer(left)]);
    assert.deepEqual(overlapping.map(r => placeValue(r).writes).sort(), [0, 2]);
    placeValue(await store.loadGazetteer(right));
    assert.deepEqual(placeValue(await store.entries(left.id)), left.entries);
    assert.deepEqual(placeValue(await store.entries(right.id)), right.entries);
    const empty = await placeDocument([], 'empty');
    assert.equal(placeValue(await store.loadGazetteer(empty)).writes, 1);
    assert.deepEqual(placeValue(await store.entries(empty.id)), []);
    assert.equal(placeValue(await store.loadGazetteer(empty)).writes, 0);
  } finally { await db.close(); }
});

it('adds place persistence to an existing database without changing ordinary memory', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'place-additive-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'prior.db');
  const collections = Object.fromEntries(Object.entries(TANGLE_DB_MODEL.collections).filter(([name]) => name !== 'place_gazetteer'));
  const old = await openStore({ ...TANGLE_DB_MODEL, collections }, { driver: pickDriver(), path });
  const memory = createMemoryUnit({ text: 'Preserve existing memory', evidence: 'host', at: '2026-09-01T12:00:00Z' });
  await createDbMemoryStore(old.collection('memories')).put(memory); await old.close();
  const db = await openTangleDb({ path });
  try {
    assert.deepEqual(await createDbMemoryStore(db.collection('memories')).get(memory.id), memory);
    placeValue(await createPlaceDbStore(db).loadGazetteer(await placeDocument(fixture.entries.slice(0, 1))));
    assert.equal((await db.integrityCheck()).ok, true);
  } finally { await db.close(); }
});

it('returns valid refusal values for malformed content, empty host errors and closed database failures', async () => {
  const db = await openTangleDb(), store = createPlaceDbStore(db);
  for (const value of [null, 42, { id: 'missing-fields' }]) {
    const result = await store.loadGazetteer(value as unknown as Gazetteer);
    assert.equal(result.status === 'refused' && result.code, 'TPLC1001');
  }
  assert.equal(store.stats().transactions, 0);
  const failing = createPlaceDbStore(db, { applyProbe() { throw Error(''); } });
  const failure = await failing.loadGazetteer(await placeDocument(fixture.entries.slice(0, 1)));
  assert.equal(failure.status === 'refused' && failure.code, 'TPLC1010');
  assert.equal(validatePlaceShape('placeRefusal', failure).valid, true, 'an empty host exception must still produce a closed refusal');
  assert.equal(failing.stats().writes, 0);
  assert.deepEqual(asRows(await db.collection('place_gazetteer').execute('$[*]')), []);
  await db.close();
  for (const result of [await store.entries('closed'), await store.loadGazetteer(await placeDocument())]) {
    assert.equal(result.status === 'refused' && result.code, 'TPLC1010');
  }
  assert.equal(store.stats().writes, 0);
});
