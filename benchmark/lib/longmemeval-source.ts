/** Pinned public corpus acquisition; source checkout and downloaded data are separate. */
import { createHash } from 'node:crypto';
import { readFile, mkdir, mkdtemp, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const LONGMEMEVAL_SOURCE = Object.freeze({
  repository: 'https://github.com/xiaowu0162/LongMemEval.git',
  codeRevision: '9e0b455f4ef0e2ab8f2e582289761153549043fc',
  dataset: 'xiaowu0162/longmemeval-cleaned',
  dataRevision: '98d7416c24c778c2fee6e6f3006e7a073259d48f',
  license: 'MIT',
  directory: 'benchmark/data/longmemeval',
  evaluators: {
    'evaluate_qa.py': 'ecce9c4c79dc89d99534ac17b383a5cbb5b9f0c69ee98adaf0684742e3d95251',
    'print_qa_metrics.py': 'e9283933a0cefb7a0ded7365e436ae3d1be5aac41853325e6155d83bf07607f0',
  },
});
export const LONGMEMEVAL_FILES = Object.freeze({
  'longmemeval_s_cleaned.json': { bytes: 277383467, sha256: 'd6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442' },
  'longmemeval_oracle.json': { bytes: 15388478, sha256: '821a2034d219ab45846873dd14c14f12cfe7776e73527a483f9dac095d38620c' },
});
export type LongMemEvalFile = keyof typeof LONGMEMEVAL_FILES;
export type SourceResult<T> = { status: 'available'; value: T } | { status: 'unavailable' | 'failed'; reason: string };
export function sha256(bytes: string | Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function reason(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }

export async function readVerifiedSource(path: string, expected: { bytes: number; sha256: string }): Promise<SourceResult<Buffer>> {
  try {
    const bytes = await readFile(path);
    if (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) return { status: 'failed', reason: 'source size or SHA-256 mismatch' };
    return { status: 'available', value: bytes };
  } catch (cause) {
    return { status: (cause as NodeJS.ErrnoException).code === 'ENOENT' ? 'unavailable' : 'failed', reason: reason(cause) };
  }
}

/** Stream into a sibling temporary directory. Only fully verified bytes replace a cache. */
export async function acquireVerifiedSource(options: {
  destination: string; url: string; expected: { bytes: number; sha256: string };
  fetch: typeof globalThis.fetch; signal?: AbortSignal;
}): Promise<SourceResult<{ bytes: number; sha256: string }>> {
  const parent = join(options.destination, '..');
  let temporary: string | undefined;
  try {
    await mkdir(parent, { recursive: true });
    temporary = await mkdtemp(join(parent, '.download-'));
    const path = join(temporary, 'data');
    const response = await options.fetch(options.url, { signal: options.signal });
    if (!response.ok || response.body === null) return { status: 'failed', reason: `download HTTP ${response.status}` };
    const file = await open(path, 'wx');
    const hash = createHash('sha256');
    let bytes = 0;
    try {
      for await (const chunk of response.body) {
        options.signal?.throwIfAborted();
        bytes += chunk.byteLength;
        if (bytes > options.expected.bytes) throw new Error('download exceeds pinned size');
        hash.update(chunk);
        await file.writeFile(chunk);
      }
      await file.sync();
    } finally { await file.close(); }
    const digest = hash.digest('hex');
    if (bytes !== options.expected.bytes || digest !== options.expected.sha256) return { status: 'failed', reason: 'download size or SHA-256 mismatch' };
    options.signal?.throwIfAborted();
    await rename(path, options.destination);
    return { status: 'available', value: { bytes, sha256: digest } };
  } catch (cause) { return { status: 'failed', reason: reason(cause) }; }
  finally { if (temporary !== undefined) await rm(temporary, { recursive: true, force: true }); }
}

export function downloadLongMemEval(root: string, name: LongMemEvalFile, fetch: typeof globalThis.fetch) {
  return acquireVerifiedSource({ destination: join(root, LONGMEMEVAL_SOURCE.directory, name),
    url: `https://huggingface.co/datasets/${LONGMEMEVAL_SOURCE.dataset}/resolve/${LONGMEMEVAL_SOURCE.dataRevision}/${name}`,
    expected: LONGMEMEVAL_FILES[name], fetch });
}

export async function qualifyLongMemEvalCode(root: string): Promise<SourceResult<typeof LONGMEMEVAL_SOURCE>> {
  try {
    const exec = promisify(execFile);
    const cwd = join(root, 'benchmark/longmemeval');
    const revision = (await exec('git', ['rev-parse', 'HEAD'], { cwd })).stdout.trim();
    const remote = (await exec('git', ['remote', 'get-url', 'origin'], { cwd })).stdout.trim();
    const dirty = (await exec('git', ['status', '--porcelain'], { cwd })).stdout.trim();
    const link = (await exec('git', ['ls-files', '--stage', 'benchmark/longmemeval'], { cwd: root })).stdout;
    if (revision !== LONGMEMEVAL_SOURCE.codeRevision || remote !== LONGMEMEVAL_SOURCE.repository || dirty !== '' || !link.startsWith(`160000 ${revision} 0\t`)) {
      return { status: 'failed', reason: 'LongMemEval checkout, gitlink, URL or cleanliness mismatch' };
    }
    for (const [name, hash] of Object.entries(LONGMEMEVAL_SOURCE.evaluators)) {
      if (sha256(await readFile(join(cwd, 'src/evaluation', name))) !== hash) return { status: 'failed', reason: `evaluator hash mismatch: ${name}` };
    }
    return { status: 'available', value: LONGMEMEVAL_SOURCE };
  } catch (cause) { return { status: 'unavailable', reason: `initialize pinned source: git submodule update --init benchmark/longmemeval (${reason(cause)})` }; }
}
