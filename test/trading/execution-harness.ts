import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMemoryTradingStore } from '@tangleai/trading';
import type { TradingStoreOptions } from '@tangleai/trading';
import { openTangleDb, createTradingStore } from '@tangleai/store';

export async function openExecutionHarness(mode: 'memory' | 'sqlite-memory' | 'sqlite-file', options: TradingStoreOptions = {}) {
  if (mode === 'memory') return { store: createMemoryTradingStore(options), close: async () => {}, reopen: async () => {} };
  const directory = await mkdtemp(join(tmpdir(), 'trading-invariants-')), path = mode === 'sqlite-memory' ? ':memory:' : join(directory, 'state.db');
  let db = await openTangleDb({ path });
  const handle = { store: createTradingStore(db, options), async reopen() {
    if (mode === 'sqlite-file') { await db.close(); db = await openTangleDb({ path }); handle.store = createTradingStore(db, options); }
  }, async close() { await db.close(); await rm(directory, { recursive: true, force: true }); } };
  return handle;
}
