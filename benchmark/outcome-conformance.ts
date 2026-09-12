/** Keyless outcome instrument. All output redirection is explicit and complete. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from './lib/args.ts';
import { buildOutcomeReport, renderReport, renderDocument, requireCapability, REPORT_PATH, DOCUMENT_PATH } from './lib/outcome-conformance.ts';
const args=parseArgs(process.argv.slice(2),{flags:['check'],values:['out-dir','require']});
if(args.rest.length)throw Error('unexpected outcome positional arguments');
globalThis.fetch=async()=>{throw Error('outcome conformance must not make a network call');};
const report=await buildOutcomeReport();
requireCapability(report,args.values.get('require')??'oracle');
const dir=args.values.get('out-dir');if(dir)await mkdir(dir,{recursive:true});
const outputs:[[string,string],[string,string]]=[
 [dir?join(dir,'outcome-conformance.json'):REPORT_PATH,renderReport(report)],
 [dir?join(dir,'OUTCOME_BENCHMARK.md'):DOCUMENT_PATH,renderDocument(report)],
];
for(const [path,bytes] of outputs){if(args.flags.has('check')){if(await readFile(path,'utf8')!==bytes)throw Error(`outcome artifact drift: ${path}`);}else await writeFile(path,bytes);}
console.log(`outcome: ${report.reportId}; ${report.rows.length} rows; ${report.probes.length+report.rows.reduce((n,r)=>n+r.probes.length,0)} probes`);
