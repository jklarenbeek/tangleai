/**
 * File locations: where the desktop's Files finds documents and images. A
 * location is a contract an application serves (its own files, from its own
 * storage), built from one template, {@link fileLocationContract}, so every
 * location answers the same operations: list a folder (paged), search, read
 * one file, and, when it is `writable`, write, make a folder, move or rename,
 * and delete. Entries have opaque ids and a parent, never paths, so a
 * location whose files are rows (a document per person) serves them as they
 * are. A read answers the bytes inline (base64, at most 10 MB) or an https
 * address the location signed for a short while.
 *
 * A module says which contract is its location in its manifest
 * (`files: { contract, title }`). The desktop's Files calls it as the
 * person's own hand; the assistant reaches locations only through the
 * kernel's `tangle_os_files` contract, which reads and searches but never
 * writes, and never a location marked `assistant: false`.
 */

/** One file or folder in a location. */
export type FileEntry = {
  id: string, parent: string | null, name: string, kind: 'file' | 'folder',
  type?: string, size?: number, modified?: string,
};
/** A file's contents: inline bytes (base64) or an https address that serves them. */
export type FileContent = { entry: FileEntry, data?: string, url?: string };
export type FileLocationHandlers = {
  'files.info': () => { writable: boolean } | Promise<{ writable: boolean }>,
  'files.list': (input: { folder?: string | null, cursor?: string, limit?: number }) => { entries: FileEntry[], cursor?: string } | Promise<{ entries: FileEntry[], cursor?: string }>,
  'files.search': (input: { query: string, cursor?: string, limit?: number }) => { entries: FileEntry[], cursor?: string } | Promise<{ entries: FileEntry[], cursor?: string }>,
  'files.read': (input: { id: string }) => FileContent | Promise<FileContent>,
  'files.write'?: (input: { folder?: string | null, name: string, data: string, type?: string, replace?: string }) => { entry: FileEntry } | Promise<{ entry: FileEntry }>,
  'files.mkdir'?: (input: { folder?: string | null, name: string }) => { entry: FileEntry } | Promise<{ entry: FileEntry }>,
  'files.move'?: (input: { id: string, folder?: string | null, name?: string }) => { entry: FileEntry } | Promise<{ entry: FileEntry }>,
  'files.delete'?: (input: { id: string }) => Record<string, never> | Promise<Record<string, never>>,
};

/** The most a read answers inline: 10 MB, as base64. */
export const MAX_INLINE_BYTES = 10 * 1024 * 1024;
const ID = { type: 'string', minLength: 1, maxLength: 1024 };
const NAME = { type: 'string', minLength: 1, maxLength: 255, pattern: '^[^/\\\\\\u0000]+$' };
const FOLDER = { anyOf: [ID, { type: 'null' }] };
const PAGE = { cursor: { type: 'string', maxLength: 1024 }, limit: { type: 'integer', minimum: 1, maximum: 500 } };
export const FILE_ENTRY_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['id', 'parent', 'name', 'kind'],
  properties: {
    id: ID, parent: FOLDER, name: NAME, kind: { enum: ['file', 'folder'] },
    type: { type: 'string', maxLength: 255 }, size: { type: 'integer', minimum: 0 }, modified: { type: 'string', maxLength: 40 },
  },
} as const;
/** A location's refusal travels as the answer, so its code and reason reach the person (a thrown error would not). */
const REFUSED = { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string', maxLength: 16 }, message: { type: 'string', maxLength: 400 } } };
const ENTRIES = { type: 'object', properties: { entries: { type: 'array', maxItems: 500, items: FILE_ENTRY_SCHEMA }, cursor: { type: 'string', maxLength: 1024 }, refused: REFUSED } };
const ONE = { type: 'object', properties: { entry: FILE_ENTRY_SCHEMA, refused: REFUSED } };

/** A location's contract, under the id its module serves it as. */
export function fileLocationContract(id: string) {
  return {
    $contract: '0.1',
    id,
    operations: {
      'files.info': { kind: 'read', doc: 'Whether this location can be written.', input: { type: 'object', additionalProperties: false, properties: {} }, output: { type: 'object', properties: { writable: { type: 'boolean' }, refused: REFUSED } } },
      'files.list': { kind: 'read', doc: 'The files and folders in a folder (null for the top), a page at a time.', input: { type: 'object', additionalProperties: false, properties: { folder: FOLDER, ...PAGE } }, output: ENTRIES },
      'files.search': { kind: 'read', doc: 'Files and folders whose name contains the query, a page at a time.', input: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string', minLength: 1, maxLength: 200 }, ...PAGE } }, output: ENTRIES },
      'files.read': {
        kind: 'read', doc: 'One file: its bytes inline (base64, at most 10 MB) or an https address that serves them.',
        input: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: ID } },
        output: { type: 'object', properties: { entry: FILE_ENTRY_SCHEMA, data: { type: 'string', maxLength: Math.ceil(MAX_INLINE_BYTES / 3) * 4 }, url: { type: 'string', maxLength: 4096, pattern: '^https://|^http://(localhost|127\\.0\\.0\\.1)(:|/)' }, refused: REFUSED } },
      },
      'files.write': {
        kind: 'command', doc: 'Write a file into a folder (null for the top), or replace an existing one.',
        input: { type: 'object', additionalProperties: false, required: ['name', 'data'], properties: { folder: FOLDER, name: NAME, data: { type: 'string', maxLength: Math.ceil(MAX_INLINE_BYTES / 3) * 4 }, type: { type: 'string', maxLength: 255 }, replace: ID } },
        output: ONE,
      },
      'files.mkdir': { kind: 'command', doc: 'Make a folder.', input: { type: 'object', additionalProperties: false, required: ['name'], properties: { folder: FOLDER, name: NAME } }, output: ONE },
      'files.move': { kind: 'command', doc: 'Move a file or folder into another folder, rename it, or both.', input: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: ID, folder: FOLDER, name: NAME } }, output: ONE },
      'files.delete': { kind: 'command', doc: 'Delete a file, or a folder with everything in it.', input: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: ID } }, output: { type: 'object', properties: { refused: REFUSED } } },
    },
  } as const;
}

