/** Keyless measurements and a dry live plan; neither path makes requests. */
import { mkdir, readFile, writeFile, realpath, lstat } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/args.ts';
import { buildCgtReport, planCgtLive, authorizeCgtLive, requireCapability, renderReport, renderDocument, REPORT_PATH, DOCUMENT_PATH, SOURCE_FILES, SOURCE_ROOTS } from './lib/cgt.ts';

/** Resolve existing symlink ancestors even when the final output does not exist. */
async function physicalPath(path: string): Promise<string> {
  try { return await realpath(path); }
  catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    const entry = await lstat(path).catch((failure: unknown) => {
      if (failure instanceof Error && 'code' in failure && failure.code === 'ENOENT') return null;
      throw failure;
    });
    if (entry?.isSymbolicLink()) throw Error('cgt: output path has a dangling symlink');
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(await physicalPath(parent), basename(path));
  }
}
async function assertOutputPaths(root: string, paths: string[]): Promise<void> {
  const outputs = await Promise.all(paths.map(physicalPath));
  if (new Set(outputs).size !== outputs.length) throw Error('cgt: output paths overlap');
  const files = await Promise.all(SOURCE_FILES.map(path => physicalPath(resolve(root, path))));
  const directories = await Promise.all(SOURCE_ROOTS.map(path => physicalPath(resolve(root, path))));
  if (outputs.some(path => files.includes(path) || directories.some(dir => path === dir || path.startsWith(dir + sep))))
    throw Error('cgt: output overlaps an instrument source');
}

export async function cgtMain(argv: readonly string[], options: { root?: string; env?: Record<string, string | undefined> } = {}): Promise<void> {
  const args = parseArgs(argv, { flags: ['check', 'live', 'train'], values: ['json', 'md', 'out-dir', 'require', 'authorize', 'seed', 'sessions'] });
  if (args.rest.length) throw Error('cgt: unexpected positional argument');
  if (args.values.has('authorize') && !args.flags.has('live')) throw Error('cgt: --authorize requires --live');
  if (args.flags.has('train') && !args.flags.has('live')) throw Error('cgt: --train requires --live');
  const integer = (name: string): number | undefined => {
    const value = args.values.get(name);
    if (value === undefined) return undefined;
    if (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value))) throw Error('cgt: invalid --' + name);
    return Number(value);
  };
  const root = options.root ?? process.cwd(), selected = { root, seed: integer('seed'), sessions: integer('sessions') };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw Error('cgt: unexpected network request'); };
  try {
    if (args.flags.has('live')) {
      if (['check'].some(flag => args.flags.has(flag)) || ['json', 'md', 'out-dir', 'require'].some(name => args.values.has(name)))
        throw Error('cgt: live plan cannot write or check measurement outputs');
      const plan = await planCgtLive({ ...selected, env: options.env, train: args.flags.has('train') });
      console.log(JSON.stringify({ plan, status: authorizeCgtLive(plan, args.values.get('authorize')), requests: 0 }, null, 2));
      return;
    }
    const dir = args.values.get('out-dir');
    if (dir && (args.values.has('json') || args.values.has('md'))) throw Error('cgt: --out-dir cannot combine with --json or --md');
    const json = resolve(root, dir ? join(dir, 'cgt.json') : args.values.get('json') ?? REPORT_PATH);
    const md = resolve(root, dir ? join(dir, 'CGT_BENCHMARK.md') : args.values.get('md') ?? DOCUMENT_PATH);
    if (json === md) throw Error('cgt: output paths overlap');
    await assertOutputPaths(root, [json, md]);
    const required = args.values.get('require') ?? 'scripted';
    if (!['oracle', 'scripted', 'gates', 'live'].includes(required)) throw Error('unknown cgt capability: ' + required);
    const report = await buildCgtReport(selected);
    requireCapability(report, required);
    const outputs = [[json, renderReport(report)], [md, renderDocument(report)]];
    if (args.flags.has('check')) {
      for (const [path, bytes] of outputs) if (await readFile(path, 'utf8') !== bytes) throw Error('cgt artifact drift: ' + path);
    } else {
      for (const [path, bytes] of outputs) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes); }
    }
    console.log(`cgt: ${report.reportId}; ${report.rows.length} rows; zero provider requests`);
  } finally { globalThis.fetch = originalFetch; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await cgtMain(process.argv.slice(2));
