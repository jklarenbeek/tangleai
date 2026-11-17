/**
 * The server side of the desktop's state, for an application whose desktop
 * keeps its state in the application's own database. The application serves
 * `tangle_os_state` (over HTTP to its desktop page, or from its framed page
 * over the port the desktop handed it) with {@link serveDesktopState}, over a
 * repository on its own storage: a table made from
 * {@link DESKTOP_STATE_MODEL} by `@jarenjs/db` (SQLite or PostgreSQL alike),
 * or any store that can compare and set one row.
 *
 * Who owns a document is the server's to say, from its own session: a
 * person's documents (`scope: person`) belong to the signed-in person, the
 * application's (`scope: application`) to the tenant, and the caller never
 * names an owner. Nothing here imports a database driver.
 */
import type { StateDocument, StateScope } from './state.ts';

export type { StateDocument, StateScope } from './state.ts';
/** Who is asking, as the server's session knows it. */
export type StateOwner = { person: string, application: string };
/** One kept row: the owner it belongs to (the person, or the application), and the document. */
export type StateRow = { owner: string, scope: StateScope, key: string, value: unknown, revision: number, updatedAt: string };
/**
 * The storage a server gives the desktop state. `swap` must compare and set
 * in one step (a transaction, or `UPDATE … WHERE revision = ?`): it stores the
 * document only when the kept revision is still `ifRevision` (0 when there is
 * none), deleting it for a null value, and answers the row it found otherwise.
 */
export type StateRepository = {
  list(owner: StateOwner): Promise<StateDocument[]>,
  swap(owner: StateOwner, document: { scope: StateScope, key: string, value: unknown }, ifRevision: number): Promise<{ revision: number } | { conflict: StateDocument }>,
};

/**
 * The table the documents live in, as a `@jarenjs/db` model document: one
 * collection keyed by `<owner>\u0000<scope>\u0000<key>`, read by owner.
 */
export const DESKTOP_STATE_MODEL = {
  $model: '0.1',
  collections: {
    desktop_state: {
      schema: {
        type: 'object', additionalProperties: false, required: ['id', 'owner', 'scope', 'key', 'value', 'revision', 'updatedAt'],
        properties: {
          id: { type: 'string', maxLength: 600 },
          owner: { type: 'string', maxLength: 200 },
          scope: { enum: ['person', 'application'] },
          key: { type: 'string', maxLength: 200 },
          value: {},
          revision: { type: 'integer', minimum: 1 },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      key: '/id',
      indexes: [{ name: 'by_owner', path: ['$.owner', '$.scope'] }],
    },
  },
} as const;

/** The row's id in {@link DESKTOP_STATE_MODEL}. */
export const stateRowId = (owner: string, scope: StateScope, key: string) => `${owner}\u0000${scope}\u0000${key}`;
/** Whose a document is: the person's id for `person`, the application's (tenant's) for `application`. */
export const ownerOf = (owner: StateOwner, scope: StateScope) => scope === 'person' ? `person:${owner.person}` : `application:${owner.application}`;

/** A repository in memory: for tests, and the shape a database repository follows. */
export function memoryStateRepository(now: () => string = () => new Date().toISOString()): StateRepository & { rows(): StateRow[] } {
  const rows = new Map<string, StateRow>();
  return {
    async list(owner) {
      return [...rows.values()]
        .filter(r => r.owner === ownerOf(owner, r.scope))
        .map(r => ({ scope: r.scope, key: r.key, value: structuredClone(r.value), revision: r.revision }));
    },
    async swap(owner, document, ifRevision) {
      const who = ownerOf(owner, document.scope), id = stateRowId(who, document.scope, document.key), current = rows.get(id);
      if ((current?.revision ?? 0) !== ifRevision) {
        return { conflict: current ? { scope: current.scope, key: current.key, value: structuredClone(current.value), revision: current.revision } : { ...document, value: null, revision: 0 } };
      }
      const revision = ifRevision + 1;
      if (document.value === null) rows.delete(id);
      else rows.set(id, { owner: who, scope: document.scope, key: document.key, value: structuredClone(document.value), revision, updatedAt: now() });
      return { revision };
    },
    rows: () => [...rows.values()].map(r => structuredClone(r)),
  };
}

/**
 * The `tangle_os_state` handlers over a repository. `owner` answers who is
 * signed in for a call (from the request's session); it throws to refuse a
 * caller that is not.
 */
export function serveDesktopState(repository: StateRepository, owner: (context?: unknown) => StateOwner) {
  return {
    'state.load': async (_input: unknown, context?: unknown) => ({ documents: await repository.list(owner(context)) }),
    'state.save': async ({ scope, key, value, ifRevision }: { scope: StateScope, key: string, value: unknown, ifRevision: number }, context?: unknown) =>
      repository.swap(owner(context), { scope, key, value }, ifRevision),
  };
}
