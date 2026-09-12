import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportBrowserData, importBrowserData, validateTransfer, TRANSFER_MEMBERS } from '../../apps/pages/src/demos/storage-transfer.ts';
import { createLedger } from '@tangleai/context';
import { createSlotLedgerStorage } from '@tangleai/context/storage/slot';
const slot = (initial: any = null) => { let data = structuredClone(initial), writes = 0; return { read: () => structuredClone(data), write: (value: any) => { data = structuredClone(value); writes++; }, count: () => writes, reliable: true }; };
const locks = { request: async (_name: string, fn: () => any) => fn() };
test('selected data round-trips without reminting IDs, metadata, counters, archives or a second write', async () => {
  const source = { transcript: slot({ messages: [{ role: 'user', content: 'Remember the receipt' }] }), ledger: slot(), game: slot('{"room":"wharf"}'), projects: slot({}), play: slot({}) };
  const storage = createSlotLedgerStorage(source.ledger, { locks });
  const ledger = createLedger({ storage });
  await ledger.setGoal({ objective: 'Retain the same receipt' });
  const memory = await ledger.addMemory({ text: 'The receiver works', evidence: 'scripted test' });
  assert.ok('id' in memory);
  await ledger.putSlot('archive-1', 'original bytes', { kind: 'agent-round', pinned: true });
  const bundle = exportBrowserData(source, TRANSFER_MEMBERS);
  const target = { transcript: slot(), ledger: slot(), game: slot(), projects: slot(), play: slot() };
  const first = await importBrowserData(bundle, target);
  const second = await importBrowserData(bundle, target);
  assert.deepEqual(second.written, []); assert.deepEqual(second.unchanged.sort(), first.written.sort());
  for (const key of first.written) { assert.equal(target[key].count(), 1); assert.deepEqual(target[key].read(), source[key].read()); }
  const restored = createLedger({ storage: createSlotLedgerStorage(target.ledger, { locks }) });
  assert.equal((await restored.getMemory(memory.id))?.id, memory.id);
  assert.equal(await restored.readSlot('archive-1'), 'original bytes');
  const next = await restored.addMemory({ text: 'Next receipt', evidence: 'after import' });
  assert.ok('id' in next); assert.notEqual(next.id, memory.id);
  await storage.close();
});
test('settings, credential fields and configured credentials cannot be exported or imported', () => {
  assert.throws(() => validateTransfer({ format: 'tangle-browser-data', version: 1, data: { settings: { apiKey: 'secret' } } }), /Unknown/);
  assert.throws(() => exportBrowserData({ transcript: slot({ messages: [{ apiKey: 'secret' }] }) }, ['transcript']), /private/);
  assert.throws(() => exportBrowserData({ transcript: slot({ messages: [{ content: 'pasted secret-value' }] }) }, ['transcript'], ['secret-value']), /credential/);
  assert.throws(() => validateTransfer({ format: 'tangle-browser-data', version: 1, data: { ledger: { 'foreign/key': {} } } }), /namespace/);
});
test('conflicts preflight every slot; failed writes are visible and a partial import can resume', async () => {
  const bundle = exportBrowserData({ transcript: slot({ messages: [{ content: 'kept' }] }), game: slot('save') }, ['transcript', 'game']);
  const transcript = slot(), game = slot('different');
  await assert.rejects(importBrowserData(bundle, { transcript, game }), /different data/); assert.equal(transcript.count(), 0);
  await assert.rejects(importBrowserData(bundle, { transcript, game: { read: () => null, write: () => false } }), /completed: transcript/);
  const resumed = await importBrowserData(bundle, { transcript, game: slot() });
  assert.deepEqual(resumed.unchanged, ['transcript']); assert.deepEqual(resumed.written, ['game']); assert.equal(transcript.count(), 1);
});
