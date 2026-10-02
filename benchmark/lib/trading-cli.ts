/** Keyless trading measurement with read-only drift checks. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { equalsJson } from '@jarenjs/core/object';
import { parseArgs } from './args.ts';
import { buildTradingReport, validateTradingReport, tradingSource, requireCapability, renderReport, renderDocument, REPORT_PATH, DOCUMENT_PATH } from './trading-report.ts';
import type { Trading } from './trading.types.ts';
import schema from '../schemas/trading.schema.json' with { type: 'json' };

/** Run the registered command, retaining independent measurement and read-only checks. */
export async function runTradingCli(argv: string[], log: (message: string) => void = console.log): Promise<void> {
  if (argv.some(a => a.startsWith('--') && a.includes('='))) throw new Error('Inline trading options are not supported');
  const args = parseArgs(argv, { flags: ['check'], values: ['out-dir', 'json', 'md', 'require'] });
  if (args.rest.length || [...args.values.values()].some(v => v.startsWith('--'))) throw new Error('Malformed trading arguments');
  if (args.values.has('out-dir') && (args.values.has('json') || args.values.has('md'))) throw new Error('Choose out-dir or explicit output paths');
  const out = args.values.get('out-dir');
  const json = args.values.get('json') ?? (out ? join(out, 'trading.json') : REPORT_PATH);
  const md = args.values.get('md') ?? (out ? join(out, 'TRADING_BENCHMARK.md') : DOCUMENT_PATH);
  if (resolve(json) === resolve(md)) throw new Error('Trading outputs require distinct paths');
  const capability = args.values.get('require') ?? 'instrument';
  if (!Object.hasOwn(schema.$defs.capabilities.properties, capability)) throw new Error(`Unknown trading capability: ${capability}`);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Keyless trading must not reach the network'); };
  try {
    let retained: Trading | undefined;
    if (args.flags.has('check')) {
      const bytes = await readFile(json, 'utf8'), input: unknown = JSON.parse(bytes);
      if (bytes !== JSON.stringify(input, null, 2) + '\n') throw new Error(`Trading artifact drift: ${json}`);
      const candidate = input as Partial<Trading> | null;
      // Reject stale sources before running the expensive independent reproduction.
      // Committing identical measured bytes does not invalidate recorded provenance.
      if (!Array.isArray(candidate?.source?.files) || !equalsJson(candidate.source.files, (await tradingSource()).files)) throw new Error('Trading source drift');
      const checked = await validateTradingReport(input);
      if (!checked.valid) throw new Error(`Invalid retained trading report: ${checked.errors.join('; ')}`);
      retained = input as Trading;
    }
    const report = await buildTradingReport(retained ? { source: retained.source } : {});
    requireCapability(report, capability);
    for (const [path, bytes] of [[json, renderReport(report)], [md, renderDocument(report)]]) {
      if (args.flags.has('check')) { if (await readFile(path, 'utf8') !== bytes) throw new Error(`Trading artifact drift: ${path}`); }
      else { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes); }
    }
    log(`Trading ${report.reportId}: ${report.counts.measured}/${report.counts.registered} measured, ${report.poison.influenced} poison influence`);
  } finally { globalThis.fetch = previousFetch; }
}
