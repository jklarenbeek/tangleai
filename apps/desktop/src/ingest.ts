/**
 * Folder ingestion — the "set up a folder against it" feature.
 *
 * A sync walks the folder, skips what hasn't changed (content hash per
 * file in the `documents` collection), chunks the rest with
 * `@jarenjs/core/chunk` (separator strategy: paragraphs grouped up to a
 * budget, never cut mid-unit), and runs ONE pipeline pass over all new
 * observations — so the DAG page shows a sync as a single run with its
 * per-stage story.
 *
 * Every observation's evidence names its source: `path#chunk (hash)` —
 * the citation the chat surface later shows is this string.
 *
 * Everything a pass does NOT ingest is a number, never a silence:
 * `skipped` is every file the pass declined to read — one over the size
 * bound, and one whose content hash has not moved since the last pass,
 * which is why a second identical scan skips the whole folder — a file
 * longer than the chunk bound is `truncated`, a file that left the
 * folder is `removed` — its `documents` row deleted so the same path
 * can be ingested again — and the memory units whose evidence names a
 * removed file are `orphanedUnits`. Those units are never deleted and
 * never superseded: curated memory is not a mirror of the folder, and a
 * file's deletion is not evidence that a statement became false. The
 * count is the honest report that the corpus and the folder disagree.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';

import { chunkText, truncate } from '@jarenjs/core/chunk';
import { hashContent } from '@jarenjs/core/string';
import type { MemoryStore, MemoryUnitInput } from '@tangleai/memory';
import type { Pipeline, PipelineReport, DagNodeRecord } from '@tangleai/pipeline';
import { asRows, type DbCollection, type TangleDb } from '@tangleai/store';

const TEXT_EXTENSIONS = new Set([
  '.md', '.markdown', '.txt', '.rst', '.adoc',
  '.ts', '.js', '.mjs', '.cjs', '.tsx', '.jsx', '.py', '.rs', '.go', '.java', '.c', '.h', '.sh',
  '.json', '.toml', '.yml', '.yaml', '.ini', '.env.example',
  '.html', '.css', '.svg', '.sql',
]);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'target', '.cache', 'coverage']);
const MAX_FILE_BYTES = 512 * 1024;
// `size: 1` under the separator strategy forces every paragraph into its
// own piece (a unit longer than `size` is its own piece by chunkText's
// documented oversized-unit rule) — a memory unit is a STATEMENT, not a
// page. Coarser, smarter chunking (S2) is the document lane's, not here.
const PARAGRAPH = { strategy: 'separator' as const, size: 1 };
const MAX_CHUNKS_PER_FILE = 64;
const MAX_UNIT_CHARS = 2000;

export async function walkFolder(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(full);
      } else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        found.push(full);
      }
    }
  }
  await walk(root);
  found.sort();
  return found;
}

/** What asked for this pass: a click, a start scan, or what the watcher saw. */
export type SyncTrigger = 'manual' | 'start' | 'change' | 'overflow' | 'tick';

/** Every departure from "everything in the folder is ingested", as a number. */
export interface SyncCounts {
  scanned: number;
  ingested: number;
  skipped: number;
  removed: number;
  truncated: number;
  orphanedUnits: number;
}

export interface SyncOutcome {
  runId: string | null;
  files: SyncCounts;
  trigger: SyncTrigger;
  report: PipelineReport | null;
}

export interface SyncOptions {
  folder: string;
  db: TangleDb;
  pipeline: Pipeline;
  /** Reads the units a removed file's evidence may name; nothing here writes to it. */
  memoryStore: MemoryStore;
  trigger?: SyncTrigger;
  now?: () => string;
  onNode?: (record: DagNodeRecord) => void;
  runId?: string;
}

/** One ingested file, keyed by its folder-relative path. */
export interface DocumentRecord {
  path: string;
  hash: string;
  chunks: number;
  ingestedAt: string;
}

export async function syncFolder(options: SyncOptions): Promise<SyncOutcome> {
  const { folder, db, pipeline, memoryStore } = options;
  const now = options.now ?? ((): string => new Date().toISOString());
  const trigger = options.trigger ?? 'manual';
  const documents = db.collection<DocumentRecord>('documents');

  const paths = await walkFolder(folder);
  const present = new Set(paths.map((path) => relative(folder, path)));
  const observations: MemoryUnitInput[] = [];
  const toRecord: Array<{ path: string, hash: string, chunks: number }> = [];
  let skipped = 0;
  let truncated = 0;

  for (const path of paths) {
    const info = await stat(path);
    if (info.size > MAX_FILE_BYTES) { skipped++; continue; }
    const text = await readFile(path, 'utf8');
    const hash = hashContent(text);
    const rel = relative(folder, path);
    const known = await documents.get(rel);
    if (known !== undefined && known.hash === hash) { skipped++; continue; }

    const whole = chunkText(text, PARAGRAPH);
    // the bound stands; what changes is that a file taken in part says so
    if (whole.length > MAX_CHUNKS_PER_FILE) truncated++;
    const pieces = whole.slice(0, MAX_CHUNKS_PER_FILE);
    const at = now();
    for (const piece of pieces) {
      const body = piece.text.trim();
      if (body.length < 24) continue;
      observations.push({
        text: truncate(body, MAX_UNIT_CHARS),
        evidence: `${rel}#${piece.index} (${hash})`,
        tags: ['doc', extname(path).slice(1) || 'file'],
        at,
      });
    }
    toRecord.push({ path: rel, hash, chunks: pieces.length });
  }

  const removedPaths = await forgetVanishedFiles(documents, present);
  const orphanedUnits = await countOrphanedUnits(memoryStore, removedPaths);
  const files: SyncCounts = {
    scanned: paths.length,
    ingested: toRecord.length,
    skipped,
    removed: removedPaths.size,
    truncated,
    orphanedUnits,
  };

  // a file whose every piece is too short to be a statement still gets
  // its row: it was read and hashed, and without the row the next pass
  // would read it again and report it ingested again, forever
  const report = observations.length === 0 ? null : await pipeline.run(observations, { onNode: options.onNode });
  const at = now();
  for (const record of toRecord) {
    await documents.put({ ...record, ingestedAt: at });
  }
  return { runId: options.runId ?? null, files, trigger, report };
}

/**
 * A file that left the folder loses its `documents` row. Without this a
 * deleted path stays "ingested" forever and its stored hash keeps
 * suppressing a re-add of the same path.
 */
async function forgetVanishedFiles(
  documents: DbCollection<DocumentRecord>,
  present: ReadonlySet<string>,
): Promise<Set<string>> {
  const rows = asRows<DocumentRecord>(await documents.execute({ $for: { d: '$[*]' }, $return: '$d' }));
  const removed = new Set<string>();
  for (const row of rows) {
    if (present.has(row.path)) continue;
    await documents.delete(row.path);
    removed.add(row.path);
  }
  return removed;
}

/**
 * The live memory units whose only link back to a file names one this
 * pass removed. They are counted and left exactly as they are — a unit
 * may have been merged, contradicted or promoted since it was ingested,
 * and none of that stops being true because a file was deleted.
 */
async function countOrphanedUnits(memoryStore: MemoryStore, removed: ReadonlySet<string>): Promise<number> {
  if (removed.size === 0) return 0;
  const units = await memoryStore.list();
  let orphaned = 0;
  for (const unit of units) {
    if (unit.supersededBy !== undefined) continue;
    const hash = unit.evidence.indexOf('#');
    if (hash < 0) continue;
    if (removed.has(unit.evidence.slice(0, hash))) orphaned++;
  }
  return orphaned;
}
