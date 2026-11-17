/**
 * The desktop's state: everything the desktop keeps for a person or for the
 * application (the dock, each application's settings values, the host's own
 * preferences) as keyed JSON documents in one store the host chooses. In a
 * browser-only page that is the browser's storage; in an application with a
 * server it is that server's database, through the `tangle_os_state`
 * contract, so a person's desktop follows them to another device. Secrets
 * never go here: a provider key stays with the host.
 *
 * Every document has a revision. A save names the revision it was made on and
 * is refused when the stored one moved (another tab, another device): the
 * desktop then takes the stored document, so nothing is overwritten unseen.
 */

/** Whose a document is: the signed-in person's, or the whole application's (decided by the server, never the caller). */
export type StateScope = 'person' | 'application';
export type StateDocument = { scope: StateScope, key: string, value: unknown, revision: number };
/**
 * Where a desktop keeps its state. `load` answers every document the
 * desktop may read; `save` stores one when its revision is still `ifRevision`
 * (0 for a document that does not exist yet) and answers the new revision, or
 * the stored document when it moved. A `value` of null deletes the document.
 */
export type DesktopStore = {
  load(): Promise<StateDocument[]>,
  save(document: { scope: StateScope, key: string, value: unknown }, ifRevision: number): Promise<{ revision: number } | { conflict: StateDocument }>,
};

const KEY = { type: 'string', pattern: '^[A-Za-z0-9._:/-]{1,200}$' };
const SCOPE = { enum: ['person', 'application'] };
const DOCUMENT = {
  type: 'object', additionalProperties: false, required: ['scope', 'key', 'value', 'revision'],
  properties: { scope: SCOPE, key: KEY, value: {}, revision: { type: 'integer', minimum: 0 } },
};

/** `tangle_os_state`: the desktop's state, served by the host's backend (or by the application that is signed in). */
export const STATE_CONTRACT = {
  $contract: '0.1',
  id: 'tangle_os_state',
  operations: {
    'state.load': {
      kind: 'read',
      doc: 'Every desktop document the signed-in person may read: their own (scope person) and the application\'s (scope application).',
      input: { type: 'object', additionalProperties: false, properties: {} },
      output: { type: 'object', required: ['documents'], properties: { documents: { type: 'array', maxItems: 2000, items: DOCUMENT } } },
    },
    'state.save': {
      kind: 'command',
      doc: 'Store one document if its stored revision is still ifRevision (0 when it does not exist); null deletes it. Answers the new revision, or the stored document when it moved.',
      input: {
        type: 'object', additionalProperties: false, required: ['scope', 'key', 'value', 'ifRevision'],
        properties: { scope: SCOPE, key: KEY, value: {}, ifRevision: { type: 'integer', minimum: 0 } },
      },
      output: { type: 'object', properties: { revision: { type: 'integer' }, conflict: DOCUMENT } },
    },
  },
} as const;

/** A store that lives as long as the page: the default, and the shape of a test double. */
export function memoryStore(initial: StateDocument[] = []): DesktopStore & { documents(): StateDocument[] } {
  const docs = new Map(initial.map(d => [`${d.scope}\u0000${d.key}`, structuredClone(d)]));
  return {
    async load() { return [...docs.values()].map(d => structuredClone(d)); },
    async save(document, ifRevision) {
      const id = `${document.scope}\u0000${document.key}`, current = docs.get(id);
      if ((current?.revision ?? 0) !== ifRevision) return { conflict: structuredClone(current ?? { ...document, value: null, revision: 0 }) };
      const revision = ifRevision + 1;
      if (document.value === null) docs.delete(id);
      else docs.set(id, { scope: document.scope, key: document.key, value: structuredClone(document.value), revision });
      return { revision };
    },
    documents: () => [...docs.values()].map(d => structuredClone(d)),
  };
}

/**
 * A browser's storage as the store (one entry per document under `prefix`):
 * for a page with no server of its own. Other tabs of the same page share it.
 */
export function webStorageStore(storage: { getItem(key: string): string | null, setItem(key: string, value: string): void, removeItem(key: string): void, key(index: number): string | null, readonly length: number }, prefix = 'tangle-os-state'): DesktopStore {
  const slot = (scope: StateScope, key: string) => `${prefix}:${scope}:${key}`;
  const read = (name: string): StateDocument | null => { try { const v = JSON.parse(storage.getItem(name) ?? 'null'); return v && typeof v.revision === 'number' ? v : null; } catch { return null; } };
  return {
    async load() {
      const out: StateDocument[] = [];
      for (let i = 0; i < storage.length; i++) { const name = storage.key(i); if (name?.startsWith(`${prefix}:`)) { const d = read(name); if (d) out.push(d); } }
      return out;
    },
    async save(document, ifRevision) {
      const name = slot(document.scope, document.key), current = read(name);
      if ((current?.revision ?? 0) !== ifRevision) return { conflict: current ?? { ...document, value: null, revision: 0 } };
      const revision = ifRevision + 1;
      if (document.value === null) storage.removeItem(name);
      else storage.setItem(name, JSON.stringify({ scope: document.scope, key: document.key, value: document.value, revision }));
      return { revision };
    },
  };
}

/** The store as a `tangle_os_state` client: over HTTP to the host's server, or over a port to the application that serves it. */
export function contractStore(client: { invoke(op: string, input: unknown): Promise<any> }): DesktopStore {
  const value = (outcome: any, op: string) => {
    if (outcome?.ok === false) throw Object.assign(new Error(outcome.error?.message ?? `${op} failed`), { code: outcome.error?.code });
    return outcome?.ok === true ? outcome.value : outcome;
  };
  return {
    async load() { return value(await client.invoke('state.load', {}), 'state.load').documents; },
    async save(document, ifRevision) {
      const answer = value(await client.invoke('state.save', { ...document, ifRevision }), 'state.save');
      return answer.conflict ? { conflict: answer.conflict } : { revision: answer.revision };
    },
  };
}