/** A file's type from its name, for a location that does not keep one. */
export function typeOfName(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return ({
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml',
    pdf: 'application/pdf', md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain', csv: 'text/csv', json: 'application/json',
    html: 'text/html', htm: 'text/html', js: 'text/javascript', ts: 'text/plain', css: 'text/css', xml: 'application/xml', ics: 'text/calendar',
  } as Record<string, string>)[ext] ?? 'application/octet-stream';
}

const toBase64 = (bytes: Uint8Array) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const fromBase64 = (text: string) => Uint8Array.from(atob(text), c => c.charCodeAt(0));
const page = <T>(all: T[], cursor?: string, limit = 200) => {
  const start = cursor ? Math.max(0, Number(cursor) || 0) : 0;
  const entries = all.slice(start, start + limit);
  return { entries, ...(start + limit < all.length ? { cursor: String(start + limit) } : {}) };
};
const byName = (a: FileEntry, b: FileEntry) => a.kind !== b.kind ? (a.kind === 'folder' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
const fail = (code: string, message: string) => Object.assign(new Error(`${code}: ${message}`), { code });

/** A location in memory: for tests, and the reference every location answers like. */
export function memoryLocation(options: { writable?: boolean, now?: () => string } = {}): FileLocationHandlers {
  const now = options.now ?? (() => new Date().toISOString());
  const entries = new Map<string, FileEntry>();
  const bytes = new Map<string, Uint8Array>();
  let seq = 0;
  const children = (folder: string | null) => [...entries.values()].filter(e => e.parent === folder).sort(byName);
  const taken = (folder: string | null, name: string, except?: string) => children(folder).some(e => e.name === name && e.id !== except);
  const folderOf = (folder: string | null | undefined) => {
    const id = folder ?? null;
    if (id !== null && entries.get(id)?.kind !== 'folder') throw fail('OS0601', `no folder '${id}'`);
    return id;
  };
  const writable = () => { if (!options.writable) throw fail('OS0602', 'this location cannot be written'); };
  const handlers: FileLocationHandlers = {
    'files.info': () => ({ writable: options.writable === true }),
    'files.list': ({ folder, cursor, limit }) => page(children(folderOf(folder)), cursor, limit),
    'files.search': ({ query, cursor, limit }) => page([...entries.values()].filter(e => e.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort(byName), cursor, limit),
    'files.read': ({ id }) => {
      const entry = entries.get(id);
      if (!entry || entry.kind !== 'file') throw fail('OS0601', `no file '${id}'`);
      return { entry, data: toBase64(bytes.get(id) ?? new Uint8Array()) };
    },
    'files.write': ({ folder, name, data, type, replace }) => {
      writable();
      const parent = folderOf(folder);
      const body = fromBase64(data);
      if (body.length > MAX_INLINE_BYTES) throw fail('OS0603', 'a file of more than 10 MB');
      const existing = replace ? entries.get(replace) : undefined;
      if (replace && existing?.kind !== 'file') throw fail('OS0601', `no file '${replace}'`);
      if (taken(parent, name, existing?.id)) throw fail('OS0604', `'${name}' is already there`);
      const entry: FileEntry = { id: existing?.id ?? `f${++seq}`, parent, name, kind: 'file', type: type ?? typeOfName(name), size: body.length, modified: now() };
      entries.set(entry.id, entry); bytes.set(entry.id, body);
      return { entry };
    },
    'files.mkdir': ({ folder, name }) => {
      writable();
      const parent = folderOf(folder);
      if (taken(parent, name)) throw fail('OS0604', `'${name}' is already there`);
      const entry: FileEntry = { id: `d${++seq}`, parent, name, kind: 'folder', modified: now() };
      entries.set(entry.id, entry);
      return { entry };
    },
    'files.move': ({ id, folder, name }) => {
      writable();
      const entry = entries.get(id);
      if (!entry) throw fail('OS0601', `no entry '${id}'`);
      const parent = folder === undefined ? entry.parent : folderOf(folder);
      for (let at = parent; at !== null; at = entries.get(at)?.parent ?? null) if (at === id) throw fail('OS0605', 'a folder cannot go inside itself');
      const next = { ...entry, parent, name: name ?? entry.name, modified: now() };
      if (taken(next.parent, next.name, id)) throw fail('OS0604', `'${next.name}' is already there`);
      entries.set(id, next);
      return { entry: next };
    },
    'files.delete': ({ id }) => {
      writable();
      if (!entries.has(id)) throw fail('OS0601', `no entry '${id}'`);
      const gone = (at: string) => { for (const child of children(at)) gone(child.id); entries.delete(at); bytes.delete(at); };
      gone(id);
      return {};
    },
  };
  return handlers;
}

/**
 * "This browser": a folder of the browser's own private file system (OPFS)
 * as a location. The host passes the directory it gives the person, never the
 * file system's root, which holds the host's own databases. Ids are paths
 * inside that directory, opaque to everyone else.
 */
export function browserLocation(root: FileSystemDirectoryHandle | Promise<FileSystemDirectoryHandle>): FileLocationHandlers {
  const top = Promise.resolve(root);
  const split = (id: string | null | undefined) => (id ? id.split('/').filter(Boolean) : []);
  const join = (parts: string[]) => parts.join('/');
  async function dir(parts: string[], create = false): Promise<FileSystemDirectoryHandle> {
    let at = await top;
    for (const part of parts) {
      try { at = await at.getDirectoryHandle(part, { create }); }
      catch { throw fail('OS0601', `no folder '${join(parts)}'`); }
    }
    return at;
  }
  async function entryOf(parts: string[], handle: FileSystemHandle): Promise<FileEntry> {
    const parent = parts.length > 1 ? join(parts.slice(0, -1)) : null;
    if (handle.kind === 'directory') return { id: join(parts), parent, name: handle.name, kind: 'folder' };
    const file = await (handle as FileSystemFileHandle).getFile();
    return { id: join(parts), parent, name: handle.name, kind: 'file', type: file.type || typeOfName(handle.name), size: file.size, modified: new Date(file.lastModified).toISOString() };
  }
  async function listOf(parts: string[]) {
    const out: FileEntry[] = [];
    for await (const handle of (await dir(parts) as any).values() as AsyncIterable<FileSystemHandle>) out.push(await entryOf([...parts, handle.name], handle));
    return out.sort(byName);
  }
  async function walk(parts: string[], visit: (entry: FileEntry) => void) {
    for (const entry of await listOf(parts)) { visit(entry); if (entry.kind === 'folder') await walk(split(entry.id), visit); }
  }
  async function fileHandle(id: string) {
    const parts = split(id);
    try { return await (await dir(parts.slice(0, -1))).getFileHandle(parts.at(-1)!); }
    catch { throw fail('OS0601', `no file '${id}'`); }
  }
  async function exists(parent: FileSystemDirectoryHandle, name: string) {
    for await (const key of (parent as any).keys() as AsyncIterable<string>) if (key === name) return true;
    return false;
  }
  async function writeFile(parent: FileSystemDirectoryHandle, name: string, body: Uint8Array) {
    const handle = await parent.getFileHandle(name, { create: true });
    const writer = await (handle as any).createWritable();
    await writer.write(body); await writer.close();
  }
  async function copy(from: FileSystemHandle, into: FileSystemDirectoryHandle, name: string) {
    if (from.kind === 'file') { await writeFile(into, name, new Uint8Array(await (await (from as FileSystemFileHandle).getFile()).arrayBuffer())); return; }
    const target = await into.getDirectoryHandle(name, { create: true });
    for await (const child of (from as any).values() as AsyncIterable<FileSystemHandle>) await copy(child, target, child.name);
  }
  return {
    'files.info': () => ({ writable: true }),
    'files.list': async ({ folder, cursor, limit }) => page(await listOf(split(folder)), cursor, limit),
    'files.search': async ({ query, cursor, limit }) => {
      const found: FileEntry[] = [], q = query.toLocaleLowerCase();
      await walk([], e => { if (e.name.toLocaleLowerCase().includes(q)) found.push(e); });
      return page(found.sort(byName), cursor, limit);
    },
    'files.read': async ({ id }) => {
      const handle = await fileHandle(id);
      const file = await handle.getFile();
      if (file.size > MAX_INLINE_BYTES) throw fail('OS0603', 'a file of more than 10 MB');
      return { entry: await entryOf(split(id), handle), data: toBase64(new Uint8Array(await file.arrayBuffer())) };
    },
    'files.write': async ({ folder, name, data, replace }) => {
      const body = fromBase64(data);
      if (body.length > MAX_INLINE_BYTES) throw fail('OS0603', 'a file of more than 10 MB');
      const parts = split(folder), parent = await dir(parts);
      if (replace) { const old = split(replace); if (old.at(-1) !== name || join(old.slice(0, -1)) !== join(parts)) await (await dir(old.slice(0, -1))).removeEntry(old.at(-1)!); }
      else if (await exists(parent, name)) throw fail('OS0604', `'${name}' is already there`);
      await writeFile(parent, name, body);
      return { entry: await entryOf([...parts, name], await parent.getFileHandle(name)) };
    },
    'files.mkdir': async ({ folder, name }) => {
      const parts = split(folder), parent = await dir(parts);
      if (await exists(parent, name)) throw fail('OS0604', `'${name}' is already there`);
      return { entry: await entryOf([...parts, name], await parent.getDirectoryHandle(name, { create: true })) };
    },
    // a move is a copy and a delete: the file system's own move is not in every browser
    'files.move': async ({ id, folder, name }) => {
      const parts = split(id), from = await dir(parts.slice(0, -1)), old = parts.at(-1)!;
      const handle = await from.getDirectoryHandle(old).catch(() => from.getFileHandle(old)).catch(() => { throw fail('OS0601', `no entry '${id}'`); });
      const target = folder === undefined ? parts.slice(0, -1) : split(folder);
      const into_ = join(target);
      if (handle.kind === 'directory' && (into_ === id || into_.startsWith(`${id}/`))) throw fail('OS0605', 'a folder cannot go inside itself');
      const into = await dir(target), newName = name ?? old;
      if (join([...target, newName]) === id) return { entry: await entryOf(parts, handle) };
      if (await exists(into, newName)) throw fail('OS0604', `'${newName}' is already there`);
      await copy(handle, into, newName);
      await from.removeEntry(old, { recursive: true });
      const moved = handle.kind === 'directory' ? await into.getDirectoryHandle(newName) : await into.getFileHandle(newName);
      return { entry: await entryOf([...target, newName], moved) };
    },
    'files.delete': async ({ id }) => {
      const parts = split(id);
      try { await (await dir(parts.slice(0, -1))).removeEntry(parts.at(-1)!, { recursive: true }); }
      catch { throw fail('OS0601', `no entry '${id}'`); }
      return {};
    },
  };
}

/**
 * A location's handlers as a contract serves them: a refusal it throws
 * (`OS06xx`, or any error) is answered as `{ refused: { code, message } }`,
 * so the person reads why. Serve every location through this.
 */
export function serveFileLocation(handlers: FileLocationHandlers): Record<string, (input: any) => Promise<unknown>> {
  const out: Record<string, (input: any) => Promise<unknown>> = {};
  // a read-only location still answers every operation: the ones it has not are refused
  for (const op of ['files.write', 'files.mkdir', 'files.move', 'files.delete'] as const)
    if (!handlers[op]) out[op] = async () => ({ refused: { code: 'OS0602', message: 'this location cannot be written' } });
  for (const [op, handler] of Object.entries(handlers)) if (handler) out[op] = async (input: any) => {
    try { return await (handler as (input: any) => unknown)(input ?? {}); }
    catch (error: any) {
      const message = String(error?.message ?? error).replace(/^OS\d{4}: /, '').slice(0, 400);
      return { refused: { code: typeof error?.code === 'string' ? error.code.slice(0, 16) : 'OS0600', message } };
    }
  };
  return out;
}

/** A location's answer, or the refusal it carried (thrown with its code). */
export function fileAnswer<T>(outcome: { ok: boolean, value?: any, error?: { code: string, message: string } }): T {
  if (!outcome.ok) throw Object.assign(new Error(outcome.error?.message ?? 'the location did not answer'), { code: outcome.error?.code });
  if (outcome.value?.refused) throw Object.assign(new Error(outcome.value.refused.message), { code: outcome.value.refused.code });
  return outcome.value as T;
}

export { toBase64 as fileBytesToBase64, fromBase64 as fileBase64ToBytes };
