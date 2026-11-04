/**
 * A replay cache over a directory: one JSON file per remembered reply,
 * behind the `cache` seam both wire clients take. A test or an evaluation
 * harness commits the directory and replays it offline; a live run fills
 * it as it buys.
 *
 * The file name is the SHA-256 of the key (a fixed-width id for a key that
 * is a whole conversation long), and the key is kept inside the file, so
 * nothing is ever answered by a hash alone: a file whose recorded key
 * differs is a miss, never someone else's answer. A file is written whole
 * under a temporary name and then renamed, so an interrupted run leaves no
 * half file. A file that does not read as an entry fails the call — the
 * seam fails closed.
 *
 * Modes: `record` (the default) answers what it holds and remembers what
 * is bought; `fresh` answers nothing and still remembers; `replay` answers
 * what it holds and FAILS a request it does not hold (`AI0001`) and never
 * writes — the mode for an offline evaluation that must not buy.
 *
 * The directory is reached through the injected `files` (Node's
 * `node:fs/promises` satisfies it), so the package itself imports no
 * platform module; hashing uses Web Crypto, global in Node and browsers.
 */

import { AiError } from './errors.ts';
import type { ReplayCache } from './replay.ts';

/** The file operations the adapter needs; `node:fs/promises` has them all. */
export type ReplayFiles = {
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  writeFile(path: string, data: string): Promise<unknown>;
  rename(from: string, to: string): Promise<unknown>;
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  readdir(path: string): Promise<string[]>;
};

const missing = (error: unknown) => (error as { code?: unknown })?.code === 'ENOENT';

async function sha256(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * @param options - `dir` is created on the first write; `files` is the
 *   injected file system; `mode` is `record`, `fresh` or `replay`
 */
export function createFileReplayCache(options: {
  dir: string;
  files: ReplayFiles;
  mode?: 'record' | 'fresh' | 'replay';
}): ReplayCache & {
  dir: string;
  mode: 'record' | 'fresh' | 'replay';
  /** How many entries the directory holds. */
  size: () => Promise<number>;
} {
  const mode = options.mode ?? 'record';
  if (mode !== 'record' && mode !== 'fresh' && mode !== 'replay')
    throw new AiError('AI0001', `mode must be 'record', 'fresh' or 'replay', got '${String(mode)}'`);
  if (typeof options.dir !== 'string' || options.dir === '')
    throw new AiError('AI0001', 'createFileReplayCache needs a dir');
  const { files } = options;
  const dir = options.dir.replace(/[\\/]+$/, '') || options.dir;
  const fileOf = async (key: string) => `${dir}/${await sha256(key)}.json`;

  async function read(key: string): Promise<unknown> {
    let text: string;
    try {
      text = await files.readFile(await fileOf(key), 'utf8');
    }
    catch (error) {
      if (missing(error)) return undefined;
      throw error;
    }
    const entry = JSON.parse(text);
    if (entry === null || typeof entry !== 'object' || typeof entry.key !== 'string' || !('value' in entry))
      throw new AiError('AI0003', `replay file for this request is not an entry: ${dir}`);
    return entry.key === key ? entry.value : undefined;
  }

  return {
    dir,
    mode,
    async get(key: string) {
      if (mode === 'fresh') return undefined;
      const value = await read(key);
      if (value === undefined && mode === 'replay')
        throw new AiError('AI0001', `the replay directory ${dir} holds no reply for this request, and replay mode never buys one`);
      return value;
    },
    async set(key: string, value: unknown) {
      if (mode === 'replay') throw new AiError('AI0001', `the replay directory ${dir} is read-only in replay mode`);
      await files.mkdir(dir, { recursive: true });
      const path = await fileOf(key);
      const temporary = `${path}.${globalThis.crypto.randomUUID()}.tmp`;
      await files.writeFile(temporary, JSON.stringify({ key, value }));
      await files.rename(temporary, path);
    },
    async size() {
      try {
        return (await files.readdir(dir)).filter((name) => name.endsWith('.json')).length;
      }
      catch (error) {
        if (missing(error)) return 0;
        throw error;
      }
    },
  };
}
