/**
 * The live tiers' replay store: one JSON file per remembered reply,
 * under a gitignored directory, behind the `cache` seam both wire
 * clients take. A live run spends two kinds of request — `/embeddings`
 * over a corpus that does not change between runs, and
 * `/chat/completions` over prompts that mostly do not — and buys both
 * again on every run unless something remembers them. This remembers
 * them, and is also the audit trail: every file holds the key it
 * answers (the whole canonical request) beside the value.
 *
 * The store itself is the published `@tangleai/models/replay-file`
 * adapter over `node:fs/promises`; this module fixes where the live tiers
 * keep it. `--fresh` on an instrument is its `fresh` mode, which answers
 * nothing while still remembering what it buys. Delete the directory to
 * start over.
 */

import { existsSync, readdirSync } from 'node:fs';
import * as files from 'node:fs/promises';

import { createFileReplayCache as createReplayDirectory } from '@tangleai/models/replay-file';

/** Where the live tiers remember, relative to the repository root. Gitignored. */
export const REPLAY_CACHE_DIR = 'benchmark/cache/replay';

/**
 * @param dir - the directory; created on the first `set`
 * @param [options] - `fresh` ignores what is
 *   remembered while still remembering what is bought
 */
export function createFileReplayCache(dir: string, options: {
  fresh?: boolean;
} = {}): import('@tangleai/models/replay').ReplayCache & {
  size: () => number;
  dir: string;
} {
  const cache = createReplayDirectory({ dir, files, mode: options.fresh === true ? 'fresh' : 'record' });
  return {
    dir,
    get: cache.get,
    set: cache.set,
    size() {
      return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.json')).length : 0;
    },
  };
}
