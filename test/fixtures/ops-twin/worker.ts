/** The harness's worker: the browser runtime over the shared registry. */
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { startBrowserOps } from '../../../packages/ops/src/browser.ts';
import { DATABASE, POOL, TASKS, registry } from './shared.ts';

const query = new URL(self.location.href).searchParams;
startBrowserOps({
  scope: self, initialize: () => (sqlite3InitModule as any)({ print: () => {}, printErr: () => {} }),
  registry: registry(), channelName: query.get('channel')!, lockName: query.get('lock')!, tab: query.get('tab') ?? undefined,
  databaseName: DATABASE, pool: POOL, taskContract: TASKS, heartbeatMs: 1000,
  handlers: { read: async () => { await new Promise(r => setTimeout(r, 20)); } },
});
