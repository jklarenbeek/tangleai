//@ts-check
/** Private SQLite initializer and the established Jaren storage identity. */
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { createBrowserDataWorker } from '@jarenjs/studio/data/host';
import { createJsltRegistry, mathPack, financePack, statsPack } from '@jarenjs/json/jslt';
createBrowserDataWorker({
  initialize: () => sqlite3InitModule({ locateFile: name => new URL(name, import.meta.url).href, print: () => {}, printErr: () => {} }),
  scope: globalThis, createChannel: name => new BroadcastChannel(name),
  identity: { channel: 'tangle-data-studio', pool: 'tangle-data', database: '/tangle-data-studio.db',
    snapshots: 'tangle-data-studio-snapshots', lock: 'tangle-data-studio-owner' },
  operators: createJsltRegistry().use(mathPack).use(financePack).use(statsPack),
});
