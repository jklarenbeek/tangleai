/* eslint-disable no-console */
/** Keyless HERA registration; every missing mechanism remains a counted absence. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from './lib/args.ts';
import { HERA_REPORT_PATH, HERA_DOCUMENT_PATH, buildHeraReport, requireHeraCapability,
  renderHeraReport, renderHeraDocument } from './lib/hera-qa.ts';

const args = parseArgs(process.argv.slice(2), { flags: ['check'], values: ['out-dir', 'require'] });
if (args.rest.length) throw new Error('HERA accepts no positional arguments.');
globalThis.fetch = (() => { throw new Error('HERA keyless instrument attempted a network request.'); }) as typeof fetch;
const report = await buildHeraReport();
requireHeraCapability(report, args.values.get('require') ?? 'instrument');
const directory = args.values.get('out-dir');
if (directory !== undefined && !args.flags.has('check')) await mkdir(directory, { recursive: true });
const files = [
  [directory === undefined ? HERA_REPORT_PATH : join(directory, 'hera-qa.json'), renderHeraReport(report)],
  [directory === undefined ? HERA_DOCUMENT_PATH : join(directory, 'HERA_BENCHMARK.md'), renderHeraDocument(report)],
];
for (const [path, text] of files) {
  if (args.flags.has('check')) {
    if (await readFile(path, 'utf8') !== text) throw new Error('HERA artifact drift: ' + path);
  } else await writeFile(path, text);
}
console.log(`HERA: ${report.totals.run}/${report.totals.rows} measured rows; ${report.totals.implementationMissing} missing; ${report.totals.calls} provider calls; ${report.refusals.evalSplitInLearn} held-out learning refusals.`);
