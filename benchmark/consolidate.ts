import { scriptedConsolidationCandidate } from './lib/consolidate-scripted.ts';
/** Keyless evidence controls; this entry point never loads provider credentials. */
import { writeFile } from 'node:fs/promises';
import { parseArgs } from './lib/args.ts';
import { loadLocomo } from './lib/locomo.ts';
import { consolidateSourceHash } from './lib/consolidate-source.ts';
import { lexicalControl, deterministicCandidate } from './lib/consolidate-candidates.ts';
import { hashControl, runConsolidate, renderConsolidate, CONSOLIDATE_REGISTRATION } from './lib/consolidate.ts';

const args = parseArgs(process.argv.slice(2), { flags: ['require'], values: ['json', 'md'] });
const dataset = await loadLocomo();
if (!dataset.available) {
  console.log(`Consolidation corpus unavailable: ${dataset.reason}. ${dataset.hint}`);
  process.exit(args.flags.has('require') ? 1 : 0);
}
if (!dataset.valid || dataset.sha256 !== CONSOLIDATE_REGISTRATION.corpusSha256) throw new Error('registered consolidation corpus moved');
const report = await runConsolidate(dataset, { sourceHash: await consolidateSourceHash(), candidates: [hashControl(), lexicalControl(), deterministicCandidate(), deterministicCandidate(true), lexicalControl(true), deterministicCandidate(false, true), deterministicCandidate(true, true), scriptedConsolidationCandidate(), scriptedConsolidationCandidate(true)] });
const markdown = renderConsolidate(report);
if (args.values.has('json')) await writeFile(args.values.get('json')!, JSON.stringify(report, null, 2) + '\n');
if (args.values.has('md')) await writeFile(args.values.get('md')!, markdown);
console.log(markdown);
