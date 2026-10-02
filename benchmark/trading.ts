/** Keyless trading measurement with read-only drift checks. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { equalsJson } from '@jarenjs/core/object';
import { parseArgs } from './lib/args.ts';
import { buildTradingReport, validateTradingReport, tradingSource, requireCapability, renderReport, renderDocument, REPORT_PATH, DOCUMENT_PATH } from './lib/trading-report.ts';
import type { Trading } from './lib/trading.types.ts';

const argv = process.argv.slice(2);
if (argv.some(a => a.startsWith('--') && a.includes('='))) throw new Error('Inline trading options are not supported');
const args = parseArgs(argv, { flags: ['check'], values: ['out-dir', 'json', 'md', 'require'] });
if (args.rest.length || [...args.values.values()].some(v => v.startsWith('--'))) throw new Error('Malformed trading arguments');
if (args.values.has('out-dir') && (args.values.has('json') || args.values.has('md'))) throw new Error('Choose out-dir or explicit output paths');
const out = args.values.get('out-dir');
const json = args.values.get('json') ?? (out ? join(out, 'trading.json') : REPORT_PATH);
const md = args.values.get('md') ?? (out ? join(out, 'TRADING_BENCHMARK.md') : DOCUMENT_PATH);
if (resolve(json) === resolve(md)) throw new Error('Trading outputs require distinct paths');
globalThis.fetch = async () => { throw new Error('Keyless trading must not reach the network'); };
let retained: Trading | undefined;
if (args.flags.has('check')) {
  const input: unknown = JSON.parse(await readFile(json, 'utf8'));
  const checked = await validateTradingReport(input);
  if (!checked.valid) throw new Error(`Invalid retained trading report: ${checked.errors.join('; ')}`);
  retained = input as Trading;
  // Committing identical measured bytes does not invalidate their recorded provenance.
  if (!equalsJson(retained.source.files, (await tradingSource()).files)) throw new Error('Trading source drift');
}
const report = await buildTradingReport(retained ? { source: retained.source } : {});
requireCapability(report, args.values.get('require') ?? 'instrument');
for (const [path, bytes] of [[json, renderReport(report)], [md, renderDocument(report)]]) {
  if (args.flags.has('check')) { if (await readFile(path, 'utf8') !== bytes) throw new Error(`Trading artifact drift: ${path}`); }
  else { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes); }
}
console.log(`Trading ${report.reportId}: ${report.counts.measured}/${report.counts.registered} measured, ${report.poison.influenced} poison influence`);
