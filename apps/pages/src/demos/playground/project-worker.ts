/** Private SQLite initializer for an isolated project-model worker. */
import { initializeSqlite } from './sqlite.ts';
import { createProjectDataWorker } from '@jarenjs/studio/data/host';
import { createJsltRegistry, mathPack, financePack, statsPack } from '@jarenjs/json/jslt';
createProjectDataWorker({
  initialize: () => initializeSqlite({ locateFile: (name: any) => new URL(name, import.meta.url).href, print: () => { }, printErr: () => { } }), scope: globalThis,
  operators: createJsltRegistry().use(mathPack).use(financePack).use(statsPack),
});
