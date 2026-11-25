/**
 * The desktop's background runtime, in its own worker thread (started by
 * `superviseOps` in `main.ts`): it imports the host module the app was started
 * with (`--ops <module>`), which exports `{ registry, handlers?, contracts? }`,
 * and runs that registry over the runtime's own store (`ops.db` beside the
 * desktop's database). A registry that does not check is refused here: the
 * worker reports it and ends, and the desktop keeps serving its own queue.
 */
import { workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { checkRegistry } from '@tangleai/ops/registry';
import { runOpsWorker } from '@tangleai/ops/supervisor';

const { module: modulePath, storePath } = workerData as { module: string, storePath: string };
const host: any = await import(pathToFileURL(modulePath).href);
const checked = checkRegistry(host.registry);
if (!checked.ok) throw new Error(`the host module's registry is refused: ${checked.problems.map(p => `${p.pointer || '/'} ${p.message}`).join('; ').slice(0, 800)}`);
await runOpsWorker({ storePath, registry: checked.registry, ...(host.handlers ? { handlers: host.handlers } : {}), ...(host.contracts ? { contracts: host.contracts } : {}) });
