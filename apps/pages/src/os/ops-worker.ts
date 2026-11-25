/**
 * The browser twin's worker, built as its own script (`os-ops-worker.js`):
 * the background work of the Pages desktop, run in a dedicated worker of an
 * open desktop tab, never the page. The tab whose worker holds the owner lock
 * runs the jobs and serves them to every tab; the others wait to take over.
 *
 * The registry (`ops-registry.json`) is a static document, so it cannot know
 * the person's time zone: before starting, the worker sets the registry's zone
 * to the browser's own (`Intl…resolvedOptions().timeZone`), which is what a
 * wall-clock job such as the daily 03:00 tidy runs in; a UTC rule is not
 * affected.
 */
import { startBrowserOps } from '@tangleai/ops/browser';
import type { JobRegistry } from '@tangleai/ops';
import { initializeSqlite } from '../demos/playground/sqlite.ts';
import registry from './ops-registry.json' with { type: 'json' };
import { DESKTOP_TASKS_CONTRACT, TWIN, localRegistry } from './ops-twin.ts';

const query = new URL(self.location.href).searchParams;
const zone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } })();
startBrowserOps({
  scope: self as any,
  initialize: () => initializeSqlite({ locateFile: (name: string) => new URL(name, import.meta.url).href, print: () => {}, printErr: () => {} }),
  registry: localRegistry(registry as JobRegistry, zone),
  channelName: TWIN.channel, lockName: TWIN.lock, databaseName: TWIN.database, pool: TWIN.pool,
  taskContract: DESKTOP_TASKS_CONTRACT, tab: query.get('tab') ?? undefined,
});
