/** Explicit acquisition and deterministic census; no provider setup. */
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from './lib/args.ts';
import { downloadLongMemEval, LONGMEMEVAL_FILES, qualifyLongMemEvalCode, type LongMemEvalFile } from './lib/longmemeval-source.ts';
import { loadLongMemEval } from './lib/longmemeval.ts';
import { loadLocomo } from './lib/locomo.ts';
import { longMemEvalReport, renderLongMemEval } from './lib/longmemeval-report.ts';

const args = parseArgs(process.argv.slice(2), { flags: ['require', 'download', 'check'], values: ['json', 'md', 'root'] });
if (args.rest.length) throw new Error('unexpected positional arguments');
const root = args.values.get('root') ?? process.cwd();
if (args.flags.has('download')) for (const name of Object.keys(LONGMEMEVAL_FILES) as LongMemEvalFile[]) {
  const result = await downloadLongMemEval(root, name, globalThis.fetch);
  if (result.status !== 'available') { console.error(result.reason); process.exit(1); }
}
const code = await qualifyLongMemEvalCode(root), data = await loadLongMemEval(root);
if (code.status !== 'available' || data.status !== 'available') {
  const unavailable = code.status !== 'available' ? code : data;
  console.log(JSON.stringify(unavailable));
  process.exit(unavailable.status === 'failed' || args.flags.has('require') ? 1 : 0);
}
const locomo = await loadLocomo(root);
const report = longMemEvalReport(data.value, locomo.available && locomo.valid ? locomo.samples.map(s => s.sample_id) : []);
const json = JSON.stringify(report, null, 2) + '\n', md = renderLongMemEval(report);
for (const [flag, content] of [['json', json], ['md', md]]) {
  const path = args.values.get(flag);
  if (path === undefined) continue;
  if (args.flags.has('check')) { if (await readFile(path, 'utf8') !== content) throw new Error(`generated ${flag} differs: ${path}`); }
  else await writeFile(path, content);
}
if (args.flags.has('check') && !args.values.has('json') && !args.values.has('md')) throw new Error('--check requires --json or --md');
if (!args.values.has('md') && !args.values.has('json')) console.log(md);
