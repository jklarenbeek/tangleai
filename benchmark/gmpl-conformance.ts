/** Keyless, reproducible GMPL CLI; no environment file or provider default. */
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from './lib/args.ts';
import { buildGmplReport,renderReport,renderDocument,requireCapability,REPORT_PATH,DOCUMENT_PATH } from './lib/gmpl-conformance.ts';
const argv=process.argv.slice(2);
if(argv.some(a=>a.startsWith('--check=')))throw Error('--check takes no value');
const args=parseArgs(argv,{flags:['check'],values:['out-dir','require']});
if(args.rest.length)throw Error('unexpected GMPL positional arguments');
for(const value of args.values.values())if(value.startsWith('--')||value.includes('='))throw Error('malformed GMPL option');
globalThis.fetch=async()=>{throw Error('GMPL conformance must not make a network call');};
const report=await buildGmplReport();
requireCapability(report,args.values.get('require')??'instrument');
const dir=args.values.get('out-dir');if(dir&&!args.flags.has('check'))await mkdir(dir,{recursive:true});
for(const [path,bytes] of [[dir?join(dir,'gmpl-conformance.json'):REPORT_PATH,renderReport(report)],[dir?join(dir,'GMPL_BENCHMARK.md'):DOCUMENT_PATH,renderDocument(report)]]){
  if(args.flags.has('check')){if(await readFile(path,'utf8')!==bytes)throw Error(`GMPL artifact drift: ${path}`);}else await writeFile(path,bytes);
}
console.log(`GMPL ${report.reportId}: ${report.coverage.executed}/${report.coverage.planned} executed`);
