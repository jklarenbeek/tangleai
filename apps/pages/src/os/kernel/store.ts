/**
 * The OS's own database: `os.model.json` opened by `@jarenjs/db` over
 * whatever SQLite driver the host hands in — sqlite-wasm on OPFS in the
 * browser's worker (`db-worker.ts`), `node:sqlite` in the tests — and
 * served through `store.contract.json`, so the page reaches it exactly
 * as it reaches every other operation: validated JSON across a port.
 *
 * Three collections, each a document the user would want back:
 *
 *   - `artworks`     — kept artworks: tape, heads, program, merits;
 *   - `constitution` — every amendment and how it ended;
 *   - `sessions`     — the running OS, saved as it goes, so a reload (or
 *                      an offline cold start) picks up where it stopped.
 *
 * `createMemoryStore` answers the same handlers from plain maps, for a
 * browser that cannot start the worker at all; it says so in its mode.
 */

import { openStore } from '@jarenjs/db';
import { JarenValidator } from '@jarenjs/validate';
import model from '../documents/os.model.json' with { type: 'json' };

/** The newest kept artworks the gallery lists. */
const LIST_LIMIT = 48;

/** The query the gallery list runs: newest first, summaries only. */
const LIST_QUERY = [{
  $for: { a: '$[*]' },
  $orderby: { $key: '$a.at', $dir: 'desc' },
  $return: { id: '$a.id', title: '$a.title', at: '$a.at', harmony: '$a.harmony', tick: '$a.tick' },
}];

/** The constitution, oldest session first. */
const AMENDMENTS_QUERY = [{
  $for: { a: '$[*]' },
  $orderby: [{ $key: '$a.session' }, '$a.id'],
  $return: '$a',
}];

/** The store contract's operations, as handlers. */
export type StoreHandlers = Record<string, (input?: any) => any>;

/** Open the OS database. */
export async function openOsStore(options: { driver: any, path?: string, mode?: string, detail?: string }) {
  const validator = new JarenValidator({ collectErrors: true });
  const store: any = await openStore(model as any, {
    driver: options.driver,
    path: options.path ?? ':memory:',
    compileSchema: (schema: any) => validator.compile(schema),
  } as any);
  return { store, handlers: storeHandlers(store, options.mode ?? 'sqlite', options.detail ?? '') };
}

/** The store contract's handlers over an open `@jarenjs/db` store. */
export function storeHandlers(store: any, mode: string, detail: string): StoreHandlers {
  const artworks = store.collection('artworks');
  const constitution = store.collection('constitution');
  const sessions = store.collection('sessions');
  return {
    'store.info': () => ({ mode, detail }),
    'artwork.put': async (input: any) => ({ id: String(await artworks.put(input.artwork)) }),
    'artwork.list': async () => asList(await artworks.execute(LIST_QUERY)).slice(0, LIST_LIMIT),
    'artwork.get': async (input: any) => (await artworks.get(input.id)) ?? null,
    'amendment.put': async (input: any) => ({ id: String(await constitution.put(input.amendment)) }),
    'amendment.list': async () => asList(await constitution.execute(AMENDMENTS_QUERY)),
    'session.put': async (input: any) => {
      const at = new Date().toISOString();
      await sessions.put({ id: 'current', at, state: input.state });
      return { at };
    },
    'session.get': async () => (await sessions.get('current')) ?? null,
  };
}

/** A query result as a list, whatever its cardinality (the engine answers
 * a single row as the row itself). */
function asList(value: any): any[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * The same handlers over plain maps — the last resort when no worker
 * starts. Nothing survives a reload, and the mode says so.
 */
export function createMemoryStore(): StoreHandlers {
  const artworks = new Map<string, any>();
  const amendments = new Map<string, any>();
  let session: any = null;
  return {
    'store.info': () => ({ mode: 'memory', detail: 'this browser could not start the database worker; nothing is kept after a reload' }),
    'artwork.put': (input: any) => { artworks.set(input.artwork.id, structuredClone(input.artwork)); return { id: input.artwork.id }; },
    'artwork.list': () => [...artworks.values()]
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
      .slice(0, LIST_LIMIT)
      .map((a) => ({ id: a.id, title: a.title, at: a.at, harmony: a.harmony, tick: a.tick })),
    'artwork.get': (input: any) => artworks.get(input.id) ?? null,
    'amendment.put': (input: any) => { amendments.set(input.amendment.id, structuredClone(input.amendment)); return { id: input.amendment.id }; },
    'amendment.list': () => [...amendments.values()].sort((a, b) => a.session - b.session),
    'session.put': (input: any) => { const at = new Date().toISOString(); session = { id: 'current', at, state: structuredClone(input.state) }; return { at }; },
    'session.get': () => session,
  };
}
