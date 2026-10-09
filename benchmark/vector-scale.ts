/** Registered graph measurements, or read-only validation of retained evidence. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { equalsJson } from '@jarenjs/core/object';
import { parseArgs } from './lib/args.ts';
import { measureVectorScale, validateVectorScale, vectorScaleSource, loadVectorTrigger, renderVectorScale, VectorScaleRefusal } from './lib/vector-scale.ts';

const args = parseArgs(process.argv.slice(2), { flags: ['check', 'require'], values: ['json', 'md', 'receipt', 'sizes'] });
if (args.rest.length) throw new TypeError('Unexpected vector scale arguments.');
const paths = { json: args.values.get('json') ?? 'benchmark/results/vector-scale.json',
  md: args.values.get('md') ?? 'docs/VECTOR_SCALE.md', receipt: args.values.get('receipt') ?? 'benchmark/receipts/vector-scale-graph.json' };
let physicalRequests = 0;
globalThis.fetch = async () => { physicalRequests++; throw new Error('The registered graph instrument forbids network requests.'); };
try {
  const evidence = args.flags.has('check')
    ? await validateVectorScale(JSON.parse(await readFile(paths.json, 'utf8')), JSON.parse(await readFile(paths.receipt, 'utf8')))
    : await measureVectorScale({ sizes: args.values.has('sizes') ? args.values.get('sizes')!.split(',').map(Number) : undefined,
      physicalRequests: () => physicalRequests, onProgress: line => console.error(line) });
  if (!equalsJson(evidence.report.source, await vectorScaleSource()) || !equalsJson(evidence.report.trigger, await loadVectorTrigger()))
    throw new VectorScaleRefusal('TVEC1006', 'The retained graph source or released trigger is stale.');
  if (args.flags.has('require') && evidence.report.status !== 'measured')
    throw new VectorScaleRefusal('TVEC1006', 'Required mode needs the complete registered graph ladder.');
  const md = renderVectorScale(evidence.report, evidence.receipt);
  if (args.flags.has('check')) {
    if (await readFile(paths.md, 'utf8') !== md) throw new VectorScaleRefusal('TVEC1006', 'The graph document differs from its retained evidence.');
  } else {
    for (const [path, value] of [[paths.json, JSON.stringify(evidence.report, null, 2) + '\n'],
      [paths.receipt, JSON.stringify(evidence.receipt, null, 2) + '\n'], [paths.md, md]]) {
      await mkdir(dirname(path), { recursive: true }); await writeFile(path, value);
    }
  }
  console.log(JSON.stringify({ status: evidence.report.status, reportId: evidence.report.reportId, receiptId: evidence.receipt.receiptId,
    decision: evidence.receipt.decision, physicalRequests }));
} catch (cause) {
  if (!args.flags.has('require') && !args.flags.has('check') && cause instanceof VectorScaleRefusal && cause.code === 'TVEC1006'
    && cause.message === 'The released graph trigger is missing or invalid.') {
    console.log(JSON.stringify({ status: 'skipped', code: cause.code, reason: cause.message, physicalRequests }));
  } else throw cause;
}
