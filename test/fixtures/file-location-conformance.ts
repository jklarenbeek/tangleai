/**
 * What every file location answers alike, run against the memory location in
 * Node and against "This browser" (OPFS) in real browsers: the same steps,
 * the same answers. Plain code with no test runner, so a page can run it; a
 * failed step throws with its name.
 */
import { serveFileLocation, fileAnswer, fileBytesToBase64, fileBase64ToBytes, type FileLocationHandlers, type FileEntry } from '../../components/os/src/files.ts';

export async function conformLocation(handlers: FileLocationHandlers): Promise<string[]> {
  const served = serveFileLocation(handlers);
  const call = async <T>(op: string, input: unknown = {}): Promise<T> => fileAnswer<T>({ ok: true, value: await served[op](input) });
  const refusal = async (op: string, input: unknown) => { try { await call(op, input); return 'none'; } catch (error: any) { return error.code; } };
  const steps: string[] = [];
  const check = (name: string, ok: boolean, detail = '') => { if (!ok) throw new Error(`${name}${detail ? `: ${detail}` : ''}`); steps.push(name); };
  const names = (entries: FileEntry[]) => entries.map(e => `${e.kind === 'folder' ? '/' : ''}${e.name}`);
  const text = (s: string) => fileBytesToBase64(new TextEncoder().encode(s));

  check('writable', (await call<{ writable: boolean }>('files.info')).writable === true);
  check('an empty top', (await call<{ entries: FileEntry[] }>('files.list', { folder: null })).entries.length === 0);
  const docs = (await call<{ entry: FileEntry }>('files.mkdir', { folder: null, name: 'Docs' })).entry;
  const note = (await call<{ entry: FileEntry }>('files.write', { folder: docs.id, name: 'note.md', data: text('# Hi\n') })).entry;
  await call('files.write', { folder: null, name: 'b.txt', data: text('b') });
  await call('files.write', { folder: null, name: 'a.txt', data: text('a') });
  check('folders first, then names', JSON.stringify(names((await call<{ entries: FileEntry[] }>('files.list', { folder: null })).entries)) === '["/Docs","a.txt","b.txt"]');
  check('a file knows its parent, type and size', note.parent === docs.id && note.type === 'text/markdown' && note.size === 5, JSON.stringify(note));
  const read = await call<{ entry: FileEntry, data: string }>('files.read', { id: note.id });
  check('reads its bytes back', new TextDecoder().decode(fileBase64ToBytes(read.data)) === '# Hi\n');
  check('a name taken is refused', await refusal('files.write', { folder: null, name: 'a.txt', data: text('x') }) === 'OS0604');
  check('a missing file is refused', await refusal('files.read', { id: 'nothing-here' }) === 'OS0601');
  const replaced = (await call<{ entry: FileEntry }>('files.write', { folder: docs.id, name: 'note.md', data: text('# Hello\n'), replace: note.id })).entry;
  check('replacing keeps the name', replaced.name === 'note.md' && replaced.size === 8);
  const renamed = (await call<{ entry: FileEntry }>('files.move', { id: replaced.id, name: 'readme.md' })).entry;
  check('renames in place', renamed.name === 'readme.md' && renamed.parent === docs.id);
  const moved = (await call<{ entry: FileEntry }>('files.move', { id: renamed.id, folder: null })).entry;
  check('moves to the top', moved.parent === null && JSON.stringify(names((await call<{ entries: FileEntry[] }>('files.list', { folder: docs.id })).entries)) === '[]');
  const inner = (await call<{ entry: FileEntry }>('files.mkdir', { folder: docs.id, name: 'Inner' })).entry;
  check('a folder cannot go inside itself', await refusal('files.move', { id: docs.id, folder: inner.id }) === 'OS0605');
  const found = await call<{ entries: FileEntry[] }>('files.search', { query: 'README' });
  check('search ignores case', JSON.stringify(names(found.entries)) === '["readme.md"]');
  const paged = await call<{ entries: FileEntry[], cursor?: string }>('files.list', { folder: null, limit: 2 });
  const rest = await call<{ entries: FileEntry[], cursor?: string }>('files.list', { folder: null, limit: 2, cursor: paged.cursor });
  check('pages', paged.entries.length === 2 && !!paged.cursor && JSON.stringify(names([...paged.entries, ...rest.entries])) === '["/Docs","a.txt","b.txt","readme.md"]');
  await call('files.delete', { id: docs.id });
  check('deletes a folder with what is in it', JSON.stringify(names((await call<{ entries: FileEntry[] }>('files.list', { folder: null })).entries)) === '["a.txt","b.txt","readme.md"]');
  for (const e of (await call<{ entries: FileEntry[] }>('files.list', { folder: null })).entries) await call('files.delete', { id: e.id });
  return steps;
}
