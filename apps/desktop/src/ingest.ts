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
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';

import { chunkText, truncate } from '@jarenjs/core/chunk';
import { hashContent } from '@jarenjs/core/string';
import type { MemoryUnitInput } from '@tangleai/memory';
import type { Pipeline, PipelineReport, DagNodeRecord } from '@tangleai/pipeline';
import type { TangleDb } from '@tangleai/store';

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
// page. Coarser, smarter chunking (S2) is TODO order 08, not here.
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

export interface SyncOutcome {
  runId: string | null;
  files: { scanned: number, ingested: number, skipped: number };
  report: PipelineReport | null;
}

export interface SyncOptions {
  folder: string;
  db: TangleDb;
  pipeline: Pipeline;
  now?: () => string;
  onNode?: (record: DagNodeRecord) => void;
  runId?: string;
}

export async function syncFolder(options: SyncOptions): Promise<SyncOutcome> {
  const { folder, db, pipeline } = options;
  const now = options.now ?? ((): string => new Date().toISOString());
  const documents = db.collection('documents');

  const paths = await walkFolder(folder);
  const observations: MemoryUnitInput[] = [];
  const toRecord: Array<{ path: string, hash: string, chunks: number }> = [];
  let skipped = 0;

  for (const path of paths) {
    const info = await stat(path);
    if (info.size > MAX_FILE_BYTES) { skipped++; continue; }
    const text = await readFile(path, 'utf8');
    const hash = hashContent(text);
    const rel = relative(folder, path);
    const known = await documents.get(rel);
    if (known !== undefined && known.hash === hash) { skipped++; continue; }

    const pieces = chunkText(text, PARAGRAPH).slice(0, MAX_CHUNKS_PER_FILE);
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

  if (observations.length === 0) {
    return { runId: null, files: { scanned: paths.length, ingested: 0, skipped }, report: null };
  }

  const report = await pipeline.run(observations, { onNode: options.onNode });
  const at = now();
  for (const record of toRecord) {
    await documents.put({ ...record, ingestedAt: at });
  }
  return {
    runId: options.runId ?? null,
    files: { scanned: paths.length, ingested: toRecord.length, skipped },
    report,
  };
}
